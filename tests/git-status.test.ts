/**
 * git-status module unit tests.
 *
 * Tests all exported functions from src/main/git-status.ts with mocked
 * child_process.execFile so no real git commands are executed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'util'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

// The real execFile has a [util.promisify.custom] symbol so that
// promisify(execFile) returns { stdout, stderr } instead of just stdout.
// We use vi.hoisted() to create mock variables that are available inside the
// hoisted vi.mock() factory, then attach the custom promisify symbol so
// promisify(execFile) returns our controllable mockExecFileAsync.

const { mockExecFileAsync, mockExecFileCb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { promisify } = require('util')
  const mockExecFileAsync = vi.fn()
  const mockExecFileCb = vi.fn()
  ;(mockExecFileCb as any)[promisify.custom] = mockExecFileAsync
  return { mockExecFileAsync, mockExecFileCb }
})

vi.mock('child_process', () => ({
  execFile: mockExecFileCb
}))

import {
  countUserChangedFiles,
  getGitStatus,
  gitCommitAll,
  gitWorktreeRemove,
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
  ghCliAvailable
} from '../src/main/git-status'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure mockExecFileAsync to resolve/reject in sequence.
 * Each entry is [error, stdout, stderr].
 * When error is non-null, the call rejects; otherwise it resolves { stdout, stderr }.
 */
function mockExecSequence(results: Array<[Error | null, string, string]>) {
  let callIndex = 0
  mockExecFileAsync.mockImplementation(() => {
    const entry = results[callIndex] ?? [new Error('unexpected extra call'), '', '']
    callIndex++
    if (entry[0]) {
      return Promise.reject(entry[0])
    }
    return Promise.resolve({ stdout: entry[1], stderr: entry[2] })
  })
}

/**
 * Shorthand: mock all calls to succeed with the given stdout values.
 */
function mockExecSuccess(...stdouts: string[]) {
  mockExecSequence(stdouts.map((s) => [null, s, '']))
}

/**
 * Shorthand: mock all calls to fail with the given error messages.
 */
