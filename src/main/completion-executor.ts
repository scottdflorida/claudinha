import type { MergeStrategy, CompletionActionStatus, PaneState, PaneStatus, CompletionPolicy } from '../shared/types'
import { IPC } from '../shared/ipc-channels'
import type { CompletionStatusPayload, PaneResolvingConflictPayload, PaneStatusPayload } from '../shared/ipc-channels'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import type { GitStatusPoller } from './git-status-poller'
import type { PtyPool } from './pty-pool'
import type { PermissionsManager } from './permissions-manager'
import type { StatusDetector } from './status-detector'
import type { MetricsCollector } from './metrics-collector'
import type { HookListener } from './hook-listener'
import type { PaneTransitionBuffer } from './pane-transition-buffer'
import type { WorkspaceManager } from './workspace-manager'
import { MergeQueue, type MergeQueueEntry } from './merge-queue'
import { getGlobalCompletionPolicy } from './completion-policy-store'
import { trackMergeCompleted, trackPrOpened } from './analytics/completion-instrumentation'
import {
  gitCommitAll,
  getMainRepoPath,
  isWorkingTreeClean,
  listChangedFiles,
  detectMainBranch,
  getCurrentBranch,
  gitRebase,
  gitRebaseAbort,
  gitMergeFf,
  gitMergeSquash,
  gitMergeNoFf,
  gitMergeAbort,
  gitPush,
  ghCreatePr,
  ghCliAvailable,
  isRebaseInProgress,
  gitWorktreeRemove,
  gitBranchDelete
} from './git-status'

/** Timeout for waiting for Claude to reach 'awaiting-prompt' after respawn */
const RESUME_WAIT_TIMEOUT_MS = 30_000

/**
 * Prompt injected into a resumed Claude session to ask it to resolve a
 * rebase conflict. Sent to the PTY's stdin once Claude is idle.
 */
const CONFLICT_RESOLUTION_PROMPT =
  'Claudinha paused a rebase because of merge conflicts while trying to merge this branch into main. ' +
  'Please resolve all conflicts in the affected files, stage them with `git add`, and run `git rebase --continue`. ' +
  'If you cannot resolve them cleanly, run `git rebase --abort` and explain what you found.'

/**
 * CompletionExecutor — orchestrates merge and PR flows for worktree panes.
 *
 * When a pane reaches 'done' with commits ahead of the base branch, this
 * executor handles the full merge or PR lifecycle: auto-commit, pre-checks,
 * strategy execution, status broadcasting, per-repo merge serialization
 * via {@link MergeQueue}, and Claude-assisted conflict resolution.
 */
export class CompletionExecutor {
  /**
   * Per-repo merge queue. Serializes merges for the same repo and pauses
   * on conflicts until they're resolved.
   */
  private readonly mergeQueue: MergeQueue

  /**
   * Pane IDs with an active merge (or queued merge) in flight. Used to
   * reject duplicate executeMerge calls for the same pane.
   */
  private readonly activeOperations = new Set<string>()

  /**
   * Pane IDs that have already been evaluated for auto-execution during
   * their current 'done' cycle. Cleared when a pane leaves 'done' (detected
   * lazily in `evaluateCompletion`). Prevents re-triggering auto-merge on
   * subsequent git status polls after the user dismissed the action bar or
   * the merge already fired.
   */
  private readonly evaluatedPanes = new Set<string>()

  /**
   * WorkspaceManager is optional at construction to avoid a circular dep between
   * WorkspaceManager and CompletionExecutor. Set via {@link setWorkspaceManager} in
   * index.ts after both singletons are constructed.
   */
  private workspaceManager: WorkspaceManager | null = null

  /**
   * Callback to close a pane completely. Wired from index.ts after
   * construction so we don't pull the pane-lifecycle dependency graph into
   * the executor's constructor. Used by the auto-close-after-merge flow.
   */
  private closePane: ((paneId: string, extra?: {
    snapshotExtras?: { completionAction?: 'merged' | 'pr-created' | 'manual-close'; prUrl?: string }
  }) => void) | null = null

