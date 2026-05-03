import net from 'net'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { IPC } from '../shared/ipc-channels'
import type { PaneStatusPayload } from '../shared/ipc-channels'
import type { HookPayload, PaneStatus } from '../shared/types'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import type { MetricsCollector } from './metrics-collector'
import type { StatusDetector } from './status-detector'
import type { GitStatusPoller } from './git-status-poller'
import type { InspectorService } from './inspector'
import type { WorkspaceManager } from './workspace-manager'
import { CLAUDE_PATTERNS } from './claude-patterns'
import { getGitStatus } from './git-status'
import { trackHookFailure } from './analytics/error-instrumentation'

// ---------------------------------------------------------------------------
// Hook event → status mapping (PRD F6)
// ---------------------------------------------------------------------------

/**
 * Hook events that map directly to a status. Stop / StopFailure are NOT in
 * this map — they're routed by the synchronous diff probe below (changes
 * present → 'changes-ready', clean → 'needs-input').
 */
const HOOK_STATUS_MAP: Partial<Record<string, PaneStatus>> = {
  SessionStart: 'awaiting-prompt',
  // UserPromptSubmit fires the moment the user submits a prompt, before Claude
  // has called any tool. This is the earliest reliable signal that Claude is
  // about to think — without it, the pane stays on its previous status until
  // the first PreToolUse arrives, which can be many seconds.
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working'
}
// Notification is intentionally absent from HOOK_STATUS_MAP — it fires for
// both permission prompts (needs-input) AND task-completion alerts (not
// needs-input). It is handled with PTY-output refinement below.

// Tools that block on user input — PreToolUse for these should yield
// 'needs-input' instead of 'working'.
const NEEDS_INPUT_TOOLS: ReadonlySet<string> = new Set([
  'ExitPlanMode',
  'AskUserQuestion',
])

// ---------------------------------------------------------------------------
// HookListener
// ---------------------------------------------------------------------------

/**
 * HookListener — Unix domain socket server in the main process.
 *
 * Receives hook events forwarded by `scripts/claudinha-hook-relay.sh`, parses
 * them, and dispatches status updates to the correct BrowserWindow via IPC.
 *
 * Routing uses `paneId` injected by the relay (CLAUDINHA_PANE_ID env var), which
 * is available from the very first hook event. `session_id` is stored
 * additionally from SessionStart for future correlation.
 *
 * A single instance is created in index.ts. Call start() after app.whenReady()
 * and stop() in the before-quit handler.
 */
export class HookListener {
  /**
   * Per-pane bookkeeping for the MIN_TOOL_DISPLAY_MS hold. `displayedAt` is
   * when we last pushed a PANE_STATUS out to the renderer for this pane;
   * `pendingTool` + `pendingTimer` track a coalesced deferred emit.
   */
  private readonly toolDisplayTiming = new Map<
    string,
    {
      displayedAt: number
      pendingTimer: ReturnType<typeof setTimeout> | null
      pendingTool: string | null
    }
  >()

  /**
   * Minimum time (ms) a tool verb must stay visible on the pane status pill
   * before it's allowed to change. Prevents rapid PreToolUse/PostToolUse
   * sequences from flashing verbs past too fast to read. Tool changes that
   * arrive inside the hold window are coalesced — the most recent ideal
   * value wins when the timer fires.
   */
  private static readonly MIN_TOOL_DISPLAY_MS = 2000

  private readonly socketPath: string
  private server: net.Server | null = null
  /** Callback invoked when the first hook event arrives for a pane (B-054). */
  private onHookEvent: ((paneId: string) => void) | null = null
  /** StatusDetector reference for consulting recent PTY output on Stop events. */
  private statusDetector: StatusDetector | null = null
  /** GitStatusPoller reference for triggering immediate checks on status changes. */
  private gitStatusPoller: GitStatusPoller | null = null
  /**
   * InspectorService reference so ExitPlanMode transitions refresh the repo
   * rail's awaiting-plan-approval count without waiting for the next git
   * poll. Set post-construction in index.ts.
   */
  private inspectorService: InspectorService | null = null
  /**
   * Set to true if the socket fails to bind (B-058).
   * StatusDetector checks this on registerPane() to skip the 30s timer and
   * immediately activate PTY fallback for the new pane.
   */
  private _socketFailed = false

  /** Returns true if the hook socket failed to bind and hooks are unavailable. */
  get socketFailed(): boolean {
    return this._socketFailed
  }

  /**
   * Register a callback to be invoked on every hook event arrival.
   * Used by StatusDetector (B-054) to cancel the PTY fallback timer.
   */
  setOnHookEvent(cb: (paneId: string) => void): void {
    this.onHookEvent = cb
  }

