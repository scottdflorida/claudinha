// MUST be first — side-effect import redirects the userData folder in dev so
// the dev process does not collide with an installed /Applications/Claudinha.app
// on the single-instance lock (see src/main/dev-mode.ts for the full why).
// Has to run before any code reads app.getPath('userData'), including the
// migration import below.
import './dev-mode'
// MUST run after './dev-mode' and before any electron-store consumer
// (app-config-store, workspace-store, permissions-store, session-history-store,
// etc.) is loaded — the migration copies legacy Claudio/ userData into the
// resolved Claudinha/ folder, and once a store's module-level `new Store(...)`
// runs, it has already decided whether the userData folder has state or not.
import './migrate-user-data'
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { fixPathForPackagedApp } from './fix-path'

// Restore the user's shell PATH for packaged macOS/Linux launches (Dock,
// /Applications, Spotlight) so claude, git, etc. are findable. No-op in
// dev and on Windows. Must run before the first spawn / claude:check.
fixPathForPackagedApp()
import { join } from 'node:path'
import { IPC } from '../shared/ipc-channels'
import type { WindowInitPayload } from '../shared/ipc-channels'
import { resolvePaneDisplayName } from '../shared/pane-display'
import { registerAnalyticsIpc, getInstallationId } from './analytics/analytics-config'
import { analyticsBus } from './analytics/analytics-bus'
import { initAnalyticsService, shutdownAnalyticsService } from './analytics/analytics-service'
import { trackWindowClosed, trackWindowCreated } from './analytics/usage-instrumentation'
import {
  trackAppLaunch,
  startMemorySnapshots,
  stopMemorySnapshots
} from './analytics/performance-instrumentation'
import { trackUnhandledError } from './analytics/error-instrumentation'
import { trackAppSessionStarted } from './analytics/system-instrumentation'
import { WindowManager } from './window-manager'
import { SessionRegistry } from './session-registry'
import { PtyPool } from './pty-pool'
import { HookListener } from './hook-listener'
import { PermissionsManager, healStaleWorktreeSettings } from './permissions-manager'
import { StatusDetector } from './status-detector'
import { MetricsCollector } from './metrics-collector'
import { PaneTransitionBuffer } from './pane-transition-buffer'
import { addSessionHistoryEntry } from './session-history-store'
import { registerIpcHandlers, checkClaudeInstalled } from './ipc-handlers'
import { buildMenu } from './menu'
import { getMenuStrings } from './menu-strings'
import { WorkspaceManager } from './workspace-manager'
import { migrateLegacyKeys, migrateCompletionActionsV2, migrateRemoveGeneralWorkspaces } from './workspace-store'
import { GitStatusPoller } from './git-status-poller'
import { CompletionExecutor } from './completion-executor'
import { TurnRecorder } from './turn-recorder'
import { SideCloneManager } from './side-clone-manager'
import { InspectorService } from './inspector'
import { PlanApprovalSequencer } from './plan-approval-sequencer'
import { getGlobalCompletionPolicy } from './completion-policy-store'
import { getAppConfig } from './app-config-store'
import { closePaneInternal } from './pane-lifecycle'

// ---------------------------------------------------------------------------
// Global error resilience (B-053)
// Prevents unhandled errors in one pane's handler from crashing the entire app.
// ---------------------------------------------------------------------------

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
  trackUnhandledError(err, 'main')
  // Do not re-throw — allow the app to continue running
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
  trackUnhandledError(reason, 'main')
  // Do not re-throw — allow the app to continue running
})

// ---------------------------------------------------------------------------
// Single-instance lock — prevent duplicate windows when relaunching
// ---------------------------------------------------------------------------

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
}

// ---------------------------------------------------------------------------
// One-time migrations. Must run before any consumer of workspace-store
// constructs (WorkspaceManager reads in ctor).
//
// `migrateLegacyKeys`: copies pre-Claudinha-rename `hives.*` keys forward.
// `migrateCompletionActionsV2`: strips deprecated `completionPolicy` field
//   from persisted workspaces and backfills `defaultPublishPath` (M0 of the
//   turn-as-commit completion-actions plan). Idempotent.
// ---------------------------------------------------------------------------

