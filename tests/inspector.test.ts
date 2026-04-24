/**
 * InspectorService unit tests.
 *
 * Covers numstat parsing, cache-seeded aggregation, the ready-to-merge
 * criterion, heuristic test-hint helpers, and the on-demand LLM request
 * (in-flight coalescing + subprocess failure swallowed into InspectorReport.error).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

// child_process is used for the git numstat/diff/rev-parse calls and the
// `claude -p` spawn. util.promisify uses a custom symbol on execFile to
// resolve with { stdout, stderr }; our vi.fn mock has to carry the same
// symbol or the promisified calls return raw strings instead of objects.
vi.mock('child_process', async () => {
  const util = await import('util')
  const execFile = vi.fn() as unknown as {
    (cmd: string, args: readonly string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void): unknown
    [key: symbol]: unknown
  }
  ;(execFile as unknown as Record<symbol, unknown>)[util.promisify.custom] = (
    cmd: string,
    args: readonly string[],
    opts: unknown
  ) =>
    new Promise((resolve, reject) => {
      ;(execFile as unknown as (...a: unknown[]) => void)(
        cmd,
        args,
        opts,
        (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err)
          else resolve({ stdout, stderr })
        }
      )
    })
  return { execFile }
})

import { execFile } from 'child_process'
import { IPC } from '../src/shared/ipc-channels'
import {
  InspectorService,
  isTestFilePath,
  findAdjacentTestFile,
  parseNumstat
} from '../src/main/inspector'
import { SessionRegistry } from '../src/main/session-registry'
import type { PaneState, GitStatus, CompletionActionStatus } from '../src/shared/types'
import { createMockRegistry } from './helpers/mock-registry'
import { createMockWindowManager } from './helpers/mock-window-manager'

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void
const mockExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    sessionTitle: null
  }
}

function makePane(overrides: Partial<PaneState> = {}): PaneState {
  return {
    id: 'pane-1',
    windowId: 'win-1',
    workspaceId: 'workspace-1',
    ptyId: 'pty-1',
    sessionId: null,
    transcriptPath: null,
    contextWindowSize: null,
    repoName: 'alpha',
    worktreeName: 'wt-1',
    worktreePath: '/tmp/repos/alpha-1',
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

function makeGitStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    hasUncommittedChanges: false,
    changedFileCount: 0,
    commitsAhead: 0,
    branchName: 'feature-branch',
    ...overrides
  }
}

function makeWorkspaceManager(workspace: { id: string; name: string; windowId: string | null } | null) {
  return {
    getWorkspace: vi.fn(() => (workspace ? workspace : undefined))
  } as unknown as import('../src/main/workspace-manager').WorkspaceManager
}

function mkService(
  panes: PaneState[],
  workspace: { id: string; name: string; windowId: string | null } | null = { id: 'workspace-1', name: 'Workspace', windowId: 'win-1' }
) {
  const reg = createMockRegistry()
  reg.getPanesForWorkspace.mockImplementation(() => panes)
  reg.getPane.mockImplementation((id: string) => panes.find((p) => p.id === id))
  const hm = makeWorkspaceManager(workspace)
  const wm = createMockWindowManager() as unknown as import('../src/main/window-manager').WindowManager
  const svc = new InspectorService(
    reg as unknown as import('../src/main/session-registry').SessionRegistry,
    hm,
    wm
  )
  return { svc, reg, hm, wm }
}

/**
 * Install a uniform git mock keyed by worktree cwd. Each entry provides the
 * numstat output, optional untracked-files listing (one-per-line, for
 * `git ls-files --others --exclude-standard`), and optional tracked-diff
 * body. pickMergeBase always resolves to 'main' unless `noBase` is set.
 */
