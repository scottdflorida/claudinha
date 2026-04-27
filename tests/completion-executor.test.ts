/**
 * CompletionExecutor unit tests.
 *
 * Tests merge (rebase-ff, squash, merge-commit), PR creation, abort, and
 * dismiss flows — including error paths, guard clauses, concurrency
 * prevention, and status broadcasting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PaneState, PaneMetrics } from '../src/shared/types'
import { IPC } from '../src/shared/ipc-channels'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('../src/main/git-status', () => ({
  gitCommitAll: vi.fn(),
  getMainRepoPath: vi.fn(),
  isWorkingTreeClean: vi.fn(),
  listChangedFiles: vi.fn().mockResolvedValue({ files: [], totalCount: 0 }),
  detectMainBranch: vi.fn(),
  getCurrentBranch: vi.fn(),
  gitRebase: vi.fn(),
  gitRebaseAbort: vi.fn(),
  gitMergeFf: vi.fn(),
  gitMergeSquash: vi.fn(),
  gitMergeNoFf: vi.fn(),
  gitMergeAbort: vi.fn(),
  gitPush: vi.fn(),
  ghCreatePr: vi.fn(),
  isRebaseInProgress: vi.fn()
}))

import { CompletionExecutor } from '../src/main/completion-executor'
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
  ghCreatePr
} from '../src/main/git-status'
import { createMockRegistry } from './helpers/mock-registry'
import { createMockWindowManager } from './helpers/mock-window-manager'

// Typed mocks
const mockGitCommitAll = vi.mocked(gitCommitAll)
const mockGetMainRepoPath = vi.mocked(getMainRepoPath)
const mockIsWorkingTreeClean = vi.mocked(isWorkingTreeClean)
const mockListChangedFiles = vi.mocked(listChangedFiles)
const mockDetectMainBranch = vi.mocked(detectMainBranch)
const mockGetCurrentBranch = vi.mocked(getCurrentBranch)
const mockGitRebase = vi.mocked(gitRebase)
const mockGitRebaseAbort = vi.mocked(gitRebaseAbort)
const mockGitMergeFf = vi.mocked(gitMergeFf)
const mockGitMergeSquash = vi.mocked(gitMergeSquash)
const mockGitMergeNoFf = vi.mocked(gitMergeNoFf)
const mockGitMergeAbort = vi.mocked(gitMergeAbort)
const mockGitPush = vi.mocked(gitPush)
const mockGhCreatePr = vi.mocked(ghCreatePr)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<PaneMetrics> = {}): PaneMetrics {
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
    initialPrompt: null,
    ...overrides
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
    worktreeName: 'feature-x',
    worktreePath: '/path/to/worktree',
    status: 'done',
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
    isWorktree: true,
    completionActionStatus: null,
    ...overrides
  }
}

/** Configure all git mocks for a successful merge path */
function setupSuccessfulMergeMocks() {
  mockGetMainRepoPath.mockResolvedValue('/main/repo')
  mockIsWorkingTreeClean.mockResolvedValue(true)
  mockDetectMainBranch.mockResolvedValue('main')
  mockGetCurrentBranch.mockResolvedValue('feature-x')
  mockGitRebase.mockResolvedValue(null)
  mockGitMergeFf.mockResolvedValue(null)
  mockGitMergeSquash.mockResolvedValue(null)
  mockGitMergeNoFf.mockResolvedValue(null)
  mockGitCommitAll.mockResolvedValue(null)
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CompletionExecutor', () => {
  let registry: ReturnType<typeof createMockRegistry>
  let windowManager: ReturnType<typeof createMockWindowManager>
  let gitStatusPoller: { triggerCheck: ReturnType<typeof vi.fn> }
  let ptyPool: { isAlive: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; spawn: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }
  let permissionsManager: { writeSettings: ReturnType<typeof vi.fn> }
  let statusDetector: { registerPane: ReturnType<typeof vi.fn>; onData: ReturnType<typeof vi.fn> }
  let metricsCollector: { watchPane: ReturnType<typeof vi.fn> }
  let hookListener: { getSocketPath: ReturnType<typeof vi.fn>; socketFailed: boolean }
  let transitionBuffer: { write: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> }
  let executor: CompletionExecutor

  /**
   * Helper to seed updatePaneCompletionStatus so the mock registry's getPane
   * reflects the latest completionActionStatus when the executor reads it
   * back after awaiting queue completion.
   */
  function wireCompletionStatusEcho(pane: PaneState): void {
    registry.updatePaneCompletionStatus.mockImplementation((_id: string, status: any) => {
      pane.completionActionStatus = status
      return pane
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()

    registry = createMockRegistry()
    windowManager = createMockWindowManager()
    gitStatusPoller = { triggerCheck: vi.fn() }
    ptyPool = {
      isAlive: vi.fn(() => false),
      write: vi.fn(),
      spawn: vi.fn(),
      kill: vi.fn()
    }
    permissionsManager = { writeSettings: vi.fn() }
    statusDetector = { registerPane: vi.fn(), onData: vi.fn() }
    metricsCollector = { watchPane: vi.fn() }
    hookListener = { getSocketPath: vi.fn(() => '/tmp/sock'), socketFailed: false }
    transitionBuffer = { write: vi.fn(), clear: vi.fn() }

    executor = new CompletionExecutor(
      registry as any,
      windowManager as any,
      gitStatusPoller as any,
      ptyPool as any,
      permissionsManager as any,
      statusDetector as any,
      metricsCollector as any,
      hookListener as any,
      transitionBuffer as any
    )
  })

  // =========================================================================
  // executeMerge
  // =========================================================================

  describe('executeMerge', () => {
    it('rebase-ff strategy: auto-commits, rebases, ff-merges', async () => {
      const pane = makePaneState({
        gitStatus: { hasUncommittedChanges: true, changedFileCount: 1, commitsAhead: 2, branchName: 'feature-x' }
      })
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)
      setupSuccessfulMergeMocks()

      const result = await executor.executeMerge('pane-1', 'rebase-ff')

      expect(result.error).toBeNull()
      // Auto-commit should be called
      expect(mockGitCommitAll).toHaveBeenCalledWith('/path/to/worktree', 'claudinha: auto-commit before merge')
      // Pre-checks
      expect(mockGetMainRepoPath).toHaveBeenCalledWith('/path/to/worktree')
      expect(mockIsWorkingTreeClean).toHaveBeenCalledWith('/main/repo')
      expect(mockDetectMainBranch).toHaveBeenCalledWith('/path/to/worktree')
      expect(mockGetCurrentBranch).toHaveBeenCalledWith('/path/to/worktree')
      // Strategy
      expect(mockGitRebase).toHaveBeenCalledWith('/path/to/worktree', 'main')
      expect(mockGitMergeFf).toHaveBeenCalledWith('/main/repo', 'feature-x')
      // Post-success
      expect(gitStatusPoller.triggerCheck).toHaveBeenCalledWith('pane-1')
    })

    it('squash strategy: auto-commits, squash merges with session title', async () => {
      const pane = makePaneState({
        gitStatus: { hasUncommittedChanges: true, changedFileCount: 1, commitsAhead: 1, branchName: 'feature-x' },
        metrics: makeMetrics({ sessionTitle: 'Add login feature' })
      })
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)
      setupSuccessfulMergeMocks()

      const result = await executor.executeMerge('pane-1', 'squash')

      expect(result.error).toBeNull()
      expect(mockGitCommitAll).toHaveBeenCalled()
      expect(mockGitMergeSquash).toHaveBeenCalledWith('/main/repo', 'feature-x', 'squash: Add login feature')
      // Rebase should NOT be called for squash strategy
      expect(mockGitRebase).not.toHaveBeenCalled()
    })

    it('merge-commit strategy: merges with no-ff', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)
      setupSuccessfulMergeMocks()

      const result = await executor.executeMerge('pane-1', 'merge-commit')

      expect(result.error).toBeNull()
      expect(mockGitMergeNoFf).toHaveBeenCalledWith('/main/repo', 'feature-x')
      expect(mockGitRebase).not.toHaveBeenCalled()
      expect(mockGitMergeFf).not.toHaveBeenCalled()
    })

    it('returns error when pane not found', async () => {
      registry.getPane.mockReturnValue(undefined)

      const result = await executor.executeMerge('nonexistent', 'rebase-ff')

      expect(result.error).toBe('Pane not found.')
    })

    it('returns error when pane is not a worktree', async () => {
      const pane = makePaneState({ isWorktree: false })
      registry.getPane.mockReturnValue(pane)

      const result = await executor.executeMerge('pane-1', 'rebase-ff')

      expect(result.error).toBe('Pane is not a worktree.')
    })

    it('returns error when pane status is not done', async () => {
      const pane = makePaneState({ status: 'working' })
      registry.getPane.mockReturnValue(pane)

      const result = await executor.executeMerge('pane-1', 'rebase-ff')

      expect(result.error).toBe('Pane is not in done state.')
    })

    it('handles rebase conflict', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)
      setupSuccessfulMergeMocks()
      mockGitRebase.mockResolvedValue('CONFLICT (content): Merge conflict in file.ts')

      const result = await executor.executeMerge('pane-1', 'rebase-ff')

      expect(result.error).toBe('Merge conflict during rebase.')
      // ff-merge should NOT be attempted after a rebase conflict
      expect(mockGitMergeFf).not.toHaveBeenCalled()
    })

    it('handles dirty main working pane', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)
      setupSuccessfulMergeMocks()
      mockIsWorkingTreeClean.mockResolvedValue(false)
      mockListChangedFiles.mockResolvedValue({
        files: ['README.md', 'src/a.ts'],
        totalCount: 2
      })

      const result = await executor.executeMerge('pane-1', 'rebase-ff')

      expect(result.error).toBe('main has uncommitted changes')
      // Should not proceed to the strategy
      expect(mockGitRebase).not.toHaveBeenCalled()
      // listChangedFiles was queried against the main repo root so the UI can
      // show which files are blocking the merge.
      expect(mockListChangedFiles).toHaveBeenCalledWith('/main/repo')
      // And the broadcast status carries the enriched dirtyMain context.
      expect(pane.completionActionStatus).toEqual({
        state: 'dirty-main',
        dirtyMain: {
          path: '/main/repo',
          files: ['README.md', 'src/a.ts'],
          totalCount: 2
        }
      })
    })

    it('prevents concurrent operations on the same pane', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)
      setupSuccessfulMergeMocks()

      // Make the first call take a while by making gitRebase slow — this
      // stalls the queued processor so activeOperations stays held.
      let resolveFirst!: (v: string | null) => void
      mockGitRebase.mockReturnValueOnce(
        new Promise((resolve) => { resolveFirst = resolve })
      )

      const first = executor.executeMerge('pane-1', 'rebase-ff')
      // Let the first call enter the queue and set activeOperations before
      // the second call races it.
      await new Promise((r) => setImmediate(r))
      const second = await executor.executeMerge('pane-1', 'rebase-ff')

      expect(second.error).toBe('Operation already in progress.')

      // Clean up: let the first call finish
      resolveFirst(null)
      await first
    })

    it('broadcasts status updates at each step (rebase-ff)', async () => {
      const pane = makePaneState({
        gitStatus: { hasUncommittedChanges: true, changedFileCount: 1, commitsAhead: 1, branchName: 'feature-x' }
      })
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)
      setupSuccessfulMergeMocks()

      await executor.executeMerge('pane-1', 'rebase-ff')

      // Collect all COMPLETION_STATUS sends
      const statusCalls = windowManager._sendSpy.mock.calls.filter(
        (call: any[]) => call[0] === IPC.COMPLETION_STATUS
      )
      const states = statusCalls.map((call: any[]) => call[1].status.state)

      // Expected sequence: merging (auto-commit) -> rebasing -> merging (ff) -> merged
      expect(states).toEqual(['merging', 'rebasing', 'merging', 'merged'])
    })

    it('skips auto-commit when no uncommitted changes', async () => {
      const pane = makePaneState({
        gitStatus: { hasUncommittedChanges: false, changedFileCount: 0, commitsAhead: 1, branchName: 'feature-x' }
      })
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)
      setupSuccessfulMergeMocks()

      await executor.executeMerge('pane-1', 'rebase-ff')

      expect(mockGitCommitAll).not.toHaveBeenCalled()
    })

    it('releases the active operation lock even on failure', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)
      setupSuccessfulMergeMocks()
      // Up-front resolve failure (before enqueue) exercises the pre-queue
      // error return path.
      mockGetMainRepoPath.mockResolvedValueOnce(null)

      await executor.executeMerge('pane-1', 'rebase-ff')

      // The lock should be released; a second call should NOT say "Operation already in progress"
      const secondPane = makePaneState()
      registry.getPane.mockReturnValue(secondPane)
      wireCompletionStatusEcho(secondPane)
      mockGetMainRepoPath.mockResolvedValue('/main/repo')
      const second = await executor.executeMerge('pane-1', 'rebase-ff')
      expect(second.error).toBeNull()
    })
  })

  // =========================================================================
  // executePr
  // =========================================================================

  describe('executePr', () => {
    it('pushes branch and creates PR', async () => {
      const pane = makePaneState({
        metrics: makeMetrics({ sessionTitle: 'Improve search' })
      })
      registry.getPane.mockReturnValue(pane)
      mockGetCurrentBranch.mockResolvedValue('feature-x')
      mockGitPush.mockResolvedValue(null)
      mockGhCreatePr.mockResolvedValue({ error: null, prUrl: 'https://github.com/owner/repo/pull/42' })

      const result = await executor.executePr('pane-1', false)

      expect(result.error).toBeNull()
      expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42')
      expect(mockGitPush).toHaveBeenCalledWith('/path/to/worktree', 'feature-x')
      expect(mockGhCreatePr).toHaveBeenCalledWith(
        '/path/to/worktree',
        'Improve search',
        expect.stringContaining('Session Metrics'),
        false
      )
    })

    it('handles draft flag', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      mockGetCurrentBranch.mockResolvedValue('feature-x')
      mockGitPush.mockResolvedValue(null)
      mockGhCreatePr.mockResolvedValue({ error: null, prUrl: 'https://github.com/owner/repo/pull/99' })

      const result = await executor.executePr('pane-1', true)

      expect(result.error).toBeNull()
      // The draft flag should be passed through
      expect(mockGhCreatePr).toHaveBeenCalledWith(
        '/path/to/worktree',
        expect.any(String),
        expect.any(String),
        true
      )
    })

    it('returns error on push failure', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      mockGetCurrentBranch.mockResolvedValue('feature-x')
      mockGitPush.mockResolvedValue('remote rejected')

      const result = await executor.executePr('pane-1', false)

      expect(result.error).toBe('remote rejected')
      // PR should not be attempted after push failure
      expect(mockGhCreatePr).not.toHaveBeenCalled()
    })

    it('returns error on PR creation failure', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      mockGetCurrentBranch.mockResolvedValue('feature-x')
      mockGitPush.mockResolvedValue(null)
      mockGhCreatePr.mockResolvedValue({ error: 'gh: not authenticated', prUrl: undefined })

      const result = await executor.executePr('pane-1', false)

      expect(result.error).toBe('gh: not authenticated')
    })

    it('returns error when pane not found', async () => {
      registry.getPane.mockReturnValue(undefined)

      const result = await executor.executePr('nonexistent', false)

      expect(result.error).toBe('Pane not found.')
    })

    it('returns error when pane is not a worktree', async () => {
      const pane = makePaneState({ isWorktree: false })
      registry.getPane.mockReturnValue(pane)

      const result = await executor.executePr('pane-1', false)

      expect(result.error).toBe('Pane is not a worktree.')
    })
  })

  // =========================================================================
  // abortMerge
  // =========================================================================

  describe('abortMerge', () => {
    it('aborts in-progress rebase', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      mockGetMainRepoPath.mockResolvedValue('/main/repo')
      mockGitRebaseAbort.mockResolvedValue(null)

      const result = await executor.abortMerge('pane-1')

      expect(result.error).toBeNull()
      expect(mockGitRebaseAbort).toHaveBeenCalledWith('/path/to/worktree')
      // When rebase abort succeeds, merge abort should NOT be called
      expect(mockGitMergeAbort).not.toHaveBeenCalled()
      // Should broadcast ready state
      const statusCalls = windowManager._sendSpy.mock.calls.filter(
        (call: any[]) => call[0] === IPC.COMPLETION_STATUS
      )
      expect(statusCalls[0][1].status.state).toBe('ready')
      // Should trigger a status check
      expect(gitStatusPoller.triggerCheck).toHaveBeenCalledWith('pane-1')
    })

    it('falls back to merge abort when rebase abort fails', async () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      mockGetMainRepoPath.mockResolvedValue('/main/repo')
      mockGitRebaseAbort.mockResolvedValue('fatal: No rebase in progress?')

      const result = await executor.abortMerge('pane-1')

      expect(result.error).toBeNull()
      expect(mockGitRebaseAbort).toHaveBeenCalledWith('/path/to/worktree')
      expect(mockGitMergeAbort).toHaveBeenCalledWith('/main/repo')
    })

    it('returns error when pane not found', async () => {
      registry.getPane.mockReturnValue(undefined)

      const result = await executor.abortMerge('nonexistent')

      expect(result.error).toBe('Pane not found.')
    })
  })

  // =========================================================================
  // dismiss
  // =========================================================================

  describe('dismiss', () => {
    it('clears completion status for a pane', () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)

      executor.dismiss('pane-1')

      expect(registry.updatePaneCompletionStatus).toHaveBeenCalledWith('pane-1', null)
      // Should send null status to renderer
      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.COMPLETION_STATUS,
        { paneId: 'pane-1', status: null }
      )
    })

    it('does nothing if pane not found', () => {
      // First call for updatePaneCompletionStatus, second for getPane
      registry.getPane.mockReturnValue(undefined)

      // Should not throw
      executor.dismiss('nonexistent')

      expect(registry.updatePaneCompletionStatus).toHaveBeenCalledWith('nonexistent', null)
      // No window send since pane not found
      expect(windowManager._sendSpy).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // clearToReady
  // =========================================================================

  describe('clearToReady', () => {
    it('broadcasts a ready status without nulling out the bar', () => {
      const pane = makePaneState()
      registry.getPane.mockReturnValue(pane)
      wireCompletionStatusEcho(pane)

      executor.clearToReady('pane-1')

      // Status is set to { state: 'ready' } — NOT null. The bar must stay
      // visible so the user can retry or pick a different strategy.
      expect(registry.updatePaneCompletionStatus).toHaveBeenCalledWith('pane-1', { state: 'ready' })
      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.COMPLETION_STATUS,
        { paneId: 'pane-1', status: { state: 'ready' } }
      )
    })

    it('does nothing if pane not found', () => {
      registry.getPane.mockReturnValue(undefined)

      executor.clearToReady('nonexistent')

      expect(registry.updatePaneCompletionStatus).toHaveBeenCalledWith('nonexistent', { state: 'ready' })
      expect(windowManager._sendSpy).not.toHaveBeenCalled()
    })
  })
})
