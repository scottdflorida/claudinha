/**
 * git-dirty-main — unit tests for the Kanban dirty-main resolution helpers.
 *
 * Each helper goes through `runGitWithLockRetry` (from git-status) for the
 * write-side git calls, which in turn calls promisified `execFile`. Tests
 * mock `execFile` at the child_process boundary so no real git commands fire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mock for child_process.execFile — mirrors tests/git-status.test.ts.
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
  commitDirtyMain,
  stashDirtyMain,
  discardDirtyMain
} from '../src/main/git-dirty-main'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InvocationRecord {
  args: string[]
}

function mockExecSuccess(): InvocationRecord[] {
  const calls: InvocationRecord[] = []
  mockExecFileAsync.mockImplementation((_cmd: string, args: string[]) => {
    calls.push({ args })
    return Promise.resolve({ stdout: '', stderr: '' })
  })
  return calls
}

function mockPorcelain(stdout: string): void {
  // Single-shot: only the next call resolves with this stdout.
  mockExecFileAsync.mockImplementationOnce(() => Promise.resolve({ stdout, stderr: '' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// commitDirtyMain
// ---------------------------------------------------------------------------

describe('commitDirtyMain', () => {
  it('stages the file list and commits with the given message', async () => {
    const calls = mockExecSuccess()
    const err = await commitDirtyMain('/repo', 'WIP', ['README.md', 'src/foo.ts'])
    expect(err).toBeNull()
    expect(calls).toHaveLength(2)
    expect(calls[0].args).toEqual(['add', '--', 'README.md', 'src/foo.ts'])
    expect(calls[1].args).toEqual(['commit', '-m', 'WIP'])
  })

  it('filters Claudinha infrastructure paths before staging', async () => {
    const calls = mockExecSuccess()
    const err = await commitDirtyMain('/repo', 'WIP', [
      'README.md',
      '.worktrees/foo/bar.ts',
      '.claude/settings.json',
      'src/app.ts'
    ])
    expect(err).toBeNull()
    // Only the user files should have been staged.
    expect(calls[0].args).toEqual(['add', '--', 'README.md', 'src/app.ts'])
  })

  it('returns an error when the filtered file list is empty', async () => {
    mockExecSuccess()
    const err = await commitDirtyMain('/repo', 'WIP', ['.worktrees/foo', '.claude/settings.json'])
    expect(err).toBe('Nothing to commit.')
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })

  it('rejects an empty commit message', async () => {
    mockExecSuccess()
    const err = await commitDirtyMain('/repo', '   ', ['README.md'])
    expect(err).toBe('Commit message cannot be empty.')
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })

  it('trims whitespace from the commit message', async () => {
    const calls = mockExecSuccess()
    await commitDirtyMain('/repo', '  hello world  ', ['README.md'])
    expect(calls[1].args).toEqual(['commit', '-m', 'hello world'])
  })

  it('treats "nothing to commit" as a successful no-op', async () => {
    // Stage succeeds; commit rejects with the benign message.
    mockExecFileAsync.mockImplementationOnce(() => Promise.resolve({ stdout: '', stderr: '' }))
    mockExecFileAsync.mockImplementationOnce(() =>
      Promise.reject(new Error('nothing to commit, working tree clean'))
    )
    const err = await commitDirtyMain('/repo', 'WIP', ['README.md'])
    expect(err).toBeNull()
  })

  it('surfaces a real commit failure', async () => {
    mockExecFileAsync.mockImplementationOnce(() => Promise.resolve({ stdout: '', stderr: '' }))
    mockExecFileAsync.mockImplementationOnce(() => Promise.reject(new Error('hook rejected')))
    const err = await commitDirtyMain('/repo', 'WIP', ['README.md'])
    expect(err).toBe('hook rejected')
  })
})

// ---------------------------------------------------------------------------
// stashDirtyMain
// ---------------------------------------------------------------------------

describe('stashDirtyMain', () => {
  it('stashes the filtered file list with -u and the given message', async () => {
    const calls = mockExecSuccess()
    const err = await stashDirtyMain('/repo', 'pre-merge', ['README.md', 'docs/notes.md'])
    expect(err).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual([
      'stash', 'push', '-u', '-m', 'pre-merge', '--', 'README.md', 'docs/notes.md'
    ])
  })

  it('filters infrastructure paths', async () => {
    const calls = mockExecSuccess()
    await stashDirtyMain('/repo', 'pre-merge', [
      '.worktrees/x/file',
      'README.md',
      '.claude/settings.json'
    ])
    expect(calls[0].args).toEqual([
      'stash', 'push', '-u', '-m', 'pre-merge', '--', 'README.md'
    ])
  })

  it('returns an error on an empty filtered set', async () => {
    mockExecSuccess()
    const err = await stashDirtyMain('/repo', 'pre-merge', ['.claude/a', '.worktrees/b'])
    expect(err).toBe('Nothing to stash.')
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })

  it('rejects an empty stash message', async () => {
    mockExecSuccess()
    const err = await stashDirtyMain('/repo', '  ', ['README.md'])
    expect(err).toBe('Stash message cannot be empty.')
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })

  it('treats "No local changes to save" as a successful no-op', async () => {
    mockExecFileAsync.mockImplementationOnce(() =>
      Promise.reject(new Error('No local changes to save'))
    )
    const err = await stashDirtyMain('/repo', 'pre-merge', ['README.md'])
    expect(err).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// discardDirtyMain
// ---------------------------------------------------------------------------

describe('discardDirtyMain', () => {
  it('routes tracked files to git restore and untracked to git clean', async () => {
    // First call: porcelain classification.
    mockPorcelain(' M src/foo.ts\n?? newfile.txt\n')
    // Subsequent calls (restore, clean) succeed.
    const calls: InvocationRecord[] = []
    mockExecFileAsync.mockImplementation((_cmd: string, args: string[]) => {
      calls.push({ args })
      return Promise.resolve({ stdout: '', stderr: '' })
    })
    const err = await discardDirtyMain('/repo', ['src/foo.ts', 'newfile.txt'])
    expect(err).toBeNull()
    // Restore for tracked, clean for untracked.
    const argLists = calls.map((c) => c.args)
    expect(argLists).toContainEqual(['restore', '--staged', '--worktree', '--', 'src/foo.ts'])
    expect(argLists).toContainEqual(['clean', '-fd', '--', 'newfile.txt'])
  })

  it('filters infrastructure paths BEFORE classifying', async () => {
    // Porcelain mock — called with the full working tree, but the classifier
    // only looks up the filtered set, so only README.md matters here.
    mockPorcelain(' M README.md\n?? .worktrees/x/file\n')
    const calls: InvocationRecord[] = []
    mockExecFileAsync.mockImplementation((_cmd: string, args: string[]) => {
      calls.push({ args })
      return Promise.resolve({ stdout: '', stderr: '' })
    })
    const err = await discardDirtyMain('/repo', [
      'README.md',
      '.worktrees/x/file',
      '.claude/settings.json'
    ])
    expect(err).toBeNull()
    // Only README.md should have been routed to restore/clean.
    const argLists = calls.map((c) => c.args)
    expect(argLists).toContainEqual(['restore', '--staged', '--worktree', '--', 'README.md'])
    expect(argLists).not.toContainEqual(
      expect.arrayContaining(['.worktrees/x/file'])
    )
    expect(argLists).not.toContainEqual(
      expect.arrayContaining(['.claude/settings.json'])
    )
  })

  it('skips files whose classification is unknown (already clean)', async () => {
    // Porcelain reports nothing — the requested file is already clean.
    mockPorcelain('')
    const calls: InvocationRecord[] = []
    mockExecFileAsync.mockImplementation((_cmd: string, args: string[]) => {
      calls.push({ args })
      return Promise.resolve({ stdout: '', stderr: '' })
    })
    const err = await discardDirtyMain('/repo', ['already-clean.ts'])
    expect(err).toBeNull()
    // No restore or clean call — nothing to do.
    expect(calls).toHaveLength(0)
  })

  it('returns an error on an empty filtered file list', async () => {
    const err = await discardDirtyMain('/repo', ['.claude/foo'])
    expect(err).toBe('Nothing to discard.')
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })

  it('surfaces restore failures', async () => {
    mockPorcelain(' M src/foo.ts\n')
    mockExecFileAsync.mockImplementationOnce(() =>
      Promise.reject(new Error('fatal: restore failed'))
    )
    const err = await discardDirtyMain('/repo', ['src/foo.ts'])
    expect(err).toBe('fatal: restore failed')
  })
})