function installGitMock(
  perCwd: Record<string, { numstat?: string; untracked?: string; diff?: string; noBase?: boolean }>
) {
  mockExecFile.mockImplementation(((
    cmd: string,
    args: readonly string[],
    opts: unknown,
    cb?: ExecFileCallback
  ) => {
    const callback = (cb ?? ((): void => {})) as ExecFileCallback
    const cwd = (opts as { cwd?: string } | undefined)?.cwd ?? ''
    const entry = perCwd[cwd]

    if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
      if (entry?.noBase) callback(new Error('no base'), '', '')
      else if (args[2] === 'main') callback(null, 'main-sha', '')
      else callback(new Error('master missing'), '', '')
      return {}
    }
    if (cmd === 'git' && args[0] === 'merge-base') {
      if (entry?.noBase) callback(new Error('no base'), '', '')
      else callback(null, 'merge-base-sha', '')
      return {}
    }
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--numstat') {
      callback(null, entry?.numstat ?? '', '')
      return {}
    }
    if (cmd === 'git' && args[0] === 'ls-files' && args[1] === '--others') {
      callback(null, entry?.untracked ?? '', '')
      return {}
    }
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--no-color') {
      callback(null, entry?.diff ?? '', '')
      return {}
    }
    callback(new Error(`unexpected git call: ${cmd} ${args.join(' ')}`), '', '')
    return {}
  }) as unknown as typeof execFile)
}

async function seedCacheForPanes(svc: InspectorService, panes: PaneState[]): Promise<void> {
  for (const pane of panes) {
    await svc.onPanePolled(pane.id)
  }
}

