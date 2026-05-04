import { IPC } from '../shared/ipc-channels'
import type { PaneGitStatusPayload } from '../shared/ipc-channels'
import type { GitStatus } from '../shared/types'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import type { CompletionExecutor } from './completion-executor'
import type { InspectorService } from './inspector'
import { getGitStatus } from './git-status'

// ---------------------------------------------------------------------------
// Internal state per pane
// ---------------------------------------------------------------------------

interface PaneEntry {
  /** Periodic polling timer */
  timer: ReturnType<typeof setInterval> | null
  /** Last known git status (for change detection) */
  lastStatus: GitStatus | null
}

/** Polling interval in ms */
const POLL_INTERVAL_MS = 30_000

// ---------------------------------------------------------------------------
// GitStatusPoller
// ---------------------------------------------------------------------------

/**
 * GitStatusPoller — periodically checks git status for each pane's worktree
 * and broadcasts changes to the renderer via IPC.
 *
 * Follows the same singleton pattern as StatusDetector and MetricsCollector.
 */
export class GitStatusPoller {
  private readonly entries = new Map<string, PaneEntry>()

  /**
   * Completion executor — wired after construction via setCompletionExecutor()
   * because the executor also depends on the poller (constructor ordering).
   * When set, the poller calls `evaluateCompletion()` after every git status
   * update so auto-merge / auto-PR policies fire without racing the poll.
   */
  private completionExecutor: CompletionExecutor | null = null

  /**
   * Inspector — wired after construction. When set, the poller calls
   * `onPanePolled()` after every git status update so the keeper summary
   * stays in sync without a separate polling loop.
   */
  private inspector: InspectorService | null = null

  constructor(
    private readonly sessionRegistry: SessionRegistry,
    private readonly windowManager: WindowManager
  ) {}

  /** Wire the completion executor for post-poll auto-evaluation (Phase 3). */
  setCompletionExecutor(executor: CompletionExecutor): void {
    this.completionExecutor = executor
  }

  /** Wire the workspace keeper for cross-pane summary updates after each poll. */
  setInspector(keeper: InspectorService): void {
    this.inspector = keeper
  }

  /** Start polling for a pane. Runs an immediate check then polls every 30s. */
  watchPane(paneId: string): void {
    // Avoid double-watch
    if (this.entries.has(paneId)) return

    const entry: PaneEntry = {
      timer: null,
      lastStatus: null
    }

    entry.timer = setInterval(() => {
      void this.checkPane(paneId)
    }, POLL_INTERVAL_MS)

    this.entries.set(paneId, entry)

    // Immediate first check
    void this.checkPane(paneId)
  }

  /** Stop polling for a pane. */
  unwatchPane(paneId: string): void {
    const entry = this.entries.get(paneId)
    if (!entry) return
    if (entry.timer) clearInterval(entry.timer)
    this.entries.delete(paneId)
  }

  /** Force an immediate status check (e.g., when terminal status changes to done). */
  triggerCheck(paneId: string): void {
    if (this.entries.has(paneId)) {
      void this.checkPane(paneId)
    }
  }

  /** Shut down all timers (app quit). */
  dispose(): void {
    for (const [, entry] of this.entries) {
      if (entry.timer) clearInterval(entry.timer)
    }
    this.entries.clear()
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async checkPane(paneId: string): Promise<void> {
    const entry = this.entries.get(paneId)
    if (!entry) return

    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return

    const status = await getGitStatus(pane.worktreePath)
    if (!status) return

    // Only emit if status actually changed
    if (this.statusEqual(entry.lastStatus, status)) return

    entry.lastStatus = status
    this.sessionRegistry.updatePaneGitStatus(paneId, status)

    // Broadcast to the pane's window
    const win = this.windowManager.getWindow(pane.windowId)
    if (win && !win.isDestroyed()) {
      const payload: PaneGitStatusPayload = { paneId, gitStatus: status }
      win.webContents.send(IPC.PANE_GIT_STATUS, payload)
    }

    // Phase 3: after the git status is authoritative, let the completion
    // executor decide whether to auto-merge/auto-PR based on the effective
    // policy for this pane. This runs AFTER the status update so
    // `pane.gitStatus.commitsAhead` is fresh — no race with the poll.
    this.completionExecutor?.evaluateCompletion(paneId)

    // Notify the Inspector so it can refresh its cross-pane summary for
    // this pane's workspace and broadcast if anything meaningful changed.
    void this.inspector?.onPanePolled(paneId)
  }

  private statusEqual(a: GitStatus | null, b: GitStatus): boolean {
    if (!a) return false
    if (
      a.hasUncommittedChanges !== b.hasUncommittedChanges ||
      a.changedFileCount !== b.changedFileCount ||
      a.commitsAhead !== b.commitsAhead ||
      a.branchName !== b.branchName
    ) return false
    // changedFiles can change without changedFileCount changing (e.g. user
    // reverts foo.ts and edits bar.ts in the same poll window). Sorted both
    // sides so equality is positional.
    if (a.changedFiles.length !== b.changedFiles.length) return false
    for (let i = 0; i < a.changedFiles.length; i++) {
      if (a.changedFiles[i] !== b.changedFiles[i]) return false
    }
    return true
  }
}
