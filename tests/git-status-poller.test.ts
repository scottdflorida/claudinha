/**
 * GitStatusPoller unit tests.
 *
 * Tests periodic polling via setInterval, change detection / deduplication,
 * IPC broadcasting, and lifecycle management (watch / unwatch / dispose).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GitStatus, PaneState } from '../src/shared/types'
import { IPC } from '../src/shared/ipc-channels'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('../src/main/git-status', () => ({
  getGitStatus: vi.fn()
}))

import { GitStatusPoller } from '../src/main/git-status-poller'
import { getGitStatus } from '../src/main/git-status'
import { createMockRegistry } from './helpers/mock-registry'
import { createMockWindowManager } from './helpers/mock-window-manager'

const mockGetGitStatus = vi.mocked(getGitStatus)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGitStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    hasUncommittedChanges: false,
    changedFileCount: 0,
    changedFiles: [],
    commitsAhead: 0,
    baseBranchAheadOfRemote: null,
    branchName: 'feature-branch',
    ...overrides
  }
}

function makeMetrics() {
  return {
    totalTokens: null,
    contextPercent: null,
    toolsUsed: null,
    totalCostUsd: null,
    durationMs: null,
    modelDisplayName: null,
    linesAdded: null,
    linesRemoved: null,
    sessionTitle: null,
    initialPrompt: null, lastMessage: null
  }
}

function makePaneState(overrides: Partial<PaneState> = {}): PaneState {
  return {
    id: 'pane-1',
    windowId: 'win-1',
    workspaceId: 'workspace-1',
    ptyId: 'pty-1',
    sessionId: null,
    transcriptPath: null,
    contextWindowSize: null,
    repoName: 'repo',
    worktreeName: 'main',
    worktreePath: '/path/to/worktree',
    status: 'awaiting-prompt',
    activeToolName: null,
    statusChangedAt: 0,
    statusSource: 'hook',
    isFocused: false,
    hasUnseenStatusChange: false,
    isApiBilling: false,
    effort: 'medium',
    model: 'opus',
    metrics: makeMetrics(),
    createdAt: 0,
    gitStatus: null,
    isWorktree: false,
    completionActionStatus: null,
    ...overrides
  }
}

/**
 * Flush microtasks so that the `void this.checkPane()` promise chain
 * completes, without advancing time far enough to trigger the 30s interval.
 */