beforeEach(() => {
  mockExecFile.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// parseNumstat
// ---------------------------------------------------------------------------

describe('parseNumstat', () => {
  it('sums added / removed across text files', () => {
    const out = ['3\t1\tsrc/foo.ts', '10\t0\tsrc/bar.ts'].join('\n')
    expect(parseNumstat(out)).toEqual({
      files: ['src/foo.ts', 'src/bar.ts'],
      filesTouched: 2,
      linesAdded: 13,
      linesRemoved: 1
    })
  })

  it('counts binary files toward filesTouched but not line counts', () => {
    const out = ['-\t-\tlogo.png', '5\t2\tsrc/foo.ts'].join('\n')
    const parsed = parseNumstat(out)
    expect(parsed.filesTouched).toBe(2)
    expect(parsed.linesAdded).toBe(5)
    expect(parsed.linesRemoved).toBe(2)
  })

  it("filters out Claudinha's own .claude/ entries", () => {
    const out = ['2\t0\t.claude/settings.json', '3\t0\tsrc/foo.ts'].join('\n')
    const parsed = parseNumstat(out)
    expect(parsed.files).toEqual(['src/foo.ts'])
    expect(parsed.linesAdded).toBe(3)
  })

  it('returns zeros for empty output', () => {
    expect(parseNumstat('')).toEqual({
      files: [],
      filesTouched: 0,
      linesAdded: 0,
      linesRemoved: 0
    })
  })
})

// ---------------------------------------------------------------------------
// Aggregation: buildSummary via onPanePolled → cache
// ---------------------------------------------------------------------------

describe('InspectorService.buildSummary — aggregation', () => {
  it('returns zeros for an empty workspace', () => {
    const { svc } = mkService([])
    const summary = svc.buildSummary('workspace-1', [])
    expect(summary.totalPanes).toBe(0)
    expect(summary.totalFilesTouched).toBe(0)
    expect(summary.totalLinesAdded).toBe(0)
    expect(summary.totalLinesRemoved).toBe(0)
    expect(summary.readyCount).toBe(0)
    expect(summary.repos).toEqual([])
    expect(summary.panes).toEqual([])
  })

  it('sums filesTouched and line counts across panes in a single-repo workspace', async () => {
    const panes = [
      makePane({
        id: 'p1',
        worktreePath: '/tmp/repos/alpha-1',
        gitStatus: makeGitStatus({ hasUncommittedChanges: true })
      }),
      makePane({
        id: 'p2',
        worktreePath: '/tmp/repos/alpha-2',
        gitStatus: makeGitStatus({ commitsAhead: 5 })
      }),
      makePane({
        id: 'p3',
        worktreePath: '/tmp/repos/alpha-3',
        gitStatus: makeGitStatus({ commitsAhead: 2, hasUncommittedChanges: true })
      })
    ]
    installGitMock({
      '/tmp/repos/alpha-1': { numstat: '3\t1\tsrc/a.ts' },
      '/tmp/repos/alpha-2': { numstat: '10\t0\tsrc/b.ts\n5\t2\tsrc/c.ts' },
      '/tmp/repos/alpha-3': { numstat: '1\t1\tsrc/d.ts' }
    })
    const { svc } = mkService(panes)
    await seedCacheForPanes(svc, panes)
    const summary = svc.buildSummary('workspace-1', panes)
    expect(summary.totalPanes).toBe(3)
    expect(summary.totalFilesTouched).toBe(4)
    expect(summary.totalLinesAdded).toBe(19)
    expect(summary.totalLinesRemoved).toBe(4)
    expect(summary.repos).toHaveLength(1)
    expect(summary.repos[0].paneCount).toBe(3)
    expect(summary.repos[0].totalFilesTouched).toBe(4)
  })

  it('groups by repo when the workspace spans multiple repos (per-pane mode)', async () => {
    const panes = [
      makePane({ id: 'p1', repoName: 'alpha', worktreePath: '/tmp/repos/alpha-1' }),
      makePane({ id: 'p2', repoName: 'alpha', worktreePath: '/tmp/repos/alpha-2' }),
      makePane({ id: 'p3', repoName: 'beta', worktreePath: '/tmp/other/beta-1' })
    ]
    installGitMock({
      '/tmp/repos/alpha-1': { numstat: '1\t0\ta.ts' },
      '/tmp/repos/alpha-2': { numstat: '2\t0\tb.ts' },
      '/tmp/other/beta-1': { numstat: '3\t0\tc.ts' }
    })
    const { svc } = mkService(panes)
    await seedCacheForPanes(svc, panes)
    const summary = svc.buildSummary('workspace-1', panes)
    expect(summary.repos).toHaveLength(2)
    const labels = summary.repos.map((r) => r.repoLabel).sort()
    expect(labels).toEqual(['alpha', 'beta'])
  })

  it('repairs legacy `.worktrees` repoName by deriving from worktreePath', async () => {
    // Regression: before the L-042 follow-up, pane.repoName was written as
    // `path.basename(repoPath)` at spawn time. If the caller handed in
    // `<repoRoot>/.worktrees` (poisoned inspector value, stale localStorage,
    // user paste), the pane persisted `.worktrees` as its repo name forever.
    // The inspector re-derives from worktreePath so the Kanban card, repo
    // rail, and pane header all show the parent repo's basename.
    const panes = [
      makePane({
        id: 'p1',
        repoName: '.worktrees',
        worktreePath: '/tmp/repos/game-studio-research/.worktrees/Planner'
      }),
      makePane({
        id: 'p2',
        repoName: '.worktrees',
        worktreePath: '/tmp/repos/game-studio-research/.worktrees/wt-152fb9'
      })
    ]
    installGitMock({
      '/tmp/repos/game-studio-research/.worktrees/Planner': { numstat: '1\t0\ta.ts' },
      '/tmp/repos/game-studio-research/.worktrees/wt-152fb9': { numstat: '2\t0\tb.ts' }
    })
    const { svc } = mkService(panes)
    await seedCacheForPanes(svc, panes)
    const summary = svc.buildSummary('workspace-1', panes)
    expect(summary.panes.every((p) => p.repoName === 'game-studio-research')).toBe(true)
    expect(summary.repos).toHaveLength(1)
    expect(summary.repos[0].repoLabel).toBe('game-studio-research')
  })

  it('counts untracked new files (git diff skips these by default)', async () => {
    // Regression: a brand-new file Claude writes without `git add` is
    // untracked. `git diff --numstat` ignores it, but the per-pane header
    // shows it via `git status --porcelain`. The Keeper must union both so
    // it doesn't report "no changes" on panes the user just saw write files.
    const panes = [
      makePane({ id: 'p1', status: 'done', worktreePath: '/tmp/only-untracked' })
    ]
    installGitMock({
      '/tmp/only-untracked': {
        numstat: '',
        untracked: 'science.md\nanimals.md\n'
      }
    })
    const { svc } = mkService(panes)
    await seedCacheForPanes(svc, panes)
    const summary = svc.buildSummary('workspace-1', panes)
    expect(summary.totalFilesTouched).toBe(2)
    expect(summary.panes[0].filesTouched).toBe(2)
    expect(summary.panes[0].isReadyToMerge).toBe(true)
  })

  it('diffs against the merge-base, not the branch tip (sibling-merge regression)', async () => {
    // Regression: after a sibling pane's merge lands commits on main that
    // this pane doesn't have, diffing against `main` shows those sibling
    // commits as deletions from this pane's perspective. The correct
    // reference is `git merge-base HEAD main` — this pane's divergence
    // point — so the diff only shows this pane's own contribution.
    const diffArgs: string[][] = []
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        callback(null, args[2] === 'main' ? 'main-sha' : '', args[2] === 'main' ? '' : 'missing')
        if (args[2] !== 'main') callback(new Error('missing'), '', '')
        return {}
      }
      if (cmd === 'git' && args[0] === 'merge-base') {
        callback(null, 'abc1234-merge-base', '')
        return {}
      }
      if (cmd === 'git' && args[0] === 'diff') {
        diffArgs.push([...args])
        callback(null, '', '')
        return {}
      }
      if (cmd === 'git' && args[0] === 'ls-files') {
        callback(null, '', '')
        return {}
      }
      callback(new Error(`unexpected: ${cmd} ${args.join(' ')}`), '', '')
      return {}
    }) as unknown as typeof execFile)

    const pane = makePane({ id: 'p1' })
    const { svc } = mkService([pane])
    await svc.onPanePolled('p1')
    // numstat MUST be called with the merge-base SHA, not "main".
    const numstat = diffArgs.find((a) => a[1] === '--numstat')
    expect(numstat?.[2]).toBe('abc1234-merge-base')
    expect(numstat?.[2]).not.toBe('main')
  })

  it('filters .worktrees/ and .claude/ from untracked files', async () => {
    const panes = [makePane({ id: 'p1', worktreePath: '/tmp/mixed' })]
    installGitMock({
      '/tmp/mixed': {
        numstat: '',
        untracked: '.worktrees/wt-abcd/\n.claude/settings.json\nreal.md\n'
      }
    })
    const { svc } = mkService(panes)
    await seedCacheForPanes(svc, panes)
    const summary = svc.buildSummary('workspace-1', panes)
    expect(summary.totalFilesTouched).toBe(1)
    expect(summary.panes[0].filesTouched).toBe(1)
  })

  it('marks a pane ready whenever there is a non-empty diff vs base', async () => {
    // Matches per-pane merge eligibility. L-023: merging uncommitted work is
    // fine because Claudinha's merge flow auto-commits first. The Keeper does
    // not distinguish committed from uncommitted — a non-empty diff vs main
    // is the single signal.
    const panes = [
      makePane({ id: 'ready-committed', status: 'done', worktreePath: '/t/a' }),
      makePane({ id: 'ready-uncommitted', status: 'done', worktreePath: '/t/b' }),
      makePane({
        id: 'merging',
        status: 'done',
        worktreePath: '/t/c',
        completionActionStatus: { state: 'merging' } as CompletionActionStatus
      }),
      makePane({
        id: 'queued',
        status: 'done',
        worktreePath: '/t/d',
        completionActionStatus: { state: 'queued' } as CompletionActionStatus
      }),
      makePane({ id: 'working', status: 'working', worktreePath: '/t/e' }),
      makePane({ id: 'nothing', status: 'done', worktreePath: '/t/f' }),
      makePane({
        id: 'dirtymain',
        status: 'done',
        worktreePath: '/t/g',
        completionActionStatus: { state: 'dirty-main' } as CompletionActionStatus
      }),
      makePane({
        id: 'on-main',
        status: 'done',
        worktreePath: '/t/h',
        gitStatus: makeGitStatus({ branchName: 'main' })
      }),
      makePane({
        id: 'not-worktree',
        status: 'done',
        isWorktree: false,
        worktreePath: '/t/i'
      })
    ]
    installGitMock({
      '/t/a': { numstat: '1\t0\ta.ts' },
      '/t/b': { numstat: '2\t0\tb.ts' },
      '/t/c': { numstat: '3\t0\tc.ts' },
      '/t/d': { numstat: '4\t0\td.ts' },
      '/t/e': { numstat: '5\t0\te.ts' },
      '/t/f': { numstat: '' },
      '/t/g': { numstat: '7\t0\tg.ts' },
      '/t/h': { numstat: '8\t0\th.ts' },
      '/t/i': { numstat: '9\t0\ti.ts' }
    })
    const { svc } = mkService(panes)
    await seedCacheForPanes(svc, panes)
    const summary = svc.buildSummary('workspace-1', panes)
    const readyIds = summary.panes.filter((t) => t.isReadyToMerge).map((t) => t.paneId).sort()
    expect(readyIds).toEqual(['dirtymain', 'ready-committed', 'ready-uncommitted'])
    expect(summary.readyCount).toBe(3)
  })

  it('returns a stable pane shape even before any poll has populated the cache', () => {
    const panes = [makePane({ id: 'p1' })]
    const { svc } = mkService(panes)
    const summary = svc.buildSummary('workspace-1', panes)
    expect(summary.panes[0]).toMatchObject({
      paneId: 'p1',
      filesTouched: 0,
      linesAdded: 0,
      linesRemoved: 0,
      isReadyToMerge: false
    })
  })

  it('flags awaiting-plan-approval on the ReadyPaneEntry and counts it in the RepoRollup', () => {
    const panes = [
      makePane({
        id: 'approving-1',
        worktreePath: '/tmp/repos/alpha-1',
        status: 'needs-input',
        activeToolName: 'ExitPlanMode',
        permissionMode: 'plan'
      }),
      makePane({
        id: 'approving-2',
        worktreePath: '/tmp/repos/alpha-2',
        status: 'needs-input',
        permissionMode: 'plan' // fallback predicate — no activeToolName
      }),
      makePane({
        id: 'working',
        worktreePath: '/tmp/repos/alpha-3',
        status: 'working',
        permissionMode: 'plan'
      })
    ]
    const { svc } = mkService(panes)
    const summary = svc.buildSummary('workspace-1', panes)
    const flags = Object.fromEntries(
      summary.panes.map((p) => [p.paneId, p.isAwaitingPlanApproval])
    )
    expect(flags).toEqual({
      'approving-1': true,
      'approving-2': true,
      'working': false
    })
    expect(summary.repos).toHaveLength(1)
    expect(summary.repos[0].awaitingPlanApprovalCount).toBe(2)
    expect(summary.repos[0].planSequencerRunning).toBe(false)
  })

  it('projects the sequencer running flag into the RepoRollup via setPlanSequencerGetter', () => {
    const panes = [makePane({ id: 'p1', worktreePath: '/tmp/repos/alpha-1' })]
    const { svc } = mkService(panes)
    svc.setPlanSequencerGetter((workspaceId, repoPath) =>
      workspaceId === 'workspace-1' && repoPath === '/tmp/repos'
    )
    const summary = svc.buildSummary('workspace-1', panes)
    expect(summary.repos[0].planSequencerRunning).toBe(true)
  })

  it('counts errored merges in RepoRollup.erroredCount — conflict and dirty-main are excluded', () => {
    // The "Retry failed merges" button keys off `erroredCount`. Only the
    // generic 'error' completion state is auto-retryable; 'conflict' and
    // 'dirty-main' have per-pane manual recovery flows and must NOT bump
    // the counter (the button would falsely offer to retry them).
    const panes = [
      makePane({
        id: 'p-error-1',
        worktreePath: '/tmp/repos/alpha-1',
        completionActionStatus: { state: 'error', errorMessage: 'boom' } as CompletionActionStatus
      }),
      makePane({
        id: 'p-error-2',
        worktreePath: '/tmp/repos/alpha-2',
        completionActionStatus: { state: 'error', errorMessage: 'boom again' } as CompletionActionStatus
      }),
      makePane({
        id: 'p-conflict',
        worktreePath: '/tmp/repos/alpha-3',
        completionActionStatus: { state: 'conflict' } as CompletionActionStatus
      }),
      makePane({
        id: 'p-dirty',
        worktreePath: '/tmp/repos/alpha-4',
        completionActionStatus: { state: 'dirty-main', dirtyFiles: [] } as CompletionActionStatus
      }),
      makePane({
        id: 'p-ready',
        worktreePath: '/tmp/repos/alpha-5',
        completionActionStatus: null
      })
    ]
    const { svc } = mkService(panes)
    const summary = svc.buildSummary('workspace-1', panes)
    expect(summary.repos).toHaveLength(1)
    expect(summary.repos[0].erroredCount).toBe(2)
  })

  it('paneName prefers userName, then sessionTitle, then worktreeName (matches Kanban card)', () => {
    // The repo-rail row and the Kanban card must show the same label for a
    // pane, so `buildTreeEntry` goes through resolvePaneDisplayName. This test
    // locks the fallback order in place.
    const panes = [
      makePane({ id: 'named', worktreeName: 'wt-aaaaaa', userName: 'my-tree' }),
      makePane({
        id: 'titled',
        worktreeName: 'wt-bbbbbb',
        userName: null,
        metrics: { ...makeMetrics(), sessionTitle: 'cute-animal-stories' }
      }),
      makePane({ id: 'bare', worktreeName: 'wt-cccccc' })
    ]
    const { svc } = mkService(panes)
    const summary = svc.buildSummary('workspace-1', panes)
    const byId = Object.fromEntries(summary.panes.map((p) => [p.paneId, p.paneName]))
    expect(byId['named']).toBe('my-tree')
    expect(byId['titled']).toBe('cute-animal-stories')
    expect(byId['bare']).toBe('wt-cccccc')
  })
})