migrateLegacyKeys()
migrateCompletionActionsV2()
// Launcher rework: legacy `general`-type workspaces are gone.
migrateRemoveGeneralWorkspaces()

// ---------------------------------------------------------------------------
// Module-level singletons — created once, shared by all IPC handlers
// ---------------------------------------------------------------------------

export const windowManager = new WindowManager()
export const sessionRegistry = new SessionRegistry()
export const ptyPool = new PtyPool()
export const permissionsManager = new PermissionsManager()
export const statusDetector = new StatusDetector(sessionRegistry, windowManager)
// MetricsCollector constructed before HookListener so it can be passed in
export const metricsCollector = new MetricsCollector(sessionRegistry, windowManager)
export const hookListener = new HookListener(sessionRegistry, windowManager, metricsCollector)
export const transitionBuffer = new PaneTransitionBuffer()
export const workspaceManager = new WorkspaceManager(windowManager, sessionRegistry)
export const gitStatusPoller = new GitStatusPoller(sessionRegistry, windowManager)
export const completionExecutor = new CompletionExecutor(
  sessionRegistry,
  windowManager,
  gitStatusPoller,
  ptyPool,
  permissionsManager,
  statusDetector,
  metricsCollector,
  hookListener,
  transitionBuffer
)
export const inspector = new InspectorService(sessionRegistry, workspaceManager, windowManager)
export const planApprovalSequencer = new PlanApprovalSequencer(sessionRegistry, ptyPool)
// Completion-actions v2 — fires auto-commit on Stop hooks for worktree
// panes. Wired into hook-listener via `setOnStopProcessed` below; never
// blocks the hook path because Haiku summaries can take a few seconds.
export const turnRecorder = new TurnRecorder(sessionRegistry, windowManager)
// Side-clone manager — provisions per-repo `.worktrees/.merge-staging/`
// for direct-merge publishing (M4) and bulk merges (M5). Singleton; one
// instance owns every repo's mutex queue.
export const sideCloneManager = new SideCloneManager()

