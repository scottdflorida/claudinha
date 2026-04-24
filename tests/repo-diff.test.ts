/**
 * Tests for getDiff — the Kanban diff viewer's backing helper.
 *
 * Covers: happy path (returns text + baseBranch), truncation flag when diff
 * exceeds the byte cap, and graceful null-branch when the base can't be
 * detected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
import { getDiff } from '../src/main/git-status'

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void
const mockExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockExecFile.mockReset()
})

describe('getDiff', () => {
  it('returns the full diff + base branch when under the cap', async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      // detectMainBranch runs `git rev-parse --verify main` then master.
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        if (args[2] === 'main') callback(null, 'main-sha', '')
        else callback(new Error('no ref'), '', '')
      } else if (cmd === 'git' && args[0] === 'diff' && args[1] === '--no-color') {
        callback(null, 'diff --git a/x b/x\n+new line\n', '')
      } else {
        callback(new Error('unexpected'), '', '')
      }
      return {}
    }) as unknown as typeof execFile)

    const result = await getDiff('/worktree')
    expect(result.baseBranch).toBe('main')
    expect(result.diff).toContain('+new line')
    expect(result.truncated).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('truncates when the diff exceeds maxBytes', async () => {
    const big = 'x'.repeat(2_000_000)
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        if (args[2] === 'main') callback(null, 'main-sha', '')
        else callback(new Error('no ref'), '', '')
      } else if (cmd === 'git' && args[0] === 'diff') {
        callback(null, big, '')
      } else {
        callback(new Error('unexpected'), '', '')
      }
      return {}
    }) as unknown as typeof execFile)

    const result = await getDiff('/worktree', 1_000_000)
    expect(result.truncated).toBe(true)
    expect(result.diff.length).toBe(1_000_000)
    expect(result.baseBranch).toBe('main')
  })

  it('returns error + null baseBranch when no base can be detected', async () => {
    mockExecFile.mockImplementation(((
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      // Every rev-parse fails → detectMainBranch returns null.
      callback(new Error('no ref'), '', '')
      return {}
    }) as unknown as typeof execFile)

    const result = await getDiff('/worktree')
    expect(result.baseBranch).toBeNull()
    expect(result.error).toBeTruthy()
    expect(result.diff).toBe('')
    expect(result.truncated).toBe(false)
  })

  it('uses `git diff <base>` (working tree vs base), not `<base>..HEAD` — includes uncommitted', async () => {
    // Regression guard: the previous impl ran `git diff <base>..HEAD`, which
    // hid uncommitted edits. The card's +N/-M chip comes from Claude's JSONL
    // transcript and DOES reflect uncommitted work, so the two diverged and
    // the diff viewer showed "No differences" for panes with live edits.
    let capturedArgs: readonly string[] | null = null
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        if (args[2] === 'main') callback(null, 'main-sha', '')
        else callback(new Error('no ref'), '', '')
      } else if (cmd === 'git' && args[0] === 'diff') {
        capturedArgs = args
        callback(null, 'diff body', '')
      } else {
        callback(new Error('unexpected'), '', '')
      }
      return {}
    }) as unknown as typeof execFile)

    await getDiff('/worktree')
    expect(capturedArgs).toEqual(['diff', '--no-color', 'main'])
    // Explicitly NOT `main..HEAD` — that form would exclude uncommitted.
    expect((capturedArgs as unknown as string[]).some((a) => a.includes('..HEAD'))).toBe(false)
  })

  it('surfaces git diff failure without crashing', async () => {
    mockExecFile.mockImplementation(((
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback
    ) => {
      const callback = (cb ?? ((): void => {})) as ExecFileCallback
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        if (args[2] === 'main') callback(null, 'main-sha', '')
        else callback(new Error('no ref'), '', '')
      } else if (cmd === 'git' && args[0] === 'diff') {
        callback(new Error('fatal: bad revision'), '', '')
      } else {
        callback(new Error('unexpected'), '', '')
      }
      return {}
    }) as unknown as typeof execFile)

    const result = await getDiff('/worktree')
    expect(result.error).toMatch(/bad revision/i)
    expect(result.baseBranch).toBe('main')
    expect(result.diff).toBe('')
  })
})