// ---------------------------------------------------------------------------
// Heuristic test hints
// ---------------------------------------------------------------------------

describe('isTestFilePath', () => {
  it.each([
    'src/foo/bar.test.ts',
    'src/foo/bar.spec.tsx',
    'tests/hello.ts',
    'test/hello.js',
    'src/__tests__/baz.ts',
    'something.test.py'
  ])('matches %s', (p) => {
    expect(isTestFilePath(p)).toBe(true)
  })

  it.each(['src/foo/bar.ts', 'README.md', 'package.json'])('rejects %s', (p) => {
    expect(isTestFilePath(p)).toBe(false)
  })
})

describe('findAdjacentTestFile', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-keeper-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds sibling .test.ts adjacent to a changed source file', () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'foo'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'foo', 'bar.ts'), '')
    fs.writeFileSync(path.join(tmpDir, 'src', 'foo', 'bar.test.ts'), '')
    expect(findAdjacentTestFile(tmpDir, 'src/foo/bar.ts')).toBe('src/foo/bar.test.ts')
  })

  it('finds __tests__ sibling when present', () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'foo', '__tests__'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'foo', 'bar.ts'), '')
    fs.writeFileSync(path.join(tmpDir, 'src', 'foo', '__tests__', 'bar.ts'), '')
    expect(findAdjacentTestFile(tmpDir, 'src/foo/bar.ts')).toBe('src/foo/__tests__/bar.ts')
  })

  it('returns null for files with no adjacent test', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'src', 'lonely.ts'), '')
    expect(findAdjacentTestFile(tmpDir, 'src/lonely.ts')).toBeNull()
  })

  it('returns null for non-JS/TS paths (no match)', () => {
    expect(findAdjacentTestFile(tmpDir, 'README.md')).toBeNull()
  })
})