// Wire the bidirectional references that have to be set after
// construction to avoid a circular dep in the DI graph:
//   poller → executor (for auto-exec after git status update)
//   executor → workspaceManager (for effective-policy resolution)
//   poller → inspector (for cross-pane summary refresh)
//   inspector ↔ metricsCollector (per-pane diff-source unification)
//   hook-listener → inspector (for awaiting-plan-approval refresh)
//   inspector ← sequencer (so RepoRollup can carry the running flag)
gitStatusPoller.setCompletionExecutor(completionExecutor)
gitStatusPoller.setInspector(inspector)
inspector.setMetricsCollector(metricsCollector)
inspector.setPlanSequencerGetter((workspaceId, repoPath) =>
  planApprovalSequencer.isRunning(workspaceId, repoPath)
)
hookListener.setInspectorService(inspector)
metricsCollector.setInspector(inspector)
// Manager-window fan-out: each pane status / transcript-derived metric change
// also pushes a fresh manager state so active-workspace cards live-update.
statusDetector.setWorkspaceManager(workspaceManager)
hookListener.setWorkspaceManager(workspaceManager)
metricsCollector.setWorkspaceManager(workspaceManager)
// Keep the repo-pane status dots in sync with pane transitions. Both the
// hook path and the PTY fallback funnel through sessionRegistry.updatePaneStatus,
// so one listener here catches every transition. The inspector's
// summarySignature includes paneStatus per pane, so redundant rebroadcasts are
// suppressed automatically.
sessionRegistry.onAnyStatusChange((paneId) => {
  const pane = sessionRegistry.getPane(paneId)
  if (!pane) return
  inspector.broadcastSummary(pane.workspaceId)
})
completionExecutor.setWorkspaceManager(workspaceManager)
completionExecutor.setClosePaneHandler((paneId, extra) => {
  closePaneInternal(
    {
      sessionRegistry,
      windowManager,
      ptyPool,
      statusDetector,
      metricsCollector,
      gitStatusPoller,
      transitionBuffer,
      workspaceManager,
      inspector,
      planApprovalSequencer
    },
    paneId,
    extra
  )
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WINDOW_INIT wiring — buffer init payloads per window, send after RENDERER_READY
// (L-006: Electron IPC has no delivery guarantee before React effects run)
// ---------------------------------------------------------------------------

/**
 * Create a Manager window and register its WINDOW_INIT payload.
 */
/**
 * Cached result of checkClaudeInstalled(). Resolved the first time a manager
 * window is created and reused when a reloaded manager window needs its
 * `claudeFound` value synthesized — we don't want to re-run the detector on
 * every Cmd+R, and the answer won't change inside a single run anyway.
 */
let claudeFoundCache: boolean | null = null

function createManagerWindow(): BrowserWindow {
  const win = windowManager.createWindow({
    title: 'Claudinha Launcher',
    width: 900,
    height: 700
  })
  const winId = String(win.id)
  workspaceManager.setManagerWindowId(winId)
  if (claudeFoundCache === null) {
    claudeFoundCache = checkClaudeInstalled().found
  }
  workspaceManager.setPendingInit(winId, {
    windowType: 'manager',
    claudeFound: claudeFoundCache,
    globalCompletionPolicy: getGlobalCompletionPolicy()
  })
  return win
}

/**
 * Synthesize a WINDOW_INIT payload for a window whose renderer has reloaded
 * (`consumePendingInit` returned undefined, but the window is still tracked).
 * Covers manager and workspace windows. Returns null for unknown windows so
 * the caller can bail cleanly.
 *
 * Deliberately omits `terminalsToResume` — that field is only meaningful on
 * the first boot of a reactivated workspace; a mid-session reload must not
 * re-spawn terminals the user is already running.
 */
function buildReloadInitPayload(windowId: string): WindowInitPayload | null {
  if (workspaceManager.isManagerWindow(windowId)) {
    return {
      windowType: 'manager',
      claudeFound: claudeFoundCache ?? true,
      globalCompletionPolicy: getGlobalCompletionPolicy()
    }
  }
  const workspace = workspaceManager.getWorkspaceForWindow(windowId)
  if (!workspace) return null
  return {
    windowType: 'workspace',
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceType: workspace.type,
    workspaceConstraint: workspace.constraint,
    globalCompletionPolicy: getGlobalCompletionPolicy(),
    workspaceCompletionPolicy: workspace.completionPolicy ?? null,
    workspaceViewMode: workspace.viewMode ?? 'kanban',
    workspaceActivePaneId: workspace.activePaneId ?? null
  }
}

// When a second instance is attempted, focus the Manager window
app.on('second-instance', () => {
  if (workspaceManager.managerWindowId) {
    const win = windowManager.getWindow(workspaceManager.managerWindowId)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      return
    }
  }
  // Manager window doesn't exist — recreate it
  createManagerWindow()
})

function applyDockIcon(): void {
  if (!app.dock) return
  // In dev (npm run dev) use the badged "DEV" icon so the developer can
  // tell the dev process apart from an installed /Applications/Claudinha.app
  // running side by side. Production launches always use the plain icon.
  const iconFile = app.isPackaged ? 'icon.png' : 'icon-dev.png'
  const candidates = [
    join(app.getAppPath(), 'assets', 'icons', iconFile),
    join(__dirname, '..', '..', 'assets', 'icons', iconFile),
    join(process.cwd(), 'assets', 'icons', iconFile)
  ]
  console.log('[main] dock icon candidates:', candidates)
  for (const p of candidates) {
    const image = nativeImage.createFromPath(p)
    const size = image.getSize()
    console.log(`[main] dock icon probe ${p} — empty=${image.isEmpty()} size=${size.width}x${size.height}`)
    if (!image.isEmpty()) {
      app.dock.setIcon(image)
      console.log(`[main] dock icon set from ${p}`)
      return
    }
  }
  console.warn('[main] dock icon not set — no candidate loaded')
}

app.whenReady().then(() => {
  // macOS dev: the Dock icon otherwise shows the stock Electron icon, because
  // the Dock reads it from the .app bundle (which in dev is Electron's own).
  // Packaged macOS builds don't need this — electron-builder bakes the icon
  // into the bundle. No-op on Windows / Linux (app.dock is undefined).
  if (app.dock) {
    applyDockIcon()
    // Some dev-mode launches reset the Dock tile after the first window
    // appears; re-apply on window creation to stick.
    app.on('browser-window-created', () => {
      applyDockIcon()
    })
  }
  // Initialize analytics consent IPC (B-076) — must happen before window creation
  // so the renderer can query consent state on first paint.
  registerAnalyticsIpc()
  // Ensure installation ID is generated on first launch (stored in electron-store)
  getInstallationId()
  // Start analytics event bus (B-078) — recovers overflow from disk, starts flush timer
  analyticsBus.start()
  // Initialize analytics provider and wire it to the bus (B-079)
  initAnalyticsService().catch((err) => {
    console.error('[analytics] initAnalyticsService failed:', err?.message ?? err)
  })

  // Wire B-054: cancel fallback timer when first hook event arrives for a pane
  hookListener.setOnHookEvent((paneId) => statusDetector.cancelFallbackTimer(paneId))
  // Wire Stop → needs-input refinement: let hook listener consult recent PTY output
  hookListener.setStatusDetector(statusDetector)
  // Wire git status trigger: immediate check when terminal status changes to done/awaiting-prompt
  hookListener.setGitStatusPoller(gitStatusPoller)
  // Wire completion-actions v2 turn-recorder: fires auto-commit after Stop
  // routing. Fire-and-forget; turn-recorder.handleStop never throws.
  hookListener.setOnStopProcessed((paneId) => {
    void turnRecorder.handleStop(paneId)
  })

  hookListener.start()
  // Recover workspace state from any prior crash (active workspaces with no window → dormant)
  workspaceManager.recoverState()

  // Heal stale hook-relay paths in every known worktree's .claude/settings.json.
  // Picks up worktrees whose settings were written by an earlier install (e.g.
  // when the app lived at ~/Documents/orchard/) so those ghost absolute paths
  // stop flooding Claude Code with "No such file or directory" hook errors.
  {
    const worktreePaths: string[] = []
    for (const ws of workspaceManager.getAllWorkspaces()) {
      for (const t of ws.pausedTerminals) worktreePaths.push(t.worktreePath)
    }
    for (const [, pane] of sessionRegistry.getAllPanes()) worktreePaths.push(pane.worktreePath)
    healStaleWorktreeSettings(permissionsManager, worktreePaths)
  }

  registerIpcHandlers(windowManager, sessionRegistry, ptyPool, hookListener, permissionsManager, statusDetector, metricsCollector, transitionBuffer, workspaceManager, gitStatusPoller, completionExecutor, inspector, planApprovalSequencer, turnRecorder, sideCloneManager)

  // Build application menu bar (B-066)
  buildMenu(windowManager, sessionRegistry, workspaceManager)

  // Workspace / management close orchestration.
  //
  // On a workspace-window close: main sends CLOSE_WORKSPACE_SEQUENCE_START
  // and waits for the renderer to walk the user through one PaneCloseConfirmModal
  // per pane. The response ('cancel' | 'complete' | 'override-all') determines
  // what main does next.
  //
  // On a manager-window close: main iterates active workspaces, focusing each
  // in turn and driving the same sequence. Any 'cancel' aborts the orchestration
  // and leaves everything intact.
  //
  // Track per-window pending state so repeat close attempts (user keeps hitting
  // the traffic-light) don't spawn duplicate sequences.
  const pendingCloseConfirm = new Set<string>()
  const closeConfirmTimers = new Map<string, NodeJS.Timeout>()
  /** How long to wait for the renderer's sequence ack before falling back to a native dialog. */
  const CLOSE_CONFIRM_TIMEOUT_MS = 3000

  // Manager-close orchestration state. managerCloseQueue is a list of workspace
  // IDs still to be confirmed; when empty and managerCloseInFlight is true,
  // main destroys the manager window. managerCloseWindowId points at the
  // manager window being closed.
  let managerCloseInFlight = false
  let managerCloseWindowId: string | null = null
  const managerCloseQueue: string[] = []

  const cleanupPane = (pane: import('../shared/types').PaneState): void => {
    if (pane.sessionId) {
      addSessionHistoryEntry({
        sessionId: pane.sessionId,
        worktreePath: pane.worktreePath,
        repoName: pane.repoName,
        worktreeName: pane.worktreeName,
        sessionTitle: pane.metrics.sessionTitle,
        completedAt: Date.now()
      })
    }
    gitStatusPoller.unwatchPane(pane.id)
    statusDetector.deregisterPane(pane.id)
    metricsCollector.unwatchPane(pane.id)
    transitionBuffer.clear(pane.id)
    sessionRegistry.removePane(pane.id)
    ptyPool.kill(pane.id)
  }

  /** Destroy one active workspace window and deactivate its workspace record.
   *  Used by both the normal sequence-complete path and the override-all path. */
  function destroyWorkspaceWindow(windowId: string): void {
    const win = windowManager.getWindow(windowId)
    const workspace = workspaceManager.getWorkspaceForWindow(windowId)
    for (const pane of sessionRegistry.getPanesForWindow(windowId)) {
      cleanupPane(pane)
    }
    if (workspace) workspaceManager.deactivateWorkspace(workspace.id)
    workspaceManager.pushManagerUpdate()
    if (win && !win.isDestroyed()) win.destroy()
  }

  /** Build the pane descriptors the renderer needs to drive one modal per pane. */
  function buildSequencePanes(windowId: string): import('../shared/ipc-channels').CloseSequencePaneDescriptor[] {
    const panes = sessionRegistry.getPanesForWindow(windowId)
    return panes
      .filter((p) => !p.terminated)
      .map((pane) => ({
        paneId: pane.id,
        status: pane.status,
        isWorktree: pane.isWorktree,
        repoName: pane.repoName,
        agentName: resolvePaneDisplayName(pane),
        worktreeName: pane.worktreeName,
        branchName: pane.gitStatus?.branchName ?? null,
        hasUncommittedChanges: pane.gitStatus?.hasUncommittedChanges ?? false,
        changedFileCount: pane.gitStatus?.changedFileCount ?? 0,
        commitsAhead: pane.gitStatus?.commitsAhead ?? 0,
        isUntouched: pane.status === 'awaiting-prompt' && pane.metrics.totalTokens === null
      }))
  }

  /** Start a close sequence for one workspace window. Returns true if the
   *  sequence was kicked off (renderer will respond later); false if the
   *  fallback path fired instead (renderer dead / not found). */
  function startWorkspaceSequence(windowId: string, opts: { isManagerInitiated: boolean; managerProgress: { current: number; total: number } | null }): boolean {
    const win = windowManager.getWindow(windowId)
    if (!win || win.isDestroyed()) return false

    if (pendingCloseConfirm.has(windowId)) return false // already in flight

    const workspace = workspaceManager.getWorkspaceForWindow(windowId)
    const panes = buildSequencePanes(windowId)
    // Nothing to confirm — deactivate and close immediately.
    if (panes.length === 0) {
      destroyWorkspaceWindow(windowId)
      return false
    }

    pendingCloseConfirm.add(windowId)

    if (!windowManager.isRendererHealthy(windowId)) {
      showNativeCloseFallback(windowId, win, panes.length)
      return false
    }

    if (win.isMinimized()) win.restore()
    win.focus()
    const payload: import('../shared/ipc-channels').CloseWorkspaceSequenceStartPayload = {
      workspaceId: workspace?.id ?? '',
      workspaceName: workspace?.name ?? 'Workspace',
      panes,
      isManagerInitiated: opts.isManagerInitiated,
      managerProgress: opts.managerProgress
    }
    win.webContents.send(IPC.CLOSE_WORKSPACE_SEQUENCE_START, payload)
    closeConfirmTimers.set(
      windowId,
      setTimeout(() => {
        if (pendingCloseConfirm.has(windowId) && !win.isDestroyed()) {
          showNativeCloseFallback(windowId, win, panes.length)
        }
      }, CLOSE_CONFIRM_TIMEOUT_MS)
    )
    return true
  }

  function clearPendingCloseConfirm(windowId: string): void {
    pendingCloseConfirm.delete(windowId)
    const timer = closeConfirmTimers.get(windowId)
    if (timer) {
      clearTimeout(timer)
      closeConfirmTimers.delete(windowId)
    }
  }

  /** Native-dialog fallback — shown when the renderer is known dead or never
   *  acks the sequence start. Force-close-all semantics mirror the override-all
   *  code path (keep worktrees, no git ops). */
  function showNativeCloseFallback(windowId: string, win: BrowserWindow, activeSessionCount: number): void {
    if (win.isDestroyed()) {
      clearPendingCloseConfirm(windowId)
      return
    }
    const m = getMenuStrings(getAppConfig().language)
    dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons: [m.cancelButton, m.closeAnywayButton],
        defaultId: 0,
        cancelId: 0,
        message: m.notRespondingMessage,
        detail: m.notRespondingDetail(activeSessionCount)
      })
      .then(({ response }) => {
        clearPendingCloseConfirm(windowId)
        if (response === 1) {
          destroyWorkspaceWindow(windowId)
          // If this was a management-driven close, continue to the next workspace.
          if (managerCloseInFlight) continueManagerClose()
        } else if (managerCloseInFlight) {
          // Cancel aborts the whole management close.
          abortManagerClose()
        }
      })
      .catch(() => {
        clearPendingCloseConfirm(windowId)
      })
  }

  /** Kick off the next workspace in the manager-close queue. Called after
   *  each workspace finishes (or cancels) and when the orchestration starts. */
  function continueManagerClose(): void {
    if (!managerCloseInFlight) return
    const nextId = managerCloseQueue.shift()
    if (!nextId) {
      // All workspaces closed — destroy the manager.
      const managerId = managerCloseWindowId
      managerCloseInFlight = false
      managerCloseWindowId = null
      if (managerId) {
        const managerWin = windowManager.getWindow(managerId)
        if (managerWin && !managerWin.isDestroyed()) managerWin.destroy()
      }
      return
    }
    const workspace = workspaceManager.getWorkspace(nextId)
    const windowId = workspace?.windowId
    if (!windowId) {
      // Workspace already detached somehow — just move on.
      continueManagerClose()
      return
    }
    const total = managerCloseQueue.length + 1 + (managerCloseTotalClosedSoFar)
    const current = managerCloseTotalClosedSoFar + 1
    managerCloseTotalClosedSoFar = current
    startWorkspaceSequence(windowId, {
      isManagerInitiated: true,
      managerProgress: { current, total: managerCloseTotal }
    })
  }

  let managerCloseTotalClosedSoFar = 0
  let managerCloseTotal = 0

  /** Abort the manager-close orchestration. Re-focuses the manager window and
   *  leaves every workspace intact. */
  function abortManagerClose(): void {
    const managerId = managerCloseWindowId
    managerCloseInFlight = false
    managerCloseWindowId = null
    managerCloseQueue.length = 0
    managerCloseTotalClosedSoFar = 0
    managerCloseTotal = 0
    if (managerId) {
      const managerWin = windowManager.getWindow(managerId)
      if (managerWin && !managerWin.isDestroyed()) {
        if (managerWin.isMinimized()) managerWin.restore()
        managerWin.focus()
      }
    }
  }

  windowManager.setCloseInterceptor((windowId, win) => {
    // Manager window close with active workspaces → orchestrate per-workspace sequences.
    if (workspaceManager.isManagerWindow(windowId)) {
      const activeWorkspaces = workspaceManager.getActiveWorkspaces()
      if (activeWorkspaces.length === 0) return true // nothing open, let the manager close

      if (managerCloseInFlight) return false // already mid-orchestration

      // Sort by last-active so the most-recent workspace prompts first.
      const sorted = [...activeWorkspaces].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      managerCloseInFlight = true
      managerCloseWindowId = windowId
      managerCloseQueue.length = 0
      for (const w of sorted) managerCloseQueue.push(w.id)
      managerCloseTotal = sorted.length
      managerCloseTotalClosedSoFar = 0

      if (win.isMinimized()) win.restore()
      win.focus()
      // Kick off — continueManagerClose shifts the first id and starts its sequence.
      continueManagerClose()
      return false
    }

    // Workspace window close — no active panes? deactivate and allow.
    const panes = sessionRegistry.getPanesForWindow(windowId)
    const activePanes = panes.filter((p) => !p.terminated)
    if (activePanes.length === 0) {
      const workspace = workspaceManager.getWorkspaceForWindow(windowId)
      if (workspace) workspaceManager.deactivateWorkspace(workspace.id)
      workspaceManager.pushManagerUpdate()
      return true
    }

    // Active panes — run the sequence. Response handler (below) destroys the
    // window on complete/override-all and simply clears state on cancel.
    startWorkspaceSequence(windowId, { isManagerInitiated: false, managerProgress: null })
    return false
  })

  // Renderer ack: the overlay has rendered. Cancel the fallback timer.
  ipcMain.on(IPC.CLOSE_WORKSPACE_SEQUENCE_ACK, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const windowId = String(win.id)
    const timer = closeConfirmTimers.get(windowId)
    if (timer) {
      clearTimeout(timer)
      closeConfirmTimers.delete(windowId)
    }
  })

  // Renderer response: the user either walked every pane, hit the override,
  // or cancelled the sequence.
  ipcMain.on(IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE, (event, payload: import('../shared/ipc-channels').CloseWorkspaceSequenceResponsePayload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const windowId = String(win.id)
    clearPendingCloseConfirm(windowId)

    if (payload.action === 'cancel') {
      if (managerCloseInFlight) abortManagerClose()
      return
    }

    if (payload.action === 'override-all') {
      // Close every remaining pane in this workspace with keep-worktree semantics
      // (no git ops) so sessions remain resumable from Management.
      destroyWorkspaceWindow(windowId)
      if (managerCloseInFlight) continueManagerClose()
      return
    }

    // 'complete' — renderer already executed per-pane close IPCs. Destroy
    // the window and optionally move on to the next manager-orchestrated
    // workspace.
    destroyWorkspaceWindow(windowId)
    if (managerCloseInFlight) continueManagerClose()
  })

  // ---------------------------------------------------------------------------
  // RENDERER_READY handler — send buffered WINDOW_INIT to the renderer
  // ---------------------------------------------------------------------------

  ipcMain.on(IPC.RENDERER_READY, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const winId = String(win.id)
    // A fresh renderer cannot have a live close-sequence overlay, so any
    // stale "confirmation in flight" flag from a prior renderer instance
    // (HMR crash, manual reload) must be cleared — otherwise the next Cmd+W
    // silently returns false and the window becomes uncloseable. Also cancels
    // any armed fallback timer for that window.
    clearPendingCloseConfirm(winId)
    // First boot → consume the pre-registered payload (carries
    // `terminalsToResume` when this is a reactivated workspace).
    // Reload (Cmd+R, crash+recover, Fast-Refresh of App) → the pending init
    // was already consumed on first boot. Rebuild a fresh payload from the
    // current workspace/manager state so App.tsx can re-mount its shell
    // instead of showing its `!windowInit` black screen.
    const initPayload = workspaceManager.consumePendingInit(winId) ?? buildReloadInitPayload(winId)
    if (initPayload) {
      win.webContents.send(IPC.WINDOW_INIT, initPayload)

      if (initPayload.windowType === 'manager') {
        // Push manager state — idempotent at useManagerState, safe on reload.
        const state = workspaceManager.buildManagerState()
        win.webContents.send(IPC.MANAGER_STATE_UPDATE, state)
      } else if (initPayload.windowType === 'workspace' && initPayload.workspaceId) {
        // Push dormant terminals list for the workspace window — idempotent
        // at useWorkspaceState, safe on reload.
        const workspace = workspaceManager.getWorkspace(initPayload.workspaceId)
        if (workspace && workspace.pausedTerminals.length > 0) {
          win.webContents.send(IPC.WORKSPACE_PAUSED_UPDATE, {
            workspaceId: workspace.id,
            pausedTerminals: workspace.pausedTerminals
          })
        }
      }
    }
  })

  // System telemetry — once per app launch, before first window.
  trackAppSessionStarted()

  // Launch Manager window as the app's entry point
  const managerWindow = createManagerWindow()
  trackWindowCreated('startup', windowManager.count)
  trackAppLaunch(managerWindow)
  startMemorySnapshots(() => sessionRegistry.paneCount)

  // Honor AppConfig.autoRestoreLastSession — if the user opted in, activate
  // the most recently closed dormant workspace right after the manager window
  // comes up. Mirrors the WORKSPACE_RESUME_LAST IPC handler so the behavior is
  // identical to clicking "Resume Last Session" manually.
  try {
    const cfg = getAppConfig()
    if (cfg.autoRestoreLastSession) {
      const dormant = workspaceManager.getDormantWorkspaces()
      if (dormant.length > 0) {
        const target = [...dormant].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
        // Gate activation on whether any terminal will actually pass the resume
        // filter. Opening a workspace window with nothing to put in it produces the
        // empty-workspace bug (see L-017). The same filter applied to result.terminalsToResume
        // below must gate the activateWorkspace call itself.
        const hasResumable = target.pausedTerminals.some(
          (d) => d.wasActiveAtClose && d.sessionId
        )
        if (hasResumable) {
          const result = workspaceManager.activateWorkspace(target.id)
          if (result) {
            const pendingInit = workspaceManager.consumePendingInit(result.windowId)
            if (pendingInit) {
              pendingInit.terminalsToResume = result.terminalsToResume.filter((d) => d.sessionId)
              workspaceManager.setPendingInit(result.windowId, pendingInit)
            }
            workspaceManager.pushManagerUpdate()
            trackWindowCreated('resume-last', windowManager.count)
          }
        }
      }
    }
  } catch (err) {
    console.warn('[startup] auto-restore failed:', err)
  }

  // Track window closures (B-080)
  windowManager.onWindowClose((windowId) => {
    const hasActive = sessionRegistry.getPanesForWindow(windowId).some(
      (p) => p.status !== 'awaiting-prompt' && !p.terminated
    )
    trackWindowClosed(hasActive, windowManager.count)

    // Clean up manager window tracking
    if (workspaceManager.isManagerWindow(windowId)) {
      workspaceManager.setManagerWindowId('')
    }
  })

  // macOS: recreate the Manager window when the dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (windowManager.count === 0) {
      createManagerWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Quit on all platforms, including macOS. For a terminal workspace app there
  // is no useful state to preserve when all windows are closed (PTYs are
  // already cleaned up). Staying alive on macOS caused the `activate` event
  // to fire immediately after the last window was destroyed, which created a
  // new empty window before the user could even see the dock.
  app.quit()
})