async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitStatusPoller', () => {
  let registry: ReturnType<typeof createMockRegistry>
  let windowManager: ReturnType<typeof createMockWindowManager>
  let poller: GitStatusPoller

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    registry = createMockRegistry()
    windowManager = createMockWindowManager()

    poller = new GitStatusPoller(
      registry as unknown as import('../src/main/session-registry').SessionRegistry,
      windowManager as unknown as import('../src/main/window-manager').WindowManager
    )
  })

  afterEach(() => {
    poller.dispose()
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // watchPane
  // -------------------------------------------------------------------------

  describe('watchPane', () => {
    it('runs an immediate check when called', async () => {
      const pane = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(pane)
      const status = makeGitStatus({ branchName: 'main' })
      mockGetGitStatus.mockResolvedValue(status)

      poller.watchPane('pane-1')

      // Flush the immediate async checkPane
      await flushMicrotasks()

      expect(mockGetGitStatus).toHaveBeenCalledWith('/path/to/worktree')
      expect(registry.updatePaneGitStatus).toHaveBeenCalledWith('pane-1', status)
    })

    it('sets up periodic interval that fires every 30s', async () => {
      const pane = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(pane)
      const status = makeGitStatus()
      mockGetGitStatus.mockResolvedValue(status)

      poller.watchPane('pane-1')

      // Flush the immediate check
      await flushMicrotasks()

      vi.clearAllMocks()
      registry.getPane.mockReturnValue(pane)
      mockGetGitStatus.mockResolvedValue(makeGitStatus({ changedFileCount: 5 }))

      // Advance by 30s to trigger the interval
      await vi.advanceTimersByTimeAsync(30_000)

      expect(mockGetGitStatus).toHaveBeenCalledTimes(1)
    })

    it('is idempotent — double-watch does not create duplicate intervals', async () => {
      const pane = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(pane)
      const status = makeGitStatus()
      mockGetGitStatus.mockResolvedValue(status)

      poller.watchPane('pane-1')
      poller.watchPane('pane-1') // second call should be ignored

      // Flush the immediate check
      await flushMicrotasks()

      // Only one immediate check should have occurred (not two)
      expect(mockGetGitStatus).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // unwatchPane
  // -------------------------------------------------------------------------

  describe('unwatchPane', () => {
    it('clears interval and removes tracking', async () => {
      const pane = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(pane)
      mockGetGitStatus.mockResolvedValue(makeGitStatus())

      poller.watchPane('pane-1')
      await flushMicrotasks()

      vi.clearAllMocks()
      registry.getPane.mockReturnValue(pane)
      mockGetGitStatus.mockResolvedValue(makeGitStatus({ changedFileCount: 10 }))

      poller.unwatchPane('pane-1')

      // Advance past the interval — should NOT trigger a check
      await vi.advanceTimersByTimeAsync(60_000)

      expect(mockGetGitStatus).not.toHaveBeenCalled()
    })

    it('no-ops for unknown pane', () => {
      expect(() => poller.unwatchPane('nonexistent')).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // triggerCheck
  // -------------------------------------------------------------------------

  describe('triggerCheck', () => {
    it('runs an immediate check for a watched pane', async () => {
      const pane = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(pane)
      mockGetGitStatus.mockResolvedValue(makeGitStatus())

      poller.watchPane('pane-1')
      await flushMicrotasks()

      vi.clearAllMocks()
      registry.getPane.mockReturnValue(pane)
      const newStatus = makeGitStatus({ commitsAhead: 3 })
      mockGetGitStatus.mockResolvedValue(newStatus)

      poller.triggerCheck('pane-1')
      await flushMicrotasks()

      expect(mockGetGitStatus).toHaveBeenCalledWith('/path/to/worktree')
      expect(registry.updatePaneGitStatus).toHaveBeenCalledWith('pane-1', newStatus)
    })

    it('no-ops for unknown pane', async () => {
      poller.triggerCheck('nonexistent')
      await flushMicrotasks()

      expect(mockGetGitStatus).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // status change detection
  // -------------------------------------------------------------------------

  describe('status change detection', () => {
    it('only broadcasts IPC when status actually changes (deduplication)', async () => {
      const pane = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(pane)

      const status = makeGitStatus({ branchName: 'main', changedFileCount: 2 })
      mockGetGitStatus.mockResolvedValue(status)

      poller.watchPane('pane-1')
      await flushMicrotasks()

      // First check should broadcast (null -> status)
      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.PANE_GIT_STATUS,
        { paneId: 'pane-1', gitStatus: status }
      )

      vi.clearAllMocks()
      registry.getPane.mockReturnValue(pane)
      // Return identical status on the next poll
      mockGetGitStatus.mockResolvedValue(makeGitStatus({ branchName: 'main', changedFileCount: 2 }))

      // Advance to trigger the interval
      await vi.advanceTimersByTimeAsync(30_000)

      // Should NOT have broadcast again since status is identical
      expect(windowManager._sendSpy).not.toHaveBeenCalled()
      expect(registry.updatePaneGitStatus).not.toHaveBeenCalled()
    })

    it('broadcasts when status changes from previous check', async () => {
      const pane = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(pane)

      const initialStatus = makeGitStatus({ changedFileCount: 0, hasUncommittedChanges: false })
      mockGetGitStatus.mockResolvedValue(initialStatus)

      poller.watchPane('pane-1')
      await flushMicrotasks()

      vi.clearAllMocks()
      registry.getPane.mockReturnValue(pane)

      const changedStatus = makeGitStatus({ changedFileCount: 3, hasUncommittedChanges: true })
      mockGetGitStatus.mockResolvedValue(changedStatus)

      // Advance to trigger the interval
      await vi.advanceTimersByTimeAsync(30_000)

      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.PANE_GIT_STATUS,
        { paneId: 'pane-1', gitStatus: changedStatus }
      )
    })

    it('broadcasts when only baseBranchAheadOfRemote changes (push count cleared)', async () => {
      // Regression: after a manual `git push origin main` from a terminal
      // pane, the local refs/remotes/origin/main ref updates and the next
      // poll sees baseBranchAheadOfRemote drop from N to 0. Earlier, the
      // equality guard ignored this field, so the "↑N to push" pill stayed
      // stale until some unrelated field changed.
      const pane = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(pane)

      const ahead = makeGitStatus({ baseBranchAheadOfRemote: 2 })
      mockGetGitStatus.mockResolvedValue(ahead)

      poller.watchPane('pane-1')
      await flushMicrotasks()

      vi.clearAllMocks()
      registry.getPane.mockReturnValue(pane)

      const cleared = makeGitStatus({ baseBranchAheadOfRemote: 0 })
      mockGetGitStatus.mockResolvedValue(cleared)

      await vi.advanceTimersByTimeAsync(30_000)

      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.PANE_GIT_STATUS,
        { paneId: 'pane-1', gitStatus: cleared }
      )
      expect(registry.updatePaneGitStatus).toHaveBeenCalledWith('pane-1', cleared)
    })

    it('calls sessionRegistry to update pane state on status change', async () => {
      const pane = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(pane)

      const status = makeGitStatus({ branchName: 'develop' })
      mockGetGitStatus.mockResolvedValue(status)

      poller.watchPane('pane-1')
      await flushMicrotasks()

      expect(registry.updatePaneGitStatus).toHaveBeenCalledWith('pane-1', status)
    })
  })

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------

  describe('dispose', () => {
    it('clears all intervals', async () => {
      const pane1 = makePaneState({ id: 'pane-1' })
      const pane2 = makePaneState({ id: 'pane-2', worktreePath: '/path/to/other' })
      registry.getPane.mockImplementation((id: string) => {
        if (id === 'pane-1') return pane1
        if (id === 'pane-2') return pane2
        return null
      })
      mockGetGitStatus.mockResolvedValue(makeGitStatus())

      poller.watchPane('pane-1')
      poller.watchPane('pane-2')
      await flushMicrotasks()

      vi.clearAllMocks()
      registry.getPane.mockImplementation((id: string) => {
        if (id === 'pane-1') return pane1
        if (id === 'pane-2') return pane2
        return null
      })
      mockGetGitStatus.mockResolvedValue(makeGitStatus({ changedFileCount: 99 }))

      poller.dispose()

      // Advance well past the interval — should NOT trigger any checks
      await vi.advanceTimersByTimeAsync(120_000)

      expect(mockGetGitStatus).not.toHaveBeenCalled()
    })
  })
})