describe('InspectorService.buildTestHints — package script detection', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-keeper-pkg-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('emits exactly one package-script hint per repo when package.json has a test script', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest' } })
    )
    const panes = [
      makePane({ id: 'p1', worktreePath: tmpDir, repoName: 'alpha' }),
      makePane({ id: 'p2', worktreePath: tmpDir, repoName: 'alpha' })
    ]
    const { svc } = mkService(panes)
    const hints = svc.buildTestHints(panes)
    const scripts = hints.filter((h) => h.kind === 'package-script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0].command).toBe('npm test')
  })

  it('omits the package-script hint when package.json is absent', () => {
    const panes = [makePane({ id: 'p1', worktreePath: tmpDir, repoName: 'alpha' })]
    const { svc } = mkService(panes)
    const hints = svc.buildTestHints(panes)
    expect(hints.filter((h) => h.kind === 'package-script')).toHaveLength(0)
  })

  it('omits the package-script hint when package.json has no test script', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc' } })
    )
    const panes = [makePane({ id: 'p1', worktreePath: tmpDir, repoName: 'alpha' })]
    const { svc } = mkService(panes)
    const hints = svc.buildTestHints(panes)
    expect(hints.filter((h) => h.kind === 'package-script')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// LLM invocation
// ---------------------------------------------------------------------------

/**
 * For the LLM tests we need git mocks AND a claude mock. One implementation
 * handles all three.
 */
function installLlmMock(claudeResult: { stdout?: string; error?: Error }) {
  mockExecFile.mockImplementation(((
    cmd: string,
    args: readonly string[],
    _opts: unknown,
    cb?: ExecFileCallback
  ) => {
    const callback = (cb ?? ((): void => {})) as ExecFileCallback
    if (cmd === 'git' && args[0] === 'rev-parse') {
      callback(null, 'main', '')
      return {}
    }
    if (cmd === 'git' && args[0] === 'merge-base') {
      callback(null, 'merge-base-sha', '')
      return {}
    }
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--numstat') {
      callback(null, '3\t1\tsrc/foo.ts', '')
      return {}
    }
    if (cmd === 'git' && args[0] === 'ls-files' && args[1] === '--others') {
      callback(null, '', '')
      return {}
    }
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--no-color') {
      callback(null, '+++ b/src/foo.ts\n@@ -1 +1,3 @@\n-old\n+new1\n+new2\n+new3', '')
      return {}
    }
    if (cmd === 'claude') {
      if (claudeResult.error) callback(claudeResult.error, '', '')
      else callback(null, claudeResult.stdout ?? '', '')
      return {}
    }
    callback(new Error(`unexpected call: ${cmd}`), '', '')
    return {}
  }) as unknown as typeof execFile)
}