function mockExecFailure(...messages: string[]) {
  mockExecSequence(messages.map((m) => [new Error(m), '', '']))
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// countUserChangedFiles — pure helper, regression coverage for the
// porcelain-parsing bug where `.trim()` on the whole stdout stripped the
// leading-space status column from the first line and corrupted its filename.
// ---------------------------------------------------------------------------

describe('countUserChangedFiles', () => {
  it('returns 0 for empty input', () => {
    expect(countUserChangedFiles('')).toBe(0)
  })

  it('counts a single user-modified file', () => {
    expect(countUserChangedFiles(' M src/foo.ts\n')).toBe(1)
  })

  it('filters .claude/settings.json when it is the ONLY entry and worktree-modified (regression for first-line trim bug)', () => {
    // This is the exact bug that produced "Done - 1 modified" in the UI:
    // git status --porcelain emits two leading spaces (X column empty, Y='M')
    // for a worktree-only-modified tracked file. Calling .trim() on the whole
    // stdout would strip those leading spaces from the first line and corrupt
    // the filename, causing the .claude/ filter to miss it.
    expect(countUserChangedFiles(' M .claude/settings.json\n')).toBe(0)
  })

  it('filters .claude/settings.json when it is the FIRST line and another real change follows', () => {
    expect(
      countUserChangedFiles(' M .claude/settings.json\n M src/foo.ts\n')
    ).toBe(1)
  })

  it('filters untracked .claude/ as the first line', () => {
    expect(countUserChangedFiles('?? .claude/\n')).toBe(0)
  })

  it('filters bare .claude entry', () => {
    expect(countUserChangedFiles('?? .claude\n')).toBe(0)
  })

  it('filters .worktrees/ (Claudinha creates linked worktree roots there)', () => {
    // Regression: without this filter, a fresh-init workspace's own `.worktrees/`
    // directory shows as 1 uncommitted file in main and blocks every merge.
    expect(countUserChangedFiles('?? .worktrees/\n')).toBe(0)
    expect(countUserChangedFiles('?? .worktrees/wt-abcd/\n')).toBe(0)
    expect(countUserChangedFiles('?? .worktrees\n')).toBe(0)
  })

  it('filters .worktrees/ alongside real changes', () => {
    expect(
      countUserChangedFiles('?? .worktrees/\n M src/real.ts\n')
    ).toBe(1)
  })

  it('counts mixed staged + worktree statuses correctly', () => {
    // 'MM' = staged-modified AND worktree-modified
    // ' M' = worktree-only modified
    // 'A ' = staged-added only
    // '??' = untracked
    expect(
      countUserChangedFiles('MM file1.ts\n M file2.ts\nA  file3.ts\n?? file4.ts\n')
    ).toBe(4)
  })

  it('ignores trailing newline without losing the last line', () => {
    expect(countUserChangedFiles(' M a.ts\n M b.ts\n')).toBe(2)
  })

  it('handles output with no trailing newline', () => {
    expect(countUserChangedFiles(' M a.ts')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// getGitStatus
// ---------------------------------------------------------------------------

describe('getGitStatus', () => {
  it('returns GitStatus with correct changedFileCount, commitsAhead, branchName', async () => {
    // getGitStatus fires 3 concurrent calls:
    //   1) git status --porcelain
    //   2) git branch --show-current
    //   3) git rev-list --count main..HEAD  (getCommitsAhead — tries 'main' first)
    mockExecSequence([
      [null, ' M file1.ts\n M file2.ts\n?? newfile.ts\n', ''],
      [null, 'feature-branch\n', ''],
      [null, '3\n', '']
    ])

    const result = await getGitStatus('/repo/worktree')

    expect(result).toEqual({
      hasUncommittedChanges: true,
      changedFileCount: 3,
      commitsAhead: 3,
      branchName: 'feature-branch'
    })
  })

  it('filters out .claude/ entries from porcelain output', async () => {
    mockExecSequence([
      [null, '?? .claude/\n?? .claude/settings.json\n M real-file.ts\n', ''],
      [null, 'main\n', ''],
      [null, '0\n', '']
    ])

    const result = await getGitStatus('/repo/worktree')

    expect(result).not.toBeNull()
    expect(result!.changedFileCount).toBe(1)
    expect(result!.hasUncommittedChanges).toBe(true)
  })

  it('filters out bare .claude entry', async () => {
    mockExecSequence([
      [null, '?? .claude\n', ''],
      [null, 'main\n', ''],
      [null, '0\n', '']
    ])

    const result = await getGitStatus('/repo/worktree')

    expect(result).not.toBeNull()
    expect(result!.changedFileCount).toBe(0)
    expect(result!.hasUncommittedChanges).toBe(false)
  })

  it('filters .claude/settings.json when it is the only worktree-modified entry (regression: spawn-time config edits must not show as user changes)', async () => {
    mockExecSequence([
      [null, ' M .claude/settings.json\n', ''],
      [null, 'feature\n', ''],
      [null, '0\n', '']
    ])

    const result = await getGitStatus('/repo/worktree')

    expect(result).not.toBeNull()
    expect(result!.changedFileCount).toBe(0)
    expect(result!.hasUncommittedChanges).toBe(false)
  })

  it('returns null on error (e.g., not a git repo)', async () => {
    // All three concurrent calls fail
    mockExecSequence([
      [new Error('not a git repository'), '', ''],
      [new Error('not a git repository'), '', ''],
      [new Error('not a git repository'), '', '']
    ])

    const result = await getGitStatus('/not-a-repo')

    expect(result).toBeNull()
  })

  it('handles clean worktree (0 changes, 0 ahead)', async () => {
    mockExecSequence([
      [null, '', ''],       // empty porcelain = clean
      [null, 'main\n', ''],
      [null, '0\n', '']
    ])

    const result = await getGitStatus('/repo/worktree')

    expect(result).toEqual({
      hasUncommittedChanges: false,
      changedFileCount: 0,
      commitsAhead: 0,
      branchName: 'main'
    })
  })

  it('returns null when status sub-command fails but others succeed', async () => {
    // status fails, branch and rev-list succeed
    mockExecSequence([
      [new Error('status failed'), '', ''],
      [null, 'feature\n', ''],
      [null, '2\n', '']
    ])

    const result = await getGitStatus('/repo/worktree')

    expect(result).toBeNull()
  })

  it('falls back to master for commitsAhead when main does not exist', async () => {
    // getGitStatus fires 3 concurrent calls. The third (getCommitsAhead) internally
    // does rev-list main..HEAD (fails) then rev-list master..HEAD (succeeds).
    // So we need 4 total calls: status, branch, rev-list(main fail), rev-list(master ok).
    mockExecSequence([
      [null, ' M file.ts\n', ''],                  // git status --porcelain
      [null, 'feature\n', ''],                       // git branch --show-current
      [new Error('unknown revision main'), '', ''],  // git rev-list main..HEAD — fails
      [null, '5\n', '']                              // git rev-list master..HEAD — succeeds
    ])

    const result = await getGitStatus('/repo/worktree')

    expect(result).not.toBeNull()
    expect(result!.commitsAhead).toBe(5)
  })

  it('handles null branchName when branch query fails', async () => {
    mockExecSequence([
      [null, '', ''],                                  // clean status
      [new Error('detached HEAD'), '', ''],             // branch fails
      [null, '0\n', '']                                // rev-list
    ])

    const result = await getGitStatus('/repo/worktree')

    expect(result).not.toBeNull()
    expect(result!.branchName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// gitCommitAll
// ---------------------------------------------------------------------------

describe('gitCommitAll', () => {
  it('calls git add -A then git commit -m <msg>', async () => {
    mockExecSequence([
      [null, '', ''],  // git add -A
      [null, '', '']   // git commit -m
    ])

    const result = await gitCommitAll('/repo/worktree', 'my commit message')

    expect(result).toBeNull()
    // Verify git add -A was called
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'git', ['add', '-A'],
      expect.objectContaining({ cwd: '/repo/worktree' })
    )
    // Verify git commit with the provided message
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'git', ['commit', '-m', 'my commit message'],
      expect.objectContaining({ cwd: '/repo/worktree' })
    )
  })

  it('uses default message when none provided', async () => {
    mockExecSequence([
      [null, '', ''],
      [null, '', '']
    ])

    await gitCommitAll('/repo/worktree')

    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'git', ['commit', '-m', 'claudinha: auto-commit on close'],
      expect.objectContaining({ cwd: '/repo/worktree' })
    )
  })

  it('returns null on success', async () => {
    mockExecSequence([
      [null, '', ''],
      [null, '', '']
    ])

    const result = await gitCommitAll('/repo/worktree', 'msg')

    expect(result).toBeNull()
  })

  it('returns null when "nothing to commit"', async () => {
    mockExecSequence([
      [null, '', ''],
      [new Error('nothing to commit, working pane clean'), '', '']
    ])

    const result = await gitCommitAll('/repo/worktree', 'msg')

    expect(result).toBeNull()
  })

  it('returns error message on failure', async () => {
    mockExecSequence([
      [null, '', ''],
      [new Error('commit failed: lock file exists'), '', '']
    ])

    const result = await gitCommitAll('/repo/worktree', 'msg')

    expect(result).toBe('commit failed: lock file exists')
  })
})

// ---------------------------------------------------------------------------
// gitWorktreeRemove
// ---------------------------------------------------------------------------

describe('gitWorktreeRemove', () => {
  it('returns null on success', async () => {
    mockExecSequence([
      [null, '/repo/.git\n', ''],   // getMainRepoPath: git rev-parse --git-common-dir
      [null, '', '']                  // git worktree remove --force
    ])

    const result = await gitWorktreeRemove('/repo/worktrees/feature')

    expect(result).toBeNull()
  })

  it('returns error string on failure', async () => {
    mockExecSequence([
      [null, '/repo/.git\n', ''],                  // getMainRepoPath succeeds
      [new Error('worktree remove failed'), '', ''] // remove fails
    ])

    const result = await gitWorktreeRemove('/repo/worktrees/feature')

    expect(result).toBe('worktree remove failed')
  })

  it('returns error when repo root cannot be determined', async () => {
    mockExecSequence([
      [new Error('not a git repo'), '', '']  // getMainRepoPath fails
    ])

    const result = await gitWorktreeRemove('/not/a/repo')

    expect(result).toBe('Could not determine main repository path.')
  })
})

// ---------------------------------------------------------------------------
// detectMainBranch
// ---------------------------------------------------------------------------

describe('detectMainBranch', () => {
  it("returns 'main' if it exists", async () => {
    mockExecSuccess('abc123\n')

    const result = await detectMainBranch('/repo')

    expect(result).toBe('main')
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'git', ['rev-parse', '--verify', 'main'],
      expect.objectContaining({ cwd: '/repo' })
    )
  })

  it("falls back to 'master'", async () => {
    mockExecSequence([
      [new Error('unknown revision main'), '', ''],  // main fails
      [null, 'def456\n', '']                          // master succeeds
    ])

    const result = await detectMainBranch('/repo')

    expect(result).toBe('master')
  })

  it('returns null if neither exists', async () => {
    mockExecSequence([
      [new Error('unknown revision main'), '', ''],
      [new Error('unknown revision master'), '', '']
    ])

    const result = await detectMainBranch('/repo')

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isWorkingTreeClean
// ---------------------------------------------------------------------------

describe('isWorkingTreeClean', () => {
  it('returns true for clean directory', async () => {
    mockExecSuccess('')

    const result = await isWorkingTreeClean('/repo')

    expect(result).toBe(true)
  })

  it('returns false for dirty directory', async () => {
    mockExecSuccess(' M dirty-file.ts\n')

    const result = await isWorkingTreeClean('/repo')

    expect(result).toBe(false)
  })

  it('filters .claude/ entries — returns true if only .claude changes', async () => {
    mockExecSuccess('?? .claude/\n?? .claude/settings.json\n')

    const result = await isWorkingTreeClean('/repo')

    expect(result).toBe(true)
  })

  it('returns true when only .claude/settings.json is worktree-modified as the first line (regression for first-line trim bug)', async () => {
    mockExecSuccess(' M .claude/settings.json\n')

    const result = await isWorkingTreeClean('/repo')

    expect(result).toBe(true)
  })

  it('returns false on error', async () => {
    mockExecFailure('not a git repo')

    const result = await isWorkingTreeClean('/repo')

    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// listChangedFiles
// ---------------------------------------------------------------------------

describe('listChangedFiles', () => {
  it('returns empty result for clean working pane', async () => {
    mockExecSuccess('')

    const result = await listChangedFiles('/repo')

    expect(result).toEqual({ files: [], totalCount: 0 })
  })

  it('parses porcelain output and strips status prefix', async () => {
    mockExecSuccess(' M src/a.ts\n?? newfile.md\nMM staged.ts\n')

    const result = await listChangedFiles('/repo')

    expect(result.files).toEqual(['src/a.ts', 'newfile.md', 'staged.ts'])
    expect(result.totalCount).toBe(3)
  })

  it('filters out .claude/ entries', async () => {
    mockExecSuccess(' M .claude/settings.json\n M src/foo.ts\n?? .claude/\n')

    const result = await listChangedFiles('/repo')

    expect(result.files).toEqual(['src/foo.ts'])
    expect(result.totalCount).toBe(1)
  })

  it('preserves filenames containing spaces (leading space in status column is not trimmed)', async () => {
    mockExecSuccess(' M dir/file with spaces.ts\n')

    const result = await listChangedFiles('/repo')

    expect(result.files).toEqual(['dir/file with spaces.ts'])
  })

  it('caps the files array at `max` but reports full totalCount', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => ` M file${i}.ts`).join('\n') + '\n'
    mockExecSuccess(lines)

    const result = await listChangedFiles('/repo', 5)

    expect(result.files).toHaveLength(5)
    expect(result.files[0]).toBe('file0.ts')
    expect(result.totalCount).toBe(25)
  })

  it('returns empty result on execFile error', async () => {
    mockExecFailure('not a git repo')

    const result = await listChangedFiles('/repo')

    expect(result).toEqual({ files: [], totalCount: 0 })
  })
})

// ---------------------------------------------------------------------------
// merge functions — gitRebase, gitMergeFf, gitMergeSquash, gitMergeNoFf
// ---------------------------------------------------------------------------

describe('merge functions', () => {
  describe('gitRebase', () => {
    it('returns null on success', async () => {
      mockExecSuccess('')

      const result = await gitRebase('/worktree', 'main')

      expect(result).toBeNull()
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git', ['rebase', 'main'],
        expect.objectContaining({ cwd: '/worktree' })
      )
    })

    it('returns error string on failure', async () => {
      mockExecFailure('CONFLICT (content): merge conflict in file.ts')

      const result = await gitRebase('/worktree', 'main')

      expect(result).toBe('CONFLICT (content): merge conflict in file.ts')
    })
  })

  describe('gitRebaseAbort', () => {
    it('returns null on success', async () => {
      mockExecSuccess('')

      const result = await gitRebaseAbort('/worktree')

      expect(result).toBeNull()
    })

    it('returns error string on failure', async () => {
      mockExecFailure('no rebase in progress')

      const result = await gitRebaseAbort('/worktree')

      expect(result).toBe('no rebase in progress')
    })
  })

  describe('gitMergeFf', () => {
    it('returns null on success', async () => {
      mockExecSuccess('')

      const result = await gitMergeFf('/repo', 'feature-branch')

      expect(result).toBeNull()
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git', ['merge', '--ff-only', 'feature-branch'],
        expect.objectContaining({ cwd: '/repo' })
      )
    })

    it('returns error string on failure', async () => {
      mockExecFailure('Not possible to fast-forward, aborting.')

      const result = await gitMergeFf('/repo', 'feature-branch')

      expect(result).toBe('Not possible to fast-forward, aborting.')
    })
  })

  describe('gitMergeSquash', () => {
    it('returns null on success (squash + commit)', async () => {
      mockExecSequence([
        [null, '', ''],  // git merge --squash
        [null, '', '']   // git commit -m
      ])

      const result = await gitMergeSquash('/repo', 'feature-branch', 'squash commit msg')

      expect(result).toBeNull()
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git', ['merge', '--squash', 'feature-branch'],
        expect.objectContaining({ cwd: '/repo' })
      )
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git', ['commit', '-m', 'squash commit msg'],
        expect.objectContaining({ cwd: '/repo' })
      )
    })

    it('uses default commit message when none provided', async () => {
      mockExecSequence([
        [null, '', ''],
        [null, '', '']
      ])

      await gitMergeSquash('/repo', 'feature-branch')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git', ['commit', '-m', "squash merge branch 'feature-branch'"],
        expect.objectContaining({ cwd: '/repo' })
      )
    })

    it('returns error string on failure', async () => {
      mockExecFailure('merge conflict during squash')

      const result = await gitMergeSquash('/repo', 'feature-branch')

      expect(result).toBe('merge conflict during squash')
    })
  })

  describe('gitMergeNoFf', () => {
    it('returns null on success', async () => {
      mockExecSuccess('')

      const result = await gitMergeNoFf('/repo', 'feature-branch')

      expect(result).toBeNull()
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git', ['merge', '--no-ff', 'feature-branch'],
        expect.objectContaining({ cwd: '/repo' })
      )
    })

    it('returns error string on failure', async () => {
      mockExecFailure('merge conflict')

      const result = await gitMergeNoFf('/repo', 'feature-branch')

      expect(result).toBe('merge conflict')
    })
  })

  describe('gitMergeAbort', () => {
    it('returns null on success', async () => {
      mockExecSuccess('')

      const result = await gitMergeAbort('/repo')

      expect(result).toBeNull()
    })

    it('returns error string on failure', async () => {
      mockExecFailure('no merge in progress')

      const result = await gitMergeAbort('/repo')

      expect(result).toBe('no merge in progress')
    })
  })

  describe('gitPush', () => {
    it('returns null on success', async () => {
      mockExecSuccess('')

      const result = await gitPush('/worktree', 'feature-branch')

      expect(result).toBeNull()
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git', ['push', '-u', 'origin', 'feature-branch'],
        expect.objectContaining({ cwd: '/worktree' })
      )
    })

    it('returns error string on failure', async () => {
      mockExecFailure('permission denied')

      const result = await gitPush('/worktree', 'feature-branch')

      expect(result).toBe('permission denied')
    })
  })
})

// ---------------------------------------------------------------------------
// ghCreatePr
// ---------------------------------------------------------------------------

describe('ghCreatePr', () => {
  it('returns { error: null, prUrl } on success', async () => {
    mockExecSuccess('https://github.com/org/repo/pull/42\n')

    const result = await ghCreatePr('/worktree', 'Fix bug', 'Fixes the bug', false)

    expect(result).toEqual({
      error: null,
      prUrl: 'https://github.com/org/repo/pull/42'
    })
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'gh', ['pr', 'create', '--title', 'Fix bug', '--body', 'Fixes the bug'],
      expect.objectContaining({ cwd: '/worktree' })
    )
  })

  it('passes --draft flag when draft is true', async () => {
    mockExecSuccess('https://github.com/org/repo/pull/43\n')

    await ghCreatePr('/worktree', 'Draft PR', 'WIP', true)

    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'gh', ['pr', 'create', '--title', 'Draft PR', '--body', 'WIP', '--draft'],
      expect.objectContaining({ cwd: '/worktree' })
    )
  })

  it('returns { error: string } on failure', async () => {
    mockExecFailure('gh: not authenticated')

    const result = await ghCreatePr('/worktree', 'title', 'body', false)

    expect(result).toEqual({ error: 'gh: not authenticated' })
    expect(result.prUrl).toBeUndefined()
  })

  it('returns prUrl as undefined when stdout is empty', async () => {
    mockExecSuccess('')

    const result = await ghCreatePr('/worktree', 'title', 'body', false)

    expect(result.error).toBeNull()
    expect(result.prUrl).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ghCliAvailable
// ---------------------------------------------------------------------------

describe('ghCliAvailable', () => {
  it('returns true when gh auth status succeeds', async () => {
    mockExecSuccess('')

    const result = await ghCliAvailable()

    expect(result).toBe(true)
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'gh', ['auth', 'status'],
      expect.objectContaining({ timeout: 5_000 })
    )
  })

  it('returns false when it fails', async () => {
    mockExecFailure('not logged in')

    const result = await ghCliAvailable()

    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getMainRepoPath
// ---------------------------------------------------------------------------

describe('getMainRepoPath', () => {
  it('returns repo root by stripping /.git suffix', async () => {
    mockExecSuccess('/Users/scott/projects/my-repo/.git\n')

    const result = await getMainRepoPath('/Users/scott/projects/my-repo/worktrees/feature')

    expect(result).toBe('/Users/scott/projects/my-repo')
  })

  it('returns the dir itself for bare repos (no /.git suffix)', async () => {
    mockExecSuccess('/Users/scott/projects/bare-repo.git\n')

    const result = await getMainRepoPath('/Users/scott/projects/bare-repo.git/worktrees/feature')

    expect(result).toBe('/Users/scott/projects/bare-repo.git')
  })

  it('returns null on error', async () => {
    mockExecFailure('not a git repo')

    const result = await getMainRepoPath('/not/a/repo')

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getCurrentBranch
// ---------------------------------------------------------------------------

describe('getCurrentBranch', () => {
  it('returns the current branch name', async () => {
    mockExecSuccess('feature-branch\n')

    const result = await getCurrentBranch('/repo')

    expect(result).toBe('feature-branch')
  })

  it('returns null on error', async () => {
    mockExecFailure('not a git repo')

    const result = await getCurrentBranch('/repo')

    expect(result).toBeNull()
  })

  it('returns null for empty stdout (detached HEAD)', async () => {
    mockExecSuccess('')

    const result = await getCurrentBranch('/repo')

    expect(result).toBeNull()
  })
})
