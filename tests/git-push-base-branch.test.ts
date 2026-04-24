/**
 * Tests for Phase 6 git helpers: getBaseBranchAhead, runGitWithLockRetry,
 * and gitPushBaseBranch.
 *
 * Focus is behavior under the conditions that matter most for the Kanban
 * repo rail:
 *   - Push button enable predicate (getBaseBranchAhead returns null when no
 *     upstream, an int when upstream exists).
 *   - Index.lock contention is retried (L-029), non-lock errors surface
 *     immediately.
 *   - gitPushBaseBranch flows through runGitWithLockRetry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process BEFORE importing git-status. util.promisify uses a
// custom symbol on execFile, so the mock function must carry the same
// symbol or the promisified call returns raw strings.
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
import {
  getBaseBranchAhead,
  gitPushBaseBranch,
  runGitWithLockRetry
} from '../src/main/git-status'

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void
const mockExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockExecFile.mockReset()
})

// ---------------------------------------------------------------------------
// getBaseBranchAhead
// ---------------------------------------------------------------------------

describe('getBaseBranchAhead', () => {
  it('returns the commits-ahead count when origin/<base> exists', async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        // refs/remotes/origin/main exists
        callback(null, '', '')
      } else if (cmd === 'git' && args[0] === 'rev-list') {
        callback(null, '3\n', '')
      } else {
        callback(new Error(`unexpected: ${args.join(' ')}`), '', '')
      }
      return {}
    }) as unknown as typeof execFile)

    expect(await getBaseBranchAhead('/repo', 'main')).toBe(3)
  })

  it('returns null when there is no upstream tracking ref (fresh repo)', async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        // origin/main missing
        callback(new Error('not a valid ref'), '', '')
      } else {
        callback(new Error('should not reach'), '', '')
      }
      return {}
    }) as unknown as typeof execFile)

    expect(await getBaseBranchAhead('/repo', 'main')).toBeNull()
  })

  it('returns null when rev-list fails for any other reason', async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse') callback(null, '', '')
      else if (cmd === 'git' && args[0] === 'rev-list') callback(new Error('broken'), '', '')
      else callback(new Error('unexpected'), '', '')
      return {}
    }) as unknown as typeof execFile)

    expect(await getBaseBranchAhead('/repo', 'main')).toBeNull()
  })

  it('parses 0 correctly (base caught up)', async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse') callback(null, '', '')
      else if (cmd === 'git' && args[0] === 'rev-list') callback(null, '0\n', '')
      else callback(new Error('unexpected'), '', '')
      return {}
    }) as unknown as typeof execFile)

    expect(await getBaseBranchAhead('/repo', 'main')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// runGitWithLockRetry — L-029 mitigation
// ---------------------------------------------------------------------------

describe('runGitWithLockRetry', () => {
  it('returns null on first-try success without retrying', async () => {
    let attempts = 0
    mockExecFile.mockImplementation(((
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      attempts++
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      callback(null, '', '')
      return {}
    }) as unknown as typeof execFile)

    const err = await runGitWithLockRetry(['push'], { cwd: '/r' })
    expect(err).toBeNull()
    expect(attempts).toBe(1)
  })

  it('retries on index.lock contention and eventually succeeds', async () => {
    let attempts = 0
    mockExecFile.mockImplementation(((
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      attempts++
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (attempts < 3) {
        callback(new Error('fatal: Unable to create .git/index.lock: File exists.'), '', '')
      } else {
        callback(null, '', '')
      }
      return {}
    }) as unknown as typeof execFile)

    const err = await runGitWithLockRetry(['commit', '-m', 'x'], { cwd: '/r' })
    expect(err).toBeNull()
    expect(attempts).toBe(3)
  })

  it('surfaces non-lock errors immediately (no retry)', async () => {
    let attempts = 0
    mockExecFile.mockImplementation(((
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      attempts++
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      callback(new Error('fatal: ! [rejected] main -> main (non-fast-forward)'), '', '')
      return {}
    }) as unknown as typeof execFile)

    const err = await runGitWithLockRetry(['push'], { cwd: '/r' })
    expect(err).toMatch(/rejected/i)
    expect(attempts).toBe(1)
  })

  it('gives up after exhausting retries and returns the last lock error', async () => {
    let attempts = 0
    mockExecFile.mockImplementation(((
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      attempts++
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      callback(new Error("Unable to create '.git/index.lock'"), '', '')
      return {}
    }) as unknown as typeof execFile)

    const err = await runGitWithLockRetry(['push'], { cwd: '/r' })
    expect(err).toMatch(/index\.lock|Unable to create/i)
    // Retries: initial + 3 backoff attempts = 4 total
    expect(attempts).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// gitPushBaseBranch — thin wrapper; just verifies it delegates correctly.
// ---------------------------------------------------------------------------

describe('gitPushBaseBranch', () => {
  it('runs `git push -u origin <base>` in the repo root', async () => {
    let capturedCmd: string | null = null
    let capturedArgs: readonly string[] | null = null
    let capturedCwd: string | null = null
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      opts: { cwd?: string } | undefined,
      cb?: ExecFileCallback
    ) => {
      capturedCmd = cmd
      capturedArgs = args
      capturedCwd = opts?.cwd ?? null
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      callback(null, '', '')
      return {}
    }) as unknown as typeof execFile)

    const err = await gitPushBaseBranch('/Users/me/repo', 'main')
    expect(err).toBeNull()
    expect(capturedCmd).toBe('git')
    expect(capturedArgs).toEqual(['push', '-u', 'origin', 'main'])
    expect(capturedCwd).toBe('/Users/me/repo')
  })

  it('surfaces auth failure without retrying', async () => {
    let attempts = 0
    mockExecFile.mockImplementation(((
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      attempts++
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      callback(new Error('fatal: Authentication failed for https://github.com/...'), '', '')
      return {}
    }) as unknown as typeof execFile)

    const err = await gitPushBaseBranch('/r', 'main')
    expect(err).toMatch(/Authentication failed/i)
    expect(attempts).toBe(1)
  })
})
