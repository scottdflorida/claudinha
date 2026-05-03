import type { PaneState, PaneStatus } from '../shared/types'
import type { SessionRegistry } from './session-registry'
import type { PtyPool } from './pty-pool'
import { worktreePathToRepoPath } from './repo-path'
import {
  trackPlanSequenceStarted,
  trackPlanSequenceCompleted,
  type PlanSequenceOutcome
} from './analytics/plan-sequence-instrumentation'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Delay between the `PreToolUse` hook landing (which flips `activeToolName`
 * to `ExitPlanMode`) and writing our approval keystrokes. The hook precedes
 * the PTY render of Claude Code's picker; sending keystrokes into a
 * half-rendered picker risks them landing in the wrong input buffer.
 */
const PICKER_SETTLE_DELAY_MS = 200

/**
 * Keystrokes that select Claude Code's "Yes, and use auto mode" option in
 * its plan-approval picker and confirm. As of the picker format observed
 * on 2026-04-24, the options are:
 *   1. Yes, and use auto mode
 *   2. Yes, manually approve edits
 *   3. No, refine with Ultraplan on Claude Code on the web
 *   4. Tell Claude what to change
 * Option 1 is the auto-accept path the sequence button promises. Digit +
 * Enter is more stable against picker reorderings than arrow+Enter.
 */
const APPROVE_KEYSTROKES = '1\r'

/**
 * Safety watchdog. If a pane's approved run never transitions off `working`
 * within this window, we assume it's hung and advance the queue rather than
 * blocking forever.
 */
const WATCHDOG_TIMEOUT_MS = 30 * 60 * 1_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SequenceState = 'idle' | 'running' | 'stopping'

interface RepoSequenceContext {
  workspaceId: string
  repoPath: string
  state: SequenceState
  /** Pane IDs that have already been sent the approval keystroke in this run. */
  approved: Set<string>
  /** Queue of pane IDs still to approve. */
  queue: string[]
  /** ID of the pane whose run we are currently waiting on (null while idle / between panes). */
  currentPaneId: string | null
  /** Unsubscribe for the in-flight onNextStatusChange subscription. */
  unsubscribeCurrent: (() => void) | null
  /** Watchdog timer clearing on completion or cancellation. */
  watchdog: ReturnType<typeof setTimeout> | null
  /** Fires whenever the sequencer's externally visible state changes. */
  onStateChange: () => void
  /**
   * Terminal-outcome hint used to pick the analytics event's outcome when the
   * sequence ends. `'stopping'` means the user clicked Stop; `'watchdog'` means
   * a watchdog fired; otherwise the natural drain path reports 'succeeded'.
   */
  terminalOutcome: PlanSequenceOutcome | null
}

/**
 * Predicate: is a pane currently sitting on Claude Code's plan-approval
 * picker? Now a direct status check — the new `'plan-ready'` status is set
 * by the hook router whenever a Stop event arrives in plan mode with
 * `activeToolName === 'ExitPlanMode'`.
 */
export function isPaneAwaitingPlanApproval(pane: PaneState): boolean {
  return pane.status === 'plan-ready'
}

/**
 * Mirror the inspector's repo rollup grouping so the sequencer picks up the
 * same panes the UI sees grouped under a given repo card.
 */