  /**
   * Provide a StatusDetector reference so Stop events can consult recent PTY
   * output to distinguish "done" from "waiting for user answer to a question".
   */
  setStatusDetector(detector: StatusDetector): void {
    this.statusDetector = detector
  }

  /**
   * Provide an InspectorService so ExitPlanMode activeToolName flips can
   * trigger a lightweight repo-rail refresh (drives the "Approve plans in
   * sequence" button's appearance).
   */
  setInspectorService(inspector: InspectorService): void {
    this.inspectorService = inspector
  }

  /**
   * Provide a GitStatusPoller so status changes to done/awaiting-prompt
   * trigger an immediate git status check.
   */
  setGitStatusPoller(poller: GitStatusPoller): void {
    this.gitStatusPoller = poller
  }

  /**
   * Wired after construction so each status emit also fans out a manager
   * window refresh (active-pane cards live-update). Held nullable so unit
   * tests don't have to satisfy the dependency.
   */
  private workspaceManager: WorkspaceManager | null = null

  setWorkspaceManager(wm: WorkspaceManager): void {
    this.workspaceManager = wm
  }

  constructor(
    private readonly sessionRegistry: SessionRegistry,
    private readonly windowManager: WindowManager,
    private readonly metricsCollector: MetricsCollector | null = null
  ) {
    const instanceId = randomUUID()
    // On Windows, use a named pipe path; on macOS/Linux use a Unix domain socket (B-057)
    this.socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\claudinha-hooks-${instanceId}`
        : path.join('/tmp', `claudinha-hooks-${instanceId}.sock`)
  }

  /**
   * The path to the Unix domain socket.
   * Pass this to PtyPool.spawn() as CLAUDINHA_SOCKET_PATH so Claude Code hooks
   * can find and connect to the listener.
   */
  getSocketPath(): string {
    return this.socketPath
  }

  /** Start listening on the Unix domain socket (or Windows named pipe). Call once after app.whenReady(). */
  start(): void {
    // On Unix: remove stale socket file from a prior crash. Named pipes on
    // Windows don't have a file-system entry to clean up (B-057).
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.socketPath)
      } catch {
        // File didn't exist — that's fine
      }
    }

    this.server = net.createServer((socket) => {
      this.handleConnection(socket)
    })

    this.server.on('error', (err) => {
      console.error('[hook-listener] server error:', err)
      // If the server fails to bind, mark socket as failed (B-058).
      // All panes spawned after this point will immediately use PTY fallback.
      this._socketFailed = true
    })

    this.server.listen(this.socketPath, () => {
      console.log('[hook-listener] listening on', this.socketPath)
    })
  }

  /** Stop the server and remove the socket file (Unix only). Call in before-quit handler. */
  stop(): void {
    this.server?.close()
    this.server = null
    // Named pipes on Windows are cleaned up automatically when the server closes (B-057)
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.socketPath)
      } catch {
        // Already gone
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private — connection and message handling
  // ---------------------------------------------------------------------------

  private handleConnection(socket: net.Socket): void {
    let buffer = ''

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      // Process complete newline-delimited JSON messages
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // retain incomplete trailing line
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) {
          void this.handleMessage(trimmed)
        }
      }
    })

    socket.on('error', () => {
      // Connection closed or errored — no action needed
    })
  }

  private async handleMessage(raw: string): Promise<void> {
    let payload: HookPayload
    try {
      payload = JSON.parse(raw) as HookPayload
    } catch {
      console.warn('[hook-listener] failed to parse JSON:', raw.slice(0, 200))
      trackHookFailure('parse-error')
      return
    }

    const { hookEventName, paneId } = payload

    if (!paneId) {
      console.warn('[hook-listener] missing paneId in hook payload, dropping event')
      return
    }

    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) {
      // Pane may have been closed before the hook event arrived
      return
    }

    // Notify callback (B-054): allows StatusDetector to cancel the fallback timer
    this.onHookEvent?.(paneId)

    // Store session_id from SessionStart for future correlation
    if (hookEventName === 'SessionStart' && payload.session_id) {
      this.sessionRegistry.updatePaneSessionId(paneId, payload.session_id)
    }

    // Store transcript path from Stop or StopFailure event
    if ((hookEventName === 'Stop' || hookEventName === 'StopFailure') && payload.transcript_path) {
      this.sessionRegistry.updatePaneTranscriptPath(paneId, String(payload.transcript_path))
    }

    // Increment tool usage on PostToolUse (real-time counter for ToolUsageRow)
    if (hookEventName === 'PostToolUse' && payload.tool_name) {
      this.sessionRegistry.incrementToolUsage(paneId, String(payload.tool_name))
    }

    // PostCompact: Claude is still working after compaction — don't change status,
    // just trigger a metrics refresh so context % updates immediately.
    if (hookEventName === 'PostCompact') {
      this.metricsCollector?.parseTranscriptForPane(paneId)
      return
    }

    // Resolve new status from mapping
    let newStatus = HOOK_STATUS_MAP[hookEventName]

    // Notification is not in HOOK_STATUS_MAP — refine it from PTY output.
    // It fires for both permission prompts (needs-input) and task-completion
    // alerts (should not change status). Only set needs-input when the PTY
    // output actually shows a prompt/question; otherwise leave status unchanged.
    if (hookEventName === 'Notification') {
      if (this.statusDetector) {
        const lastOutput = this.statusDetector.getLastOutput(paneId)
        if (lastOutput) {
          // Check against known permission-prompt patterns first
          for (const pattern of CLAUDE_PATTERNS.needsInput) {
            if (pattern.test(lastOutput)) {
              newStatus = 'needs-input'
              break
            }
          }
          // Also check if the last line ends with '?' (informal question)
          if (!newStatus) {
            const lastLine = lastOutput.trimEnd().split('\n').pop()?.trim()
            if (lastLine && lastLine.endsWith('?')) {
              newStatus = 'needs-input'
            }
          }
        }
      }
      // If no needs-input signal found, the notification is just an alert.
      // Still trigger transcript parsing, but skip the status update.
      if (!newStatus) {
        this.metricsCollector?.parseTranscriptForPane(paneId)
        return
      }
    }

    // Stop / StopFailure: route based on plan-mode + worktree diff state.
    //   1. permissionMode=plan + activeToolName=ExitPlanMode  → plan-ready
    //   2. permissionMode=plan                                → planning
    //   3. uncommitted edits OR commits ahead of base         → changes-ready
    //   4. otherwise                                          → needs-input
    if (hookEventName === 'Stop' || hookEventName === 'StopFailure') {
      newStatus = await this.routeStopStatus(pane.worktreePath, pane.permissionMode, pane.activeToolName)
      // Eagerly trigger an immediate poll so the renderer's gitStatus reflects
      // the same state we just used to route. Otherwise the kanban tile's
      // next-step pill could lag behind the column placement.
      this.gitStatusPoller?.triggerCheck(paneId)
    }

    if (!newStatus) return // Unknown event — ignore

    // activeToolName is only set during the PreToolUse → PostToolUse window
    // for a single tool call. Every other hook event — including PostToolUse —
    // clears it so the pane label reverts to the generic "Working" status
    // between tool calls. The emit block below applies a MIN_TOOL_DISPLAY_MS
    // hold so rapid tool changes don't flash verbs past too fast to read.
    const activeToolName =
      hookEventName === 'PreToolUse' && payload.tool_name
        ? String(payload.tool_name)
        : null

    // Tools that block on user input should be 'needs-input', not 'working'.
    if (hookEventName === 'PreToolUse' && activeToolName && NEEDS_INPUT_TOOLS.has(activeToolName)) {
      newStatus = 'needs-input'
    }

    // Only emit pane:status IPC when status or activeToolName actually changes
    const didStatusChange = pane.status !== newStatus
    const didToolChange = pane.activeToolName !== activeToolName
    if (!didStatusChange && !didToolChange) return

    // Capture the previous tool name BEFORE the update so we can tell whether
    // a plan-approval transition happened in either direction.
    const previousActiveToolName = pane.activeToolName

    // Session registry always reflects the logical truth of the latest hook
    // event. The renderer-facing PANE_STATUS emission may hold the tool verb
    // longer than the session reflects (see MIN_TOOL_DISPLAY_MS), so snapshot
    // paths (PANE_LIST, PANE_SPAWN) can briefly read a newer verb than what
    // is currently displayed; the next PANE_STATUS emission re-syncs.
    const updated = this.sessionRegistry.updatePaneStatus(
      paneId,
      newStatus,
      'hook',
      activeToolName
    )

    if (!updated) return

    // Forward status update to the BrowserWindow that owns this pane
    const win = this.windowManager.getWindow(pane.windowId)
    if (!win || win.isDestroyed()) return

    // Decide: emit now, or defer the tool-verb change to honor the minimum
    // display hold. Status transitions always emit immediately and cancel
    // any pending hold — the new status subsumes a stale pending tool.
    const now = Date.now()
    const timing = this.toolDisplayTiming.get(paneId)
    const holdActive =
      !didStatusChange &&
      didToolChange &&
      timing !== undefined &&
      now - timing.displayedAt < HookListener.MIN_TOOL_DISPLAY_MS

    if (holdActive && timing) {
      // Within hold window — coalesce. Replace any prior pending value with
      // this latest ideal; keep (or schedule) the timer to fire at
      // displayedAt + MIN_TOOL_DISPLAY_MS.
      if (timing.pendingTimer) clearTimeout(timing.pendingTimer)
      timing.pendingTool = activeToolName
      const delay = HookListener.MIN_TOOL_DISPLAY_MS - (now - timing.displayedAt)
      timing.pendingTimer = setTimeout(() => this.fireHeldToolUpdate(paneId), delay)
    } else {
      // Emit now. Cancel any pending tool-hold — this emit subsumes it.
      if (timing?.pendingTimer) {
        clearTimeout(timing.pendingTimer)
        timing.pendingTimer = null
        timing.pendingTool = null
      }
      const statusPayload: PaneStatusPayload = {
        paneId,
        status: newStatus,
        activeToolName,
        source: 'hook'
      }
      win.webContents.send(IPC.PANE_STATUS, statusPayload)
      this.workspaceManager?.pushManagerUpdate()
      this.toolDisplayTiming.set(paneId, {
        displayedAt: now,
        pendingTimer: null,
        pendingTool: null
      })
    }

    // Trigger async JSONL transcript parsing on Stop or Notification (PRD F7)
    if (hookEventName === 'Stop' || hookEventName === 'StopFailure' || hookEventName === 'Notification') {
      this.metricsCollector?.parseTranscriptForPane(paneId)
    }

    // Trigger immediate git status check when terminal becomes idle
    if (newStatus === 'changes-ready' || newStatus === 'awaiting-prompt') {
      this.gitStatusPoller?.triggerCheck(paneId)
    }

    // When a pane flips into or out of Claude Code's plan-approval picker
    // (`activeToolName === 'ExitPlanMode'`), refresh the workspace summary
    // so the repo rail's "Approve plans in sequence" button appears or
    // disappears promptly instead of waiting for the next git poll. Narrow
    // trigger avoids broadcasting on every tool switch.
    const flippedIntoPlanApproval = activeToolName === 'ExitPlanMode'
    const flippedOutOfPlanApproval = previousActiveToolName === 'ExitPlanMode'
    if (flippedIntoPlanApproval || flippedOutOfPlanApproval) {
      this.inspectorService?.broadcastSummary(pane.workspaceId)
    }
  }

  /**
   * Compute the post-Stop status for a pane.
   *
   * Order matters and is intentional:
   *   1. `activeToolName === 'ExitPlanMode'` → `'plan-ready'`. ExitPlanMode is
   *      the canonical "plan presented, awaiting approval" signal — it comes
   *      straight from Claude Code's hook payload and is synchronous and
   *      lossless. We trust it without requiring `permissionMode === 'plan'`,
   *      because that field is populated by an async PTY-output scanner
   *      (`status-detector.ts`) that can lag or miss the mode footer. Gating
   *      plan-ready on the lossy detector when a lossless signal is on hand
   *      was the original bug.
   *   2. `permissionMode === 'plan'` (without ExitPlanMode) → `'planning'`.
   *      Mid-composition Stop in plan mode without a presented plan — rare,
   *      and only fires when the detector did catch the footer.
   *   3. Diff probe against the worktree → `'changes-ready'` if there are
   *      uncommitted edits or commits ahead of base.
   *   4. Otherwise → `'needs-input'`.
   */
  private async routeStopStatus(
    worktreePath: string,
    permissionMode: 'normal' | 'plan' | undefined,
    activeToolName: string | null
  ): Promise<PaneStatus> {
    if (activeToolName === 'ExitPlanMode') {
      return 'plan-ready'
    }
    if (permissionMode === 'plan') {
      return 'planning'
    }
    try {
      const gs = await getGitStatus(worktreePath)
      if (gs && (gs.hasUncommittedChanges || gs.commitsAhead > 0)) {
        return 'changes-ready'
      }
    } catch (err) {
      console.warn('[hook-listener] diff probe failed for', worktreePath, err)
      // Fall through to needs-input — safer than misrouting on a transient
      // git error.
    }
    return 'needs-input'
  }

  /**
   * Deliver a deferred tool-verb update when the MIN_TOOL_DISPLAY_MS hold
   * expires. The pending value is whatever the most recent hook event
   * coalesced during the hold window; the status comes from the current
   * pane state (any status change would have cancelled this timer).
   */
  private fireHeldToolUpdate(paneId: string): void {
    const timing = this.toolDisplayTiming.get(paneId)
    if (!timing || timing.pendingTimer === null) return

    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) {
      this.toolDisplayTiming.delete(paneId)
      return
    }

    const win = this.windowManager.getWindow(pane.windowId)
    if (!win || win.isDestroyed()) {
      timing.pendingTimer = null
      timing.pendingTool = null
      return
    }

    const heldTool = timing.pendingTool
    const payload: PaneStatusPayload = {
      paneId,
      status: pane.status,
      activeToolName: heldTool,
      source: 'hook'
    }
    win.webContents.send(IPC.PANE_STATUS, payload)
    this.workspaceManager?.pushManagerUpdate()

    timing.displayedAt = Date.now()
    timing.pendingTimer = null
    timing.pendingTool = null
  }
}