// ---------------------------------------------------------------------------
// App shutdown — deferred PTY kill to avoid destroying sessions before the
// user confirms via the close modal.
//
// Before this fix, before-quit unconditionally called ptyPool.killAll(),
// which killed all PTY processes BEFORE the close confirmation modal appeared.
// The user would see the modal with all sessions already dead.
//
// Now: before-quit only kills PTYs when no active sessions need confirmation.
// If active sessions exist, PTY cleanup is deferred to:
//   (a) the CLOSE_WORKSPACE_SEQUENCE_RESPONSE handler (per-window), or
//   (b) the will-quit handler (safety net after all windows close).
// ---------------------------------------------------------------------------

let didShutdown = false
function performShutdown(): void {
  if (didShutdown) return
  didShutdown = true
  ptyPool.killAll()
  hookListener.stop()
  gitStatusPoller.dispose()
  stopMemorySnapshots()
  analyticsBus.shutdown().catch(() => {/* ignore */})
  shutdownAnalyticsService().catch(() => {/* ignore */})
}

app.on('before-quit', () => {
  // Check whether any window has active sessions requiring confirmation.
  // If so, do NOT kill PTYs — the close interceptor will show a modal and
  // PTYs will be killed per-window when the user confirms.
  for (const [id] of windowManager.getAllWindows()) {
    const panes = sessionRegistry.getPanesForWindow(id)
    if (panes.some((p) => p.status !== 'awaiting-prompt' && !p.terminated)) {
      // Active sessions exist — defer PTY cleanup to confirmation flow
      return
    }
  }
  // No active sessions — safe to shut down immediately
  performShutdown()
})

// Safety net: will-quit fires after all windows have been closed (user confirmed
// or no active sessions). Ensures PTYs and services are cleaned up even if
// the per-window cleanup in CLOSE_WORKSPACE_SEQUENCE_RESPONSE was bypassed.
app.on('will-quit', () => {
  performShutdown()
})