describe('InspectorService.askKeeperLLM', () => {
  it('returns markdown from a successful claude subprocess', async () => {
    installLlmMock({ stdout: '## What each pane changed\n- pane did a thing.' })
    const panes = [makePane({ id: 'p1', gitStatus: makeGitStatus({ hasUncommittedChanges: true }) })]
    const { svc } = mkService(panes)
    await svc.onPanePolled('p1') // populate cache so prompt has pane section
    const report = await svc.askKeeperLLM('workspace-1')
    expect(report.markdown).toContain('What each pane changed')
    expect(report.error).toBeUndefined()
  })

  it('returns { error } when the claude subprocess fails', async () => {
    installLlmMock({ error: new Error('claude not found') })
    const panes = [makePane({ id: 'p1' })]
    const { svc } = mkService(panes)
    await svc.onPanePolled('p1')
    const report = await svc.askKeeperLLM('workspace-1')
    expect(report.markdown).toBe('')
    expect(report.error).toMatch(/claude not found/)
  })

  it('returns an empty-workspace message when the workspace has no panes', async () => {
    const { svc } = mkService([])
    const report = await svc.askKeeperLLM('workspace-1')
    expect(report.markdown).toMatch(/no active panes/i)
    expect(report.error).toBeUndefined()
  })

  it('coalesces concurrent requests for the same workspace into one subprocess', async () => {
    let claudeCalls = 0
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse') callback(null, 'main', '')
      else if (cmd === 'git' && args[0] === 'merge-base') callback(null, 'merge-base-sha', '')
      else if (cmd === 'git' && args[0] === 'diff' && args[1] === '--numstat') callback(null, '1\t0\ta.ts', '')
      else if (cmd === 'git' && args[0] === 'ls-files' && args[1] === '--others') callback(null, '', '')
      else if (cmd === 'git' && args[0] === 'diff' && args[1] === '--no-color') callback(null, 'diff', '')
      else if (cmd === 'git' && args[0] === 'branch') callback(null, 'main', '')
      else if (cmd === 'git' && args[0] === 'rev-list') callback(null, '0', '')
      else if (cmd === 'claude') {
        claudeCalls++
        setImmediate(() => callback(null, '## done', ''))
      }
      else callback(new Error(`unexpected git call: ${cmd} ${args.join(' ')}`), '', '')
      return {}
    }) as unknown as typeof execFile)

    const panes = [makePane({ id: 'p1' })]
    const { svc } = mkService(panes)
    await svc.onPanePolled('p1')
    const [a, b] = await Promise.all([
      svc.askKeeperLLM('workspace-1'),
      svc.askKeeperLLM('workspace-1')
    ])
    expect(a).toBe(b)
    expect(claudeCalls).toBe(1)
  })

  it('produces a prompt that tells the model NOT to talk about committed vs uncommitted', async () => {
    let sentPrompt = ''
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse') callback(null, 'main', '')
      else if (cmd === 'git' && args[0] === 'merge-base') callback(null, 'merge-base-sha', '')
      else if (cmd === 'git' && args[0] === 'diff' && args[1] === '--numstat') callback(null, '2\t0\ta.ts', '')
      else if (cmd === 'git' && args[0] === 'ls-files' && args[1] === '--others') callback(null, '', '')
      else if (cmd === 'git' && args[0] === 'diff' && args[1] === '--no-color') callback(null, 'diff-body', '')
      else if (cmd === 'git' && args[0] === 'branch') callback(null, 'main', '')
      else if (cmd === 'git' && args[0] === 'rev-list') callback(null, '0', '')
      else if (cmd === 'claude') {
        sentPrompt = args[1] // args[0] is '-p', args[1] is the prompt
        callback(null, '## ok', '')
      }
      else callback(new Error(`unexpected git call: ${cmd} ${args.join(' ')}`), '', '')
      return {}
    }) as unknown as typeof execFile)

    const panes = [makePane({ id: 'p1' })]
    const { svc } = mkService(panes)
    await svc.onPanePolled('p1')
    await svc.askKeeperLLM('workspace-1')
    // Explicit instructions the model must receive.
    expect(sentPrompt).toMatch(/auto-commits/i)
    expect(sentPrompt).toMatch(/do NOT dwell on the committed\/uncommitted/i)
    // The actual diff content must reach the prompt, not just stats.
    expect(sentPrompt).toContain('diff-body')
  })
})

