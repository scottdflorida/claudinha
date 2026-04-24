/**
 * Unit tests for ensureRepoHasInitialCommit (src/main/ipc-handlers.ts).
 *
 * Verifies the unborn-HEAD detection + auto-commit fallback that lets Claudinha
 * create worktrees off freshly-`git init`'d repos that scaffolding tools
 * (e.g. `npx create-expo-app`) leave commit-less.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock child_process.execFileSync — the only thing the helper touches
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  // ipc-handlers.ts also pulls in execFile via promisify at module load,
  // so we have to provide it (even unused by these tests).
  execFile: vi.fn((_bin, _args, _opts, cb) => cb && cb(null, '', ''))
}))

// ipc-handlers.ts imports a long list of electron / pty / fs modules at the
// top, none of which are needed for this test. Stub the heavy ones so the
// import is cheap and side-effect-free.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: {},
  BrowserWindow: class {},
  dialog: {},
  app: { getAppPath: vi.fn(() => '/app') }
}))

import { execFileSync } from 'child_process'
import { ensureRepoHasInitialCommit } from '../src/main/ipc-handlers'

const mockExec = vi.mocked(execFileSync)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureRepoHasInitialCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when HEAD already points at a commit', () => {
    // rev-parse succeeds → repo has commits → return early
    mockExec.mockImplementationOnce(() => Buffer.from('abc123\n'))

    ensureRepoHasInitialCommit('/tmp/repo')

    // Only the rev-parse call should have happened — no commit attempt
    expect(mockExec).toHaveBeenCalledTimes(1)
    expect(mockExec).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--verify', 'HEAD'],
      expect.objectContaining({ cwd: '/tmp/repo' })
    )
  })

  it('creates an empty commit when HEAD is unborn and the user has git identity set', () => {
    // First call (rev-parse) fails — HEAD is unborn
    // Second call (commit) succeeds — git config is fine
    mockExec
      .mockImplementationOnce(() => { throw new Error('fatal: ambiguous argument HEAD') })
      .mockImplementationOnce(() => Buffer.from(''))

    ensureRepoHasInitialCommit('/tmp/repo')

    expect(mockExec).toHaveBeenCalledTimes(2)
    expect(mockExec).toHaveBeenNthCalledWith(
      2,
      'git',
      ['commit', '--allow-empty', '-m', 'Initial commit (created by Claudinha)'],
      expect.objectContaining({ cwd: '/tmp/repo' })
    )
  })

  it('falls back to inline `-c user.email -c user.name` if the first commit attempt fails', () => {
    // rev-parse fails (unborn HEAD)
    // first commit fails (no git identity)
    // second commit (with -c flags) succeeds
    mockExec
      .mockImplementationOnce(() => { throw new Error('fatal: ambiguous argument HEAD') })
      .mockImplementationOnce(() => { throw new Error('Please tell me who you are') })
      .mockImplementationOnce(() => Buffer.from(''))

    ensureRepoHasInitialCommit('/tmp/repo')

    expect(mockExec).toHaveBeenCalledTimes(3)
    const [bin, args] = mockExec.mock.calls[2] as [string, string[]]
    expect(bin).toBe('git')
    // The fallback uses `-c user.email=... -c user.name=...` BEFORE `commit`
    expect(args).toEqual([
      '-c', 'user.email=claudinha@local',
      '-c', 'user.name=Claudinha',
      'commit', '--allow-empty', '-m', 'Initial commit (created by Claudinha)'
    ])
  })

  it('throws if the fallback commit also fails (caller decides what to do)', () => {
    mockExec
      .mockImplementationOnce(() => { throw new Error('unborn HEAD') })
      .mockImplementationOnce(() => { throw new Error('no identity') })
      .mockImplementationOnce(() => { throw new Error('disk full') })

    expect(() => ensureRepoHasInitialCommit('/tmp/repo')).toThrow('disk full')
  })
})