  /**
   * Timers scheduled for auto-close after a successful merge. Keyed by
   * paneId so we can cancel if the pane is already torn down for other
   * reasons (user close, terminated, workspace deactivation).
   */
  private autoCloseTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly sessionRegistry: SessionRegistry,
    private readonly windowManager: WindowManager,
    private readonly gitStatusPoller: GitStatusPoller,
    private readonly ptyPool: PtyPool,
    private readonly permissionsManager: PermissionsManager,
    private readonly statusDetector: StatusDetector,
    private readonly metricsCollector: MetricsCollector,
    private readonly hookListener: HookListener,
    private readonly transitionBuffer: PaneTransitionBuffer
  ) {
    this.mergeQueue = new MergeQueue(async (entry) => {
      // The processor is responsible for catching its own errors and always
      // eventually calling mergeQueue.complete() or mergeQueue.pause() so the
      // queue advances. We still return the promise so the queue can back
      // the per-entry completion handle.
      await this.processQueuedMerge(entry)
    })
  }

  /** Wire WorkspaceManager after construction (breaks a circular dep in index.ts). */
  setWorkspaceManager(workspaceManager: WorkspaceManager): void {
    this.workspaceManager = workspaceManager
  }

  /**
   * Wire the close-pane handler after construction. The handler receives
   * the paneId and optional snapshot metadata (e.g. completionAction,
   * prUrl) to attach to the dormant terminal snapshot.
   */
  setClosePaneHandler(
    fn: (paneId: string, extra?: {
      snapshotExtras?: { completionAction?: 'merged' | 'pr-created' | 'manual-close'; prUrl?: string }
    }) => void
  ): void {
    this.closePane = fn
  }

  // ---------------------------------------------------------------------------
  // Policy resolution + auto-execution (Phase 3)
  // ---------------------------------------------------------------------------

  /**
   * Resolve the effective completion policy for a pane. Prefers the pane's
   * workspace-level override; falls back to the global policy; falls back to the
   * hard-coded default.
   */
  getEffectivePolicy(pane: PaneState): CompletionPolicy {
    const workspace = this.workspaceManager?.getWorkspace(pane.workspaceId)
    if (workspace?.completionPolicy) return workspace.completionPolicy
    return getGlobalCompletionPolicy()
  }

  /**
   * Called by the git status poller whenever a pane's git status has
   * changed. If the pane just became eligible for a completion action and
   * the effective policy is non-ask, this fires off the corresponding
   * merge / PR automatically.
   *
   * Eligibility criteria:
   * - pane is 'done'
   * - pane is a worktree
   * - branch is NOT main/master
   * - commits ahead > 0 (there's something to integrate)
   * - no in-flight completionActionStatus (fresh done cycle)
   * - hasn't already been evaluated in this done cycle
   */
  evaluateCompletion(paneId: string): void {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) {
      this.evaluatedPanes.delete(paneId)
      return
    }

    // Lazily clear the "already evaluated" flag when the pane leaves 'done'.
    if (pane.status !== 'done') {
      this.evaluatedPanes.delete(paneId)
      return
    }

    if (!pane.isWorktree) return
    if (pane.terminated) return

    const git = pane.gitStatus
    if (!git) return
    if (git.commitsAhead === 0 && !git.hasUncommittedChanges) return
    if (git.branchName === 'main' || git.branchName === 'master') return

    // Idempotency: don't re-fire within the same done cycle.
    if (this.evaluatedPanes.has(paneId)) return
    if (pane.completionActionStatus !== null) {
      // Already acting on it (possibly from a previous call on this cycle).
      this.evaluatedPanes.add(paneId)
      return
    }

    this.evaluatedPanes.add(paneId)

    const policy = this.getEffectivePolicy(pane)
    if (policy.action === 'ask') return // keep the bar visible, wait for user

    // Auto-exec. Kick off the relevant flow without awaiting — the UI picks
    // it up via broadcasts.
    if (policy.action === 'auto-merge') {
      void this.executeMerge(paneId, policy.mergeStrategy)
      return
    }
    if (policy.action === 'auto-pr') {
      void this.autoExecutePr(paneId, false)
      return
    }
    if (policy.action === 'auto-draft-pr') {
      void this.autoExecutePr(paneId, true)
    }
  }

  /**
   * Fire an auto-PR, falling back to 'ready' + error message if gh CLI is
   * not available. We don't want a misconfigured environment to silently
   * eat the user's work.
   */
  private async autoExecutePr(paneId: string, draft: boolean): Promise<void> {
    try {
      // Runtime check — cheaper than the whole executePr flow if gh is
      // missing. ghCliAvailable is fast (a single `gh auth status` exec).
      const available = await ghCliAvailable()
      if (!available) {
        this.broadcastStatus(paneId, {
          state: 'error',
          errorMessage: 'Auto-PR policy requires gh CLI. Install gh and re-authenticate.'
        })
        return
      }
      await this.executePr(paneId, draft)
    } catch (err) {
      this.broadcastStatus(paneId, {
        state: 'error',
        errorMessage: err instanceof Error ? err.message : String(err)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  /**
   * Execute a merge for a single pane using the specified strategy.
   * If another merge is already in progress for the same repo, this pane is
   * enqueued and the action bar shows 'queued' until its turn comes up.
   */
  async executeMerge(
    paneId: string,
    strategy: MergeStrategy
  ): Promise<{ error: string | null }> {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return { error: 'Pane not found.' }
    if (pane.status !== 'done') return { error: 'Pane is not in done state.' }
    if (!pane.isWorktree) return { error: 'Pane is not a worktree.' }
    if (this.activeOperations.has(paneId)) return { error: 'Operation already in progress.' }

    // Resolve the main repo root up front — the queue is keyed by it.
    const repoRoot = await getMainRepoPath(pane.worktreePath)
    if (!repoRoot) {
      this.broadcastStatus(paneId, { state: 'error', errorMessage: 'Could not determine main repository path.' })
      return { error: 'Could not determine main repository path.' }
    }

    this.activeOperations.add(paneId)

    const entry: MergeQueueEntry = {
      paneId,
      strategy,
      repoRoot,
      enqueuedAt: Date.now()
    }

    const { position, active, completion } = this.mergeQueue.enqueue(entry)
    if (!active) {
      // Queued behind an in-progress merge. Tell the user where they are.
      this.broadcastStatus(paneId, { state: 'queued', queuePosition: position })
      // For queued entries the IPC return is immediate — the UI drives off
      // the broadcast sequence. We intentionally DON'T await `completion`
      // here because that would block the renderer's ipcInvoke until the
      // upstream merge finishes.
      return { error: null }
    }

    // Active slot: await the actual processing so the return value reflects
    // the outcome of THIS merge. The processor always completes (success,
    // error, conflict, or dirty-main) and broadcasts status along the way.
    await completion

    // Surface a terminal error in the return value when applicable.
    const finalPane = this.sessionRegistry.getPane(paneId)
    const finalState = finalPane?.completionActionStatus?.state
    if (finalState === 'conflict') {
      return { error: 'Merge conflict during rebase.' }
    }
    if (finalState === 'dirty-main') {
      return { error: 'main has uncommitted changes' }
    }
    if (finalState === 'error') {
      return { error: finalPane?.completionActionStatus?.errorMessage ?? 'Merge failed.' }
    }
    return { error: null }
  }

  /**
   * Processes a single queued merge entry. Called by MergeQueue either
   * immediately (if the repo slot is free) or after the previous entry
   * completed. Always either completes or pauses the queue before returning.
   */
  private async processQueuedMerge(entry: MergeQueueEntry): Promise<void> {
    const { paneId, strategy, repoRoot } = entry
    try {
      const pane = this.sessionRegistry.getPane(paneId)
      if (!pane) {
        this.mergeQueue.complete(paneId)
        return
      }
      if (pane.status !== 'done') {
        this.broadcastStatus(paneId, { state: 'error', errorMessage: 'Pane is no longer in done state.' })
        this.mergeQueue.complete(paneId)
        return
      }

      // 1. Auto-commit uncommitted changes in the worktree
      if (pane.gitStatus?.hasUncommittedChanges) {
        this.broadcastStatus(paneId, { state: 'merging' })
        const commitErr = await gitCommitAll(pane.worktreePath, 'claudinha: auto-commit before merge')
        if (commitErr) {
          this.broadcastStatus(paneId, { state: 'error', errorMessage: `Auto-commit failed: ${commitErr}` })
          this.mergeQueue.complete(paneId)
          return
        }
      }

      // 2. Check main working pane is clean
      const mainClean = await isWorkingTreeClean(repoRoot)
      if (!mainClean) {
        const { files, totalCount } = await listChangedFiles(repoRoot)
        this.broadcastStatus(paneId, {
          state: 'dirty-main',
          dirtyMain: { path: repoRoot, files, totalCount }
        })
        // Free the queue slot — the user can retry after cleaning main.
        this.mergeQueue.complete(paneId)
        return
      }

      // 3. Detect base branch
      const baseBranch = await detectMainBranch(pane.worktreePath)
      if (!baseBranch) {
        this.broadcastStatus(paneId, { state: 'error', errorMessage: 'Could not detect main/master branch.' })
        this.mergeQueue.complete(paneId)
        return
      }

      // 4. Get current branch name
      const branchName = await getCurrentBranch(pane.worktreePath)
      if (!branchName) {
        this.broadcastStatus(paneId, { state: 'error', errorMessage: 'Could not determine current branch.' })
        this.mergeQueue.complete(paneId)
        return
      }

      // 5. Execute strategy
      let mergeErr: string | null = null

      if (strategy === 'rebase-ff') {
        // Rebase in worktree, then ff merge in main repo
        this.broadcastStatus(paneId, { state: 'rebasing' })
        const rebaseErr = await gitRebase(pane.worktreePath, baseBranch)
        if (rebaseErr) {
          const isConflict = rebaseErr.toLowerCase().includes('conflict')
          if (isConflict) {
            this.broadcastStatus(paneId, { state: 'conflict' })
            trackMergeCompleted('paused_conflict', strategy)
            // Pause the queue for this repo — subsequent merges are very
            // likely to hit the same conflict surface until this one resolves.
            this.mergeQueue.pause(repoRoot)
            this.mergeQueue.complete(paneId) // free the active slot, queue stays paused
            return
          }
          this.broadcastStatus(paneId, { state: 'error', errorMessage: `Rebase failed: ${rebaseErr}` })
          trackMergeCompleted('failed', strategy)
          this.mergeQueue.complete(paneId)
          return
        }

        this.broadcastStatus(paneId, { state: 'merging' })
        mergeErr = await gitMergeFf(repoRoot, branchName)
      } else if (strategy === 'squash') {
        this.broadcastStatus(paneId, { state: 'merging' })
        const sessionTitle = pane.metrics.sessionTitle || branchName
        mergeErr = await gitMergeSquash(repoRoot, branchName, `squash: ${sessionTitle}`)
      } else if (strategy === 'merge-commit') {
        this.broadcastStatus(paneId, { state: 'merging' })
        mergeErr = await gitMergeNoFf(repoRoot, branchName)
      }

      if (mergeErr) {
        const isConflict = mergeErr.toLowerCase().includes('conflict')
        if (isConflict) {
          this.broadcastStatus(paneId, { state: 'conflict' })
          trackMergeCompleted('paused_conflict', strategy)
          this.mergeQueue.pause(repoRoot)
          this.mergeQueue.complete(paneId)
          return
        }
        this.broadcastStatus(paneId, { state: 'error', errorMessage: `Merge failed: ${mergeErr}` })
        trackMergeCompleted('failed', strategy)
        this.mergeQueue.complete(paneId)
        return
      }

      // 6. Success
      this.broadcastStatus(paneId, { state: 'merged' })
      trackMergeCompleted('succeeded', strategy)
      this.gitStatusPoller.triggerCheck(paneId)
      // Also refresh status for all other panes in the same repo — their
      // "commits ahead" count is now stale since main just moved forward.
      this.refreshSiblingGitStatus(paneId, repoRoot)
      this.mergeQueue.complete(paneId)
      // Phase 4: prune the worktree + auto-close if policy says so.
      // Use the pane's pre-merge branch/repo context (captured from vars
      // above) — by the time the auto-close fires, the pane object may
      // no longer have valid state.
      this.maybeAutoClose(pane, repoRoot, branchName)
    } catch (err) {
      console.error('[completion-executor] processQueuedMerge threw:', err)
      this.broadcastStatus(paneId, {
        state: 'error',
        errorMessage: err instanceof Error ? err.message : String(err)
      })
      trackMergeCompleted('failed', entry.strategy)
      this.mergeQueue.complete(paneId)
    } finally {
      this.activeOperations.delete(paneId)
    }
  }

  /**
   * Refresh git status for every pane (except the one that just merged) whose
   * worktree belongs to the same main repo root. After a merge into main, the
   * other panes' `commitsAhead` count relative to main is stale.
   */
  private refreshSiblingGitStatus(mergedPaneId: string, repoRoot: string): void {
    for (const pane of this.sessionRegistry.getAllPanes().values()) {
      if (pane.id === mergedPaneId) continue
      if (!pane.isWorktree) continue
      // Fire-and-forget sibling refresh — getMainRepoPath is async but we
      // don't want to block. Wrap in void Promise.
      void (async () => {
        const paneRepoRoot = await getMainRepoPath(pane.worktreePath)
        if (paneRepoRoot === repoRoot) {
          this.gitStatusPoller.triggerCheck(pane.id)
        }
      })()
    }
  }

  // ---------------------------------------------------------------------------
  // PR
  // ---------------------------------------------------------------------------

  /**
   * Push branch and create a PR for a single pane.
   */
  async executePr(
    paneId: string,
    draft: boolean
  ): Promise<{ error: string | null; prUrl?: string }> {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return { error: 'Pane not found.' }
    if (!pane.isWorktree) return { error: 'Pane is not a worktree.' }
    if (this.activeOperations.has(paneId)) return { error: 'Operation already in progress.' }

    this.activeOperations.add(paneId)

    try {
      // 1. Auto-commit uncommitted changes
      if (pane.gitStatus?.hasUncommittedChanges) {
        const commitErr = await gitCommitAll(pane.worktreePath, 'claudinha: auto-commit before PR')
        if (commitErr) {
          this.broadcastStatus(paneId, { state: 'error', errorMessage: `Auto-commit failed: ${commitErr}` })
          return { error: commitErr }
        }
      }

      // 2. Get branch name
      const branchName = await getCurrentBranch(pane.worktreePath)
      if (!branchName) {
        this.broadcastStatus(paneId, { state: 'error', errorMessage: 'Could not determine current branch.' })
        return { error: 'Could not determine current branch.' }
      }

      // 3. Push
      this.broadcastStatus(paneId, { state: 'pushing' })
      const pushErr = await gitPush(pane.worktreePath, branchName)
      if (pushErr) {
        this.broadcastStatus(paneId, { state: 'error', errorMessage: `Push failed: ${pushErr}` })
        return { error: pushErr }
      }

      // 4. Create PR
      const title = pane.metrics.sessionTitle || branchName
      const body = this.generatePrBody(pane.metrics.sessionTitle, pane.metrics)
      const prResult = await ghCreatePr(pane.worktreePath, title, body, draft)
      if (prResult.error) {
        this.broadcastStatus(paneId, { state: 'error', errorMessage: `PR creation failed: ${prResult.error}` })
        return { error: prResult.error }
      }

      // 5. Success
      this.broadcastStatus(paneId, { state: 'pr-created', prUrl: prResult.prUrl })
      trackPrOpened(draft)
      return { error: null, prUrl: prResult.prUrl }
    } finally {
      this.activeOperations.delete(paneId)
    }
  }

  // ---------------------------------------------------------------------------
  // Abort
  // ---------------------------------------------------------------------------

  /**
   * Abort an in-progress merge or rebase for a pane.
   * Returns the pane to 'ready' state and resumes the repo's queue.
   */
  async abortMerge(paneId: string): Promise<{ error: string | null }> {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return { error: 'Pane not found.' }

    const mainRepoPath = await getMainRepoPath(pane.worktreePath)

    // Try rebase abort first (in worktree), then merge abort (in main repo)
    const rebaseErr = await gitRebaseAbort(pane.worktreePath)
    if (rebaseErr && mainRepoPath) {
      await gitMergeAbort(mainRepoPath)
    }

    // Clear any resolving-conflict flag and broadcast.
    this.sessionRegistry.setResolvingConflict(paneId, false)
    this.broadcastResolvingConflict(paneId, false)

    this.broadcastStatus(paneId, { state: 'ready' })
    this.gitStatusPoller.triggerCheck(paneId)

    // If the queue was paused for this repo (typically after a conflict),
    // resume it so subsequent merges can proceed.
    if (mainRepoPath) {
      this.mergeQueue.resume(mainRepoPath)
    }

    return { error: null }
  }

  // ---------------------------------------------------------------------------
  // Queue cancel
  // ---------------------------------------------------------------------------

  /**
   * Cancel a queued (not yet active) merge. Returns the action bar to 'ready'.
   * If the pane isn't queued (either because it's actively merging or
   * was never queued), the executor falls back to a regular abort.
   */
  async cancelFromQueue(paneId: string): Promise<{ error: string | null }> {
    const removed = this.mergeQueue.cancel(paneId)
    if (removed) {
      this.activeOperations.delete(paneId)
      this.broadcastStatus(paneId, { state: 'ready' })
      return { error: null }
    }
    // Not queued — treat as abort of an in-progress merge.
    return this.abortMerge(paneId)
  }

  // ---------------------------------------------------------------------------
  // Conflict resolution via Claude resume
  // ---------------------------------------------------------------------------

  /**
   * Ask Claude to resolve the current rebase conflict for a pane. Prefers
   * writing directly to the pane's alive PTY (preserves session history);
   * falls back to spawning a fresh `claude --resume <sessionId>` process if
   * the PTY has exited.
   */
  async resolveConflictWithClaude(paneId: string): Promise<{ error: string | null }> {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return { error: 'Pane not found.' }
    if (pane.completionActionStatus?.state !== 'conflict') {
      return { error: 'Pane is not in conflict state.' }
    }
    if (!pane.isWorktree) return { error: 'Pane is not a worktree.' }

    const repoRoot = await getMainRepoPath(pane.worktreePath)
    if (!repoRoot) return { error: 'Could not determine main repository path.' }

    // Pause the queue defensively — it should already be paused from the
    // conflict branch, but this is idempotent.
    this.mergeQueue.pause(repoRoot)

    // Mark the pane as resolving and notify the renderer's status overlay.
    this.sessionRegistry.setResolvingConflict(paneId, true)
    this.broadcastResolvingConflict(paneId, true)

    // Transition the pane to 'working' so the UI chrome reflects activity.
    // This also clears completionActionStatus via the registry's built-in
    // clear-on-status-change behavior, which is fine — the action bar is
    // hidden while status !== 'done' anyway.
    this.sessionRegistry.updatePaneStatus(paneId, 'working', 'hook', null)
    this.broadcastStatusTransition(paneId, 'working', null)

    // Register a one-shot listener that fires when Claude returns to a
    // terminal state. We wait for the first transition back to 'done',
    // 'awaiting-prompt', 'error', or 'needs-input'.
    const unsubscribe = this.sessionRegistry.onNextStatusChange(paneId, (id, newStatus) => {
      void this.handleConflictResolutionStatusChange(id, newStatus, repoRoot)
    })

    // Try writing to the alive PTY first.
    if (this.ptyPool.isAlive(paneId)) {
      try {
        this.ptyPool.write(paneId, CONFLICT_RESOLUTION_PROMPT + '\r')
        return { error: null }
      } catch (err) {
        console.warn('[completion-executor] write to alive PTY failed, falling back to respawn:', err)
        // Fall through to respawn.
      }
    }

    // PTY dead or write failed → respawn with --resume.
    if (!pane.sessionId) {
      // Can't resume without a session id. Roll back and let the user abort.
      unsubscribe()
      this.sessionRegistry.setResolvingConflict(paneId, false)
      this.broadcastResolvingConflict(paneId, false)
      this.broadcastStatus(paneId, { state: 'conflict' })
      return { error: 'Cannot resume: no session id recorded for this pane.' }
    }

    try {
      await this.respawnForConflict(pane, pane.sessionId)
    } catch (err) {
      unsubscribe()
      this.sessionRegistry.setResolvingConflict(paneId, false)
      this.broadcastResolvingConflict(paneId, false)
      this.broadcastStatus(paneId, {
        state: 'error',
        errorMessage: `Could not respawn Claude for conflict resolution: ${err instanceof Error ? err.message : String(err)}`
      })
      return { error: err instanceof Error ? err.message : String(err) }
    }

    return { error: null }
  }

  /**
   * Handle the pane's next status transition during conflict resolution.
   * If the rebase is complete, finish the merge; otherwise surface the
   * conflict state again and unblock the queue via manual intervention.
   */
  private async handleConflictResolutionStatusChange(
    paneId: string,
    newStatus: PaneStatus,
    repoRoot: string
  ): Promise<void> {
    // We only react to terminal states. 'working' transitions are expected
    // while Claude is running — ignore them.
    if (newStatus === 'working') {
      // Re-arm the listener so we keep watching for a terminal state.
      this.sessionRegistry.onNextStatusChange(paneId, (id, next) => {
        void this.handleConflictResolutionStatusChange(id, next, repoRoot)
      })
      return
    }

    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return

    // Clear the resolving flag — we're done with that UI state regardless
    // of outcome.
    this.sessionRegistry.setResolvingConflict(paneId, false)
    this.broadcastResolvingConflict(paneId, false)

    const stillInRebase = await isRebaseInProgress(pane.worktreePath)

    if (stillInRebase) {
      // Claude stopped but the rebase is not complete — either it gave up,
      // asked a question, or the user interrupted. Return to the conflict
      // state so the user can retry or abort manually. Queue stays paused.
      this.broadcastStatus(paneId, { state: 'conflict' })
      return
    }

    // Rebase is done. Finish the merge by fast-forwarding main onto the
    // now-resolved branch.
    const branchName = await getCurrentBranch(pane.worktreePath)
    if (!branchName) {
      this.broadcastStatus(paneId, {
        state: 'error',
        errorMessage: 'Rebase finished but could not determine branch name.'
      })
      this.mergeQueue.resume(repoRoot)
      return
    }

    this.broadcastStatus(paneId, { state: 'merging' })
    const mergeErr = await gitMergeFf(repoRoot, branchName)
    if (mergeErr) {
      this.broadcastStatus(paneId, {
        state: 'error',
        errorMessage: `Finish-merge failed: ${mergeErr}`
      })
      this.mergeQueue.resume(repoRoot)
      return
    }

    this.broadcastStatus(paneId, { state: 'merged' })
    this.gitStatusPoller.triggerCheck(paneId)
    this.refreshSiblingGitStatus(paneId, repoRoot)
    this.mergeQueue.resume(repoRoot)
    this.maybeAutoClose(pane, repoRoot, branchName)
  }

  /**
   * Schedule worktree pruning + pane auto-close after a successful merge,
   * gated on the pane's effective policy `pruneOnMerge` flag. Uses a short
   * delay so the user can see the "Merged to main" status before the pane
   * disappears.
   *
   * NOTE: `pane`, `repoRoot`, and `branchName` are captured BEFORE this
   * method is called (by the merge flow) because by the time the timer
   * fires, the pane's state may be gone.
   */
  private maybeAutoClose(pane: PaneState, repoRoot: string, branchName: string): void {
    const policy = this.getEffectivePolicy(pane)
    if (!policy.pruneOnMerge) return
    if (!this.closePane) return // not wired — nothing to do

    const paneId = pane.id
    const worktreePath = pane.worktreePath

    // Cancel any prior scheduled auto-close for this pane (should be rare —
    // only happens if two merges race, which the queue prevents).
    const existing = this.autoCloseTimers.get(paneId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.autoCloseTimers.delete(paneId)
      void this.performPruneAndClose(paneId, worktreePath, repoRoot, branchName)
    }, 1500)
    this.autoCloseTimers.set(paneId, timer)
  }

  /**
   * Actually perform the prune + close. Runs best-effort: pruning failures
   * are logged but don't block the close — the merge already succeeded, so
   * the user's work is safe.
   */
  private async performPruneAndClose(
    paneId: string,
    worktreePath: string,
    repoRoot: string,
    branchName: string
  ): Promise<void> {
    // Bail if the pane was already torn down for any other reason.
    const stillAlive = this.sessionRegistry.getPane(paneId)
    if (!stillAlive) return

    try {
      const removeErr = await gitWorktreeRemove(worktreePath)
      if (removeErr) {
        console.warn('[completion-executor] auto-prune: worktree remove failed', worktreePath, removeErr)
      }
      const branchErr = await gitBranchDelete(repoRoot, branchName)
      if (branchErr) {
        console.warn('[completion-executor] auto-prune: branch delete failed', branchName, branchErr)
      }
    } catch (err) {
      console.warn('[completion-executor] auto-prune threw:', err)
    }

    // Close the pane regardless of pruning outcome.
    try {
      this.closePane?.(paneId, { snapshotExtras: { completionAction: 'merged' } })
    } catch (err) {
      console.error('[completion-executor] auto-close threw:', err)
    }
  }

  /**
   * Kill the pane's existing PTY (if any) and spawn a fresh `claude --resume`
   * process. Mirrors the respawn handler in ipc-handlers.ts but spawns with
   * `--resume <sessionId>` to continue the same conversation.
   */
  private async respawnForConflict(pane: PaneState, sessionId: string): Promise<void> {
    const paneId = pane.id

    // Clean up current PTY if still alive (best-effort).
    if (this.ptyPool.isAlive(paneId)) {
      this.ptyPool.kill(paneId)
      // Give the kill a beat to settle before spawning a new process on the
      // same paneId key. This mirrors the behavior of the respawn handler.
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // Re-register subsystems. Mirror ipc-handlers.ts respawn.
    this.permissionsManager.writeSettings(pane.worktreePath)
    this.statusDetector.registerPane(paneId, this.hookListener.socketFailed)
    this.metricsCollector.watchPane(paneId)

    // Spawn fresh PTY with --resume.
    this.ptyPool.spawn({
      paneId,
      workingDirectory: pane.worktreePath,
      args: ['--resume', sessionId],
      extraEnv: {
        CLAUDINHA_PANE_ID: paneId,
        CLAUDINHA_SOCKET_PATH: this.hookListener.getSocketPath()
      },
      onData: (data: string) => {
        this.transitionBuffer.write(paneId, data)
        const currentPane = this.sessionRegistry.getPane(paneId)
        if (!currentPane) return
        const win = this.windowManager.getWindow(currentPane.windowId)
        if (!win || win.isDestroyed()) return
        win.webContents.send(IPC.PANE_DATA, { paneId, data })
        this.statusDetector.onData(paneId, data)
      },
      onExit: (exitCode: number, signal?: number) => {
        this.transitionBuffer.clear(paneId)
        const currentPane = this.sessionRegistry.getPane(paneId)
        if (!currentPane) return
        const win = this.windowManager.getWindow(currentPane.windowId)
        const isCrash = exitCode !== 0 && !signal
        if (isCrash) {
          this.sessionRegistry.updatePaneStatus(paneId, 'done', 'pty-fallback')
          currentPane.terminated = true
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC.PANE_TERMINATED, { paneId, exitCode })
          }
        } else {
          this.sessionRegistry.removePane(paneId)
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC.PANE_CLOSED, { paneId })
          }
        }
      }
    })

    // Wait for Claude to reach a state where it can accept input, then write
    // the conflict prompt. We use a bounded wait + status listener so we
    // don't rely on a fixed timeout (L-013: dual-mode detection gaps).
    await this.waitForReadyState(paneId, RESUME_WAIT_TIMEOUT_MS)
    this.ptyPool.write(paneId, CONFLICT_RESOLUTION_PROMPT + '\r')
  }

  /**
   * Wait for a pane to reach 'awaiting-prompt' (Claude idle and ready for
   * input) within the given timeout. Resolves even if the pane never reaches
   * that state — callers should be prepared to write to a not-yet-ready PTY
   * as a last resort (Claude buffers stdin until it's ready).
   */
  private waitForReadyState(paneId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const pane = this.sessionRegistry.getPane(paneId)
      if (pane && pane.status === 'awaiting-prompt') {
        resolve()
        return
      }
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        unsubscribe()
        clearTimeout(timer)
        resolve()
      }
      const unsubscribe = this.sessionRegistry.onNextStatusChange(paneId, (_id, newStatus) => {
        if (newStatus === 'awaiting-prompt') {
          finish()
        } else {
          // Re-arm for the next transition. This handles intermediate
          // 'working' states while Claude is starting up.
          this.sessionRegistry.onNextStatusChange(paneId, (_id2, next2) => {
            if (next2 === 'awaiting-prompt') finish()
          })
        }
      })
      const timer = setTimeout(finish, timeoutMs)
    })
  }

  // ---------------------------------------------------------------------------
  // Dismiss
  // ---------------------------------------------------------------------------

  /** Dismiss the action bar (non-destructive, hides it) */
  dismiss(paneId: string): void {
    this.sessionRegistry.updatePaneCompletionStatus(paneId, null)
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return
    const win = this.windowManager.getWindow(pane.windowId)
    if (win && !win.isDestroyed()) {
      const payload: CompletionStatusPayload = { paneId, status: null }
      win.webContents.send(IPC.COMPLETION_STATUS, payload)
    }
  }

  /** Reset a failure state back to 'ready' without hiding the bar. */
  clearToReady(paneId: string): void {
    this.broadcastStatus(paneId, { state: 'ready' })
  }

  /**
   * Whether a merge is currently active (or the queue is paused on a conflict)
   * for the given main repo root. Used by the dirty-main resolution handlers
   * to refuse in-app git writes while a merge holds the repo's index.lock —
   * see L-022 for the reader/writer contention this avoids.
   */
  isRepoMergeBusy(repoRoot: string): boolean {
    return this.mergeQueue.getActive(repoRoot) !== null ||
      this.mergeQueue.isPaused(repoRoot)
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Update registry and broadcast completion status to the pane's renderer window */
  private broadcastStatus(paneId: string, status: CompletionActionStatus): void {
    this.sessionRegistry.updatePaneCompletionStatus(paneId, status)
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return
    const win = this.windowManager.getWindow(pane.windowId)
    if (win && !win.isDestroyed()) {
      const payload: CompletionStatusPayload = { paneId, status }
      win.webContents.send(IPC.COMPLETION_STATUS, payload)
    }
  }

  /** Broadcast the isResolvingConflict flag to the pane's renderer window */
  private broadcastResolvingConflict(paneId: string, isResolvingConflict: boolean): void {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return
    const win = this.windowManager.getWindow(pane.windowId)
    if (win && !win.isDestroyed()) {
      const payload: PaneResolvingConflictPayload = { paneId, isResolvingConflict }
      win.webContents.send(IPC.PANE_RESOLVING_CONFLICT, payload)
    }
  }

  /** Broadcast a PANE_STATUS update to the pane's renderer (for executor-driven transitions) */
  private broadcastStatusTransition(
    paneId: string,
    status: PaneStatus,
    activeToolName: string | null
  ): void {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return
    const win = this.windowManager.getWindow(pane.windowId)
    if (win && !win.isDestroyed()) {
      const payload: PaneStatusPayload = {
        paneId,
        status,
        activeToolName,
        source: 'hook'
      }
      win.webContents.send(IPC.PANE_STATUS, payload)
    }
  }

  /** Generate a PR body with session metrics */
  private generatePrBody(
    sessionTitle: string | null,
    metrics: { durationMs: number | null; totalTokens: number | null; linesAdded: number | null; linesRemoved: number | null; modelDisplayName: string | null }
  ): string {
    const lines: string[] = []
    if (sessionTitle) {
      lines.push(`## Summary`)
      lines.push(sessionTitle)
      lines.push('')
    }
    lines.push('## Session Metrics')
    if (metrics.modelDisplayName) lines.push(`- Model: ${metrics.modelDisplayName}`)
    if (metrics.totalTokens) lines.push(`- Tokens: ${metrics.totalTokens.toLocaleString()}`)
    if (metrics.linesAdded !== null || metrics.linesRemoved !== null) {
      lines.push(`- Lines: +${metrics.linesAdded ?? 0} / -${metrics.linesRemoved ?? 0}`)
    }
    if (metrics.durationMs) {
      const mins = Math.round(metrics.durationMs / 60_000)
      lines.push(`- Duration: ${mins}m`)
    }
    lines.push('')
    lines.push('---')
    lines.push('*Created by Claudinha*')
    return lines.join('\n')
  }
}