function normaliseRepoPath(worktreePath: string): string {
  return worktreePathToRepoPath(worktreePath)
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * PlanApprovalSequencer — serialises "approve the pending plan and let the
 * agent implement" across every tree in a single repo.
 *
 * One click on the repo-card button seeds a queue of panes sitting on
 * Claude Code's plan-approval picker. For each queued pane we send
 * `2\r` (which is Claude Code's "Yes, and auto-accept edits" option),
 * then wait for that pane's run to leave `working` for any terminal state
 * (`done`, `needs-input`, `error`, `awaiting-prompt`). When the current
 * pane finishes we re-scan the repo — so a pane that only reaches the
 * picker partway through the sequence joins the queue automatically —
 * and approve the next. The run ends when the re-scan turns up nothing.
 *
 * Only one queue per `(workspaceId, repoPath)` runs at a time. Starting a
 * second run on a repo that's already sequencing is a no-op.
 */
export class PlanApprovalSequencer {
  private readonly contexts = new Map<string, RepoSequenceContext>()

  constructor(
    private readonly sessionRegistry: SessionRegistry,
    private readonly ptyPool: PtyPool
  ) {}

  /**
   * Hook invoked by the inspector to project sequencer state onto each
   * `RepoRollup` in the workspace summary. Must be sync and cheap — it is
   * called during every summary build.
   */
  isRunning(workspaceId: string, repoPath: string): boolean {
    const ctx = this.contexts.get(this.contextKey(workspaceId, repoPath))
    return !!ctx && ctx.state === 'running'
  }

  /**
   * Start (or no-op when already running) a plan-approval sequence for a
   * repo. Collects every pane in the repo currently awaiting plan approval,
   * then begins processing. Returns the initial queue size.
   */
  start(
    workspaceId: string,
    repoPath: string,
    onStateChange: () => void
  ): { queuedCount: number } {
    const key = this.contextKey(workspaceId, repoPath)
    const existing = this.contexts.get(key)
    if (existing && existing.state !== 'idle') {
      // Already sequencing — just return how many are pending (current +
      // queued) for the renderer's optimistic feedback.
      const pending = (existing.currentPaneId ? 1 : 0) + existing.queue.length
      return { queuedCount: pending }
    }

    const paneIds = this.findAwaitingPanes(workspaceId, repoPath, new Set())
    if (paneIds.length === 0) {
      return { queuedCount: 0 }
    }

    const ctx: RepoSequenceContext = {
      workspaceId,
      repoPath,
      state: 'running',
      approved: new Set(),
      queue: paneIds,
      currentPaneId: null,
      unsubscribeCurrent: null,
      watchdog: null,
      onStateChange,
      terminalOutcome: null
    }
    this.contexts.set(key, ctx)
    trackPlanSequenceStarted()
    ctx.onStateChange()
    // Capture the seeded count BEFORE processNext, which shifts panes off
    // `ctx.queue` (the same array) as each is approved.
    const queuedCount = paneIds.length
    this.processNext(ctx)
    return { queuedCount }
  }

  /**
   * Clear pending approvals for a repo's sequence. The pane currently
   * approved (if any) is left to run to completion — we don't interrupt an
   * agent that's already mid-implementation.
   */
  stop(workspaceId: string, repoPath: string): void {
    const key = this.contextKey(workspaceId, repoPath)
    const ctx = this.contexts.get(key)
    if (!ctx) return
    ctx.queue = []
    // Flag the state so processNext (when the in-flight pane completes)
    // tears down instead of re-scanning for new work.
    if (ctx.state === 'running') {
      ctx.state = 'stopping'
      ctx.terminalOutcome = 'cancelled'
    }
    // If nothing is in flight, finish the teardown immediately.
    if (!ctx.currentPaneId) {
      this.teardown(ctx)
    } else {
      ctx.onStateChange()
    }
  }

  /**
   * Called from the pane-close path so the sequencer can abandon any
   * in-flight subscription on a pane that's just been terminated.
   */
  onPaneClosed(paneId: string): void {
    for (const ctx of this.contexts.values()) {
      if (ctx.currentPaneId !== paneId) continue
      this.clearCurrentSubscriptions(ctx)
      ctx.currentPaneId = null
      // Carry on with the rest of the queue.
      if (ctx.state === 'stopping') {
        this.teardown(ctx)
      } else {
        this.processNext(ctx)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal: per-pane processing loop
  // -------------------------------------------------------------------------

  private processNext(ctx: RepoSequenceContext): void {
    if (ctx.state === 'stopping') {
      this.teardown(ctx)
      return
    }

    // Pick the next pane. If the queue is empty, re-scan the registry for
    // panes that entered awaiting-plan-approval during the last run; they
    // join the queue here, satisfying "including if something arrived at
    // awaiting plan approval during this process."
    if (ctx.queue.length === 0) {
      const fresh = this.findAwaitingPanes(ctx.workspaceId, ctx.repoPath, ctx.approved)
      if (fresh.length === 0) {
        this.teardown(ctx)
        return
      }
      ctx.queue.push(...fresh)
    }

    const paneId = ctx.queue.shift()!
    ctx.currentPaneId = paneId
    ctx.approved.add(paneId)
    ctx.onStateChange()

    // Guard: re-read the pane immediately before writing. Catches the case
    // where the user manually approved the picker after clicking the button
    // (or the pane transitioned for some other reason). On mismatch, skip
    // and advance.
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane || !isPaneAwaitingPlanApproval(pane)) {
      console.log(
        `[plan-approval-sequencer] pane ${paneId} no longer awaiting plan approval — skipping`
      )
      ctx.currentPaneId = null
      this.processNext(ctx)
      return
    }

    // Give the PTY a moment to finish rendering the picker that `PreToolUse`
    // announced, then write the approval keystrokes.
    setTimeout(() => {
      if (ctx.state === 'stopping' || ctx.currentPaneId !== paneId) {
        // Stopped or raced; nothing to do.
        return
      }
      // Re-guard after the delay in case the pane moved on during the wait.
      const stillAwaiting = this.sessionRegistry.getPane(paneId)
      if (!stillAwaiting || !isPaneAwaitingPlanApproval(stillAwaiting)) {
        console.log(
          `[plan-approval-sequencer] pane ${paneId} moved off plan approval during settle delay — skipping`
        )
        ctx.currentPaneId = null
        this.processNext(ctx)
        return
      }
      if (!this.ptyPool.isAlive(paneId)) {
        console.log(
          `[plan-approval-sequencer] pane ${paneId} PTY not alive — skipping`
        )
        ctx.currentPaneId = null
        this.processNext(ctx)
        return
      }
      try {
        this.ptyPool.write(paneId, APPROVE_KEYSTROKES)
      } catch (err) {
        console.warn(`[plan-approval-sequencer] write failed for pane ${paneId}:`, err)
        ctx.currentPaneId = null
        this.processNext(ctx)
        return
      }
      this.subscribeForCompletion(ctx, paneId)
    }, PICKER_SETTLE_DELAY_MS)
  }

  /**
   * Wait for the approved pane's run to end. The first transition after
   * keystrokes is `needs-input → working` (Claude started implementing);
   * we re-subscribe on that so the advance happens only when work actually
   * ends. Any other transition — `done`, `needs-input`, `error`, or
   * `awaiting-prompt` — counts as terminal.
   *
   * A `needs-input` return with `activeToolName === 'ExitPlanMode'` is
   * treated as terminal too, not as "approve again": the user asked
   * Claude to replan, so the user should get to see it before we approve.
   */
  private subscribeForCompletion(ctx: RepoSequenceContext, paneId: string): void {
    const onTransition = (id: string, next: PaneStatus): void => {
      if (ctx.currentPaneId !== paneId) return
      if (next === 'working') {
        // Expected opening transition — re-subscribe for the ending one.
        ctx.unsubscribeCurrent = this.sessionRegistry.onNextStatusChange(id, onTransition)
        return
      }
      // Terminal for sequencer purposes.
      this.clearCurrentSubscriptions(ctx)
      ctx.currentPaneId = null
      if (ctx.state === 'stopping') {
        this.teardown(ctx)
      } else {
        this.processNext(ctx)
      }
    }
    ctx.unsubscribeCurrent = this.sessionRegistry.onNextStatusChange(paneId, onTransition)

    // Watchdog so a hung pane doesn't block the queue indefinitely.
    ctx.watchdog = setTimeout(() => {
      if (ctx.currentPaneId !== paneId) return
      console.warn(
        `[plan-approval-sequencer] watchdog fired for pane ${paneId} after ${WATCHDOG_TIMEOUT_MS} ms`
      )
      // Single watchdog trip taints the whole sequence's outcome so whatever
      // drain path follows reports 'watchdog_timeout'.
      if (ctx.terminalOutcome === null) ctx.terminalOutcome = 'watchdog_timeout'
      this.clearCurrentSubscriptions(ctx)
      ctx.currentPaneId = null
      if (ctx.state === 'stopping') {
        this.teardown(ctx)
      } else {
        this.processNext(ctx)
      }
    }, WATCHDOG_TIMEOUT_MS)
  }

  // -------------------------------------------------------------------------
  // Internal: teardown + helpers
  // -------------------------------------------------------------------------

  private teardown(ctx: RepoSequenceContext): void {
    this.clearCurrentSubscriptions(ctx)
    ctx.currentPaneId = null
    ctx.queue = []
    const wasRunning = ctx.state !== 'idle'
    ctx.state = 'idle'
    this.contexts.delete(this.contextKey(ctx.workspaceId, ctx.repoPath))
    if (wasRunning) {
      const outcome: PlanSequenceOutcome = ctx.terminalOutcome ?? 'succeeded'
      trackPlanSequenceCompleted(outcome, ctx.approved.size)
      ctx.onStateChange()
    }
  }

  private clearCurrentSubscriptions(ctx: RepoSequenceContext): void {
    if (ctx.unsubscribeCurrent) {
      ctx.unsubscribeCurrent()
      ctx.unsubscribeCurrent = null
    }
    if (ctx.watchdog) {
      clearTimeout(ctx.watchdog)
      ctx.watchdog = null
    }
  }

  private findAwaitingPanes(
    workspaceId: string,
    repoPath: string,
    exclude: ReadonlySet<string>
  ): string[] {
    const panes = this.sessionRegistry.getPanesForWorkspace(workspaceId)
    const matches: PaneState[] = []
    for (const pane of panes) {
      if (exclude.has(pane.id)) continue
      if (normaliseRepoPath(pane.worktreePath) !== repoPath) continue
      if (!isPaneAwaitingPlanApproval(pane)) continue
      matches.push(pane)
    }
    // Order by creation time so the visual top-to-bottom order in the repo
    // rail matches the approval order.
    matches.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    return matches.map((p) => p.id)
  }

  private contextKey(workspaceId: string, repoPath: string): string {
    return `${workspaceId}::${repoPath}`
  }
}