// ---------------------------------------------------------------------------
// Broadcast gating
// ---------------------------------------------------------------------------

describe('InspectorService.onPanePolled — broadcast gating', () => {
  it('broadcasts INSPECTOR_SUMMARY when inputs change', async () => {
    const pane = makePane({ id: 'p1', worktreePath: '/t/a' })
    installGitMock({ '/t/a': { numstat: '3\t0\ta.ts' } })

    const { svc, wm } = mkService([pane])
    const sendSpy = (wm as unknown as { _sendSpy: ReturnType<typeof vi.fn> })._sendSpy
    await svc.onPanePolled('p1')
    expect(sendSpy).toHaveBeenCalledWith(
      IPC.INSPECTOR_SUMMARY,
      expect.objectContaining({
        workspaceId: 'workspace-1',
        totalPanes: 1,
        totalFilesTouched: 1,
        totalLinesAdded: 3
      })
    )
  })

  it('does not broadcast again when the inputs have not changed', async () => {
    const pane = makePane({ id: 'p1', worktreePath: '/t/a' })
    installGitMock({ '/t/a': { numstat: '3\t0\ta.ts' } })

    const { svc, wm } = mkService([pane])
    const sendSpy = (wm as unknown as { _sendSpy: ReturnType<typeof vi.fn> })._sendSpy
    await svc.onPanePolled('p1')
    await svc.onPanePolled('p1')
    const summaryBroadcasts = sendSpy.mock.calls.filter((c) => c[0] === IPC.INSPECTOR_SUMMARY)
    expect(summaryBroadcasts).toHaveLength(1)
  })

  it('does not broadcast when the workspace has no window', async () => {
    const pane = makePane({ id: 'p1', worktreePath: '/t/a' })
    installGitMock({ '/t/a': { numstat: '1\t0\ta.ts' } })

    const { svc, wm } = mkService([pane], { id: 'workspace-1', name: 'G', windowId: null })
    const sendSpy = (wm as unknown as { _sendSpy: ReturnType<typeof vi.fn> })._sendSpy
    await svc.onPanePolled('p1')
    expect(sendSpy).not.toHaveBeenCalled()
  })

  // Regression test for the repo-pane stale-dots bug: per-pane IPC.PANE_STATUS
  // updates were reaching the renderer fine, but the repo-pane summary was
  // only rebroadcast on the 30s git poll, so the dots could be minutes stale.
  // Fix wires SessionRegistry.onAnyStatusChange to inspector.broadcastSummary
  // in index.ts; this test mirrors that wiring with a real registry and
  // confirms the summary goes out with the new paneStatus.
  it('broadcasts INSPECTOR_SUMMARY with updated paneStatus when registry status flips', () => {
    const registry = new SessionRegistry()
    const wm = createMockWindowManager() as unknown as import('../src/main/window-manager').WindowManager
    const hm = makeWorkspaceManager({ id: 'workspace-1', name: 'Workspace', windowId: 'win-1' })
    const svc = new InspectorService(registry, hm, wm)
    registry.registerPane(makePane({ id: 'p1', status: 'awaiting-prompt' }))

    // Mirror index.ts wiring
    registry.onAnyStatusChange((paneId) => {
      const pane = registry.getPane(paneId)
      if (!pane) return
      svc.broadcastSummary(pane.workspaceId)
    })

    const sendSpy = (wm as unknown as { _sendSpy: ReturnType<typeof vi.fn> })._sendSpy
    registry.updatePaneStatus('p1', 'working', 'hook')

    const summaryCalls = sendSpy.mock.calls.filter((c) => c[0] === IPC.INSPECTOR_SUMMARY)
    expect(summaryCalls).toHaveLength(1)
    const payload = summaryCalls[0][1] as { panes: Array<{ paneId: string; paneStatus: string }> }
    expect(payload.panes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paneId: 'p1', paneStatus: 'working' })
      ])
    )
  })
})
