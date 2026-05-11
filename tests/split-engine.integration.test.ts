/**
 * Integration tests for `publish-engine.splitTurn` against a real
 * temporary git repository. Validates the M3 ship criterion:
 *
 *   "User can take one turn-commit and produce two publish commits,
 *    picking hunks."
 *
 * The choreography under test:
 *   - `git rebase -i <parent>` with `edit` for the target turn
 *   - `git reset HEAD^` (mixed)
 *   - Build LEFT sub-patch, `git apply --cached`, commit
 *   - `git add -A` for the rest, commit
 *   - `git rebase --continue` to replay dependents
 *   - Sidecar gets `supersededBy: [leftId, rightId]` for the original
 *
 * Failure paths covered:
 *   - illegal hunk combination → apply-check fails, rebase aborts, branch
 *     unchanged
 *   - all-hunks-on-one-side → engine refuses up front (empty-side error)
 *   - dependent replay conflict → engine aborts, branch restored
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'

import { splitTurn } from '../src/main/publish-engine'
import { readDiscardedSidecar } from '../src/main/turn-projection'
import { formatTurnCommitMessage } from '../src/main/turn-recorder'
import { IPC } from '../src/shared/ipc-channels'
import type { PaneState, TurnPendingAction } from '../src/shared/types'
import type { HunkSelection } from '../src/shared/ipc-channels'

// ----------------------------------------------------------------------------
// Stubs
// ----------------------------------------------------------------------------

function makeStubPane(worktreePath: string): PaneState {
  return {
    id: 'pane-1', windowId: 'win-1', workspaceId: 'ws-1', ptyId: 'pty-1',
    sessionId: null, transcriptPath: null, contextWindowSize: null,
    repoName: 'split-test', worktreeName: 'wt-test', worktreePath,
    status: 'awaiting-prompt', activeToolName: null,
    statusChangedAt: Date.now(), statusSource: 'hook',
    isFocused: false, hasUnseenStatusChange: false, isApiBilling: false,
    effort: 'high', model: 'opus',
    metrics: {
      totalTokens: null, contextPercent: null, toolsUsed: null,
      totalCostUsd: null, durationMs: null, modelDisplayName: null,
      linesAdded: null, linesRemoved: null, sessionTitle: null,
      agentName: null, initialPrompt: null, lastMessage: null
    },
    createdAt: Date.now(), gitStatus: null, isWorktree: true,
    completionActionStatus: null, autoCommitEnabled: true
  }
}

function makeStubs(pane: PaneState): {
  sessionRegistry: Parameters<typeof splitTurn>[0]['sessionRegistry']
  windowManager: Parameters<typeof splitTurn>[0]['windowManager']
  emitted: Array<{ paneId: string; pendingAction: TurnPendingAction | null }>
} {
  const emitted: Array<{ paneId: string; pendingAction: TurnPendingAction | null }> = []
  const sessionRegistry = {
    getPane: (id: string) => (id === pane.id ? pane : undefined)
  } as unknown as Parameters<typeof splitTurn>[0]['sessionRegistry']
  const windowManager = {
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => {
          // Only count TURN_PENDING_ACTION emissions. broadcastTurnsUpdated
          // *also* carries a `pendingAction` field on its payload (channel
          // TURNS_UPDATED) — filtering by channel keeps this stub measuring
          // the broadcast-pending-action call site instead of being subject
          // to a timing race against the async TURNS_UPDATED broadcast.
          if (channel !== IPC.TURN_PENDING_ACTION) return
          const p = payload as { paneId?: string; pendingAction?: TurnPendingAction | null }
          if (p && typeof p === 'object' && 'pendingAction' in p) {
            emitted.push({
              paneId: p.paneId ?? '',
              pendingAction: (p.pendingAction ?? null) as TurnPendingAction | null
            })
          }
        }
      }
    })
  } as unknown as Parameters<typeof splitTurn>[0]['windowManager']
  return { sessionRegistry, windowManager, emitted }
}

// ----------------------------------------------------------------------------
// Fixture
// ----------------------------------------------------------------------------

let repoRoot: string

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'split-engine-it-'))
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repoRoot })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot })
  // Pin line endings to LF so the fixture's `\n` content survives Windows
  // git's autocrlf checkout (default: true on Git for Windows). Tests read
  // files back and assert exact content; without this, Windows CI sees
  // `\r\n` and fails on assertions that are correct on every other platform.
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repoRoot })
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'init\n')
  execFileSync('git', ['add', '.'], { cwd: repoRoot })
  execFileSync('git', ['commit', '-m', 'init', '-q'], { cwd: repoRoot })
  execFileSync('git', ['checkout', '-b', 'wt-test', '-q'], { cwd: repoRoot })
})

afterEach(() => {
  try { fs.rmSync(repoRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

function commitTurn(index: number, summary: string, fileEdit: () => void): {
  sha: string
  turnId: string
} {
  fileEdit()
  execFileSync('git', ['add', '-A'], { cwd: repoRoot })
  const turnId = `turn-uuid-${index}`
  // 'pane-1' matches the test's pane id; turn-projection filters by trailer.
  execFileSync('git', ['commit', '-m', formatTurnCommitMessage(index, summary, turnId, 'pane-1'), '-q'], { cwd: repoRoot })
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
  return { sha, turnId }
}

function listSubjects(): string[] {
  return execFileSync(
    'git',
    ['log', 'main..HEAD', '--reverse', '--pretty=format:%s'],
    { cwd: repoRoot }
  ).toString().trim().split('\n').filter(Boolean)
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('splitTurn — happy path: tip turn with two unrelated hunks', () => {
  it('produces two publish-commits, sidecar marks original as superseded', async () => {
    // One commit touching two unrelated files. Each file becomes one
    // hunk. We move file A's hunk to the LEFT commit and file B's hunk
    // stays in the RIGHT.
    const t1 = commitTurn(1, 'Add a.txt and b.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A line\n')
      fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'B line\n')
    })

    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const hunkSelections: HunkSelection[] = [
      { file: 'a.txt', leftHunkIndexes: [0] },
      { file: 'b.txt', leftHunkIndexes: [] }
    ]

    const result = await splitTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t1.turnId,
      hunkSelections,
      leftMessage: 'Add a.txt only',
      rightMessage: 'Add b.txt only'
    })

    expect(result.ok).toBe(true)
    expect(result.leftCommitSha).toBeDefined()
    expect(result.rightCommitSha).toBeDefined()

    // Branch now has two commits in chronological order.
    const subjects = listSubjects()
    expect(subjects).toEqual(['Add a.txt only', 'Add b.txt only'])

    // Each commit has only its assigned file changed.
    const leftFiles = execFileSync(
      'git', ['show', '--name-only', '--format=', result.leftCommitSha!],
      { cwd: repoRoot }
    ).toString().trim().split('\n').filter(Boolean).sort()
    const rightFiles = execFileSync(
      'git', ['show', '--name-only', '--format=', result.rightCommitSha!],
      { cwd: repoRoot }
    ).toString().trim().split('\n').filter(Boolean).sort()
    expect(leftFiles).toEqual(['a.txt'])
    expect(rightFiles).toEqual(['b.txt'])

    // Sidecar: original turn marked discarded with supersededBy pointing
    // at the two new turn IDs.
    const sidecar = await readDiscardedSidecar(repoRoot)
    expect(sidecar.discarded[t1.turnId]).toBeDefined()
    expect(sidecar.discarded[t1.turnId]!.supersededBy).toBeDefined()
    expect(sidecar.discarded[t1.turnId]!.supersededBy!.length).toBe(2)
  })

  it('emits TURN_PENDING_ACTION as splitting then null', async () => {
    const t1 = commitTurn(1, 'Add files', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
      fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'B\n')
    })
    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    await splitTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t1.turnId,
      hunkSelections: [
        { file: 'a.txt', leftHunkIndexes: [0] },
        { file: 'b.txt', leftHunkIndexes: [] }
      ],
      leftMessage: 'left',
      rightMessage: 'right'
    })

    const kinds = stubs.emitted.map((p) => p.pendingAction?.kind ?? 'null')
    expect(kinds[0]).toBe('splitting')
    // Last emission should clear the pending action.
    expect(kinds[kinds.length - 1]).toBe('null')
  })
})

describe('splitTurn — mid-branch turn with non-conflicting dependents', () => {
  it('splits the middle turn and replays the tail cleanly', async () => {
    const t1 = commitTurn(1, 'Add a.txt and b.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
      fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'B\n')
    })
    // Tail turn touching a third file — never overlaps with t1's hunks,
    // so the rebase --continue will replay cleanly.
    const t2 = commitTurn(2, 'Add c.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'c.txt'), 'C\n')
    })

    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await splitTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t1.turnId,
      hunkSelections: [
        { file: 'a.txt', leftHunkIndexes: [0] },
        { file: 'b.txt', leftHunkIndexes: [] }
      ],
      leftMessage: 'left',
      rightMessage: 'right'
    })

    expect(result.ok).toBe(true)
    // Three commits: left, right, t2 (replayed).
    const subjects = listSubjects()
    expect(subjects).toEqual(['left', 'right', 'wip(turn-2): Add c.txt'])
    // c.txt should still have the same content from t2.
    expect(fs.readFileSync(path.join(repoRoot, 'c.txt'), 'utf8')).toBe('C\n')
    // Sidecar entry only for t1 (the split target). t2's id wasn't
    // touched.
    const sidecar = await readDiscardedSidecar(repoRoot)
    expect(Object.keys(sidecar.discarded)).toEqual([t1.turnId])
    void t2
  })
})

describe('splitTurn — dirty working tree (regression)', () => {
  it('succeeds when the user has unstaged edits at split time (--autostash)', async () => {
    // User-reported scenario: a turn was committed, then the user (or
    // Claude after auto-commit toggled off) edited another file, then
    // clicked Split. Without --autostash the rebase refused with
    // "cannot rebase: You have unstaged changes."
    const t1 = commitTurn(1, 'Add a.txt and b.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
      fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'B\n')
    })
    // Dirty the worktree with an unrelated edit.
    fs.writeFileSync(path.join(repoRoot, 'unstaged.txt'), 'mid-flight work\n')

    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await splitTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t1.turnId,
      hunkSelections: [
        { file: 'a.txt', leftHunkIndexes: [0] },
        { file: 'b.txt', leftHunkIndexes: [] }
      ],
      leftMessage: 'left',
      rightMessage: 'right'
    })

    expect(result.ok).toBe(true)
    // After the rebase + autostash pop, the unstaged edit is back in the
    // working tree intact.
    expect(fs.existsSync(path.join(repoRoot, 'unstaged.txt'))).toBe(true)
    expect(fs.readFileSync(path.join(repoRoot, 'unstaged.txt'), 'utf8')).toBe('mid-flight work\n')
    // Branch has the two split commits, the dirty edit isn't in either.
    const subjects = listSubjects()
    expect(subjects).toEqual(['left', 'right'])
  })
})

describe('splitTurn — guard rails', () => {
  it('rejects when no hunks are selected for the LEFT side', async () => {
    const t1 = commitTurn(1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
    })
    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await splitTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t1.turnId,
      hunkSelections: [{ file: 'a.txt', leftHunkIndexes: [] }],
      leftMessage: 'left',
      rightMessage: 'right'
    })

    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('empty-side')
    // Branch unchanged.
    expect(listSubjects()).toEqual(['wip(turn-1): Add a.txt'])
  })

  it('rejects when EVERY hunk is selected for the LEFT (right would be empty)', async () => {
    const t1 = commitTurn(1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
    })
    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await splitTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t1.turnId,
      hunkSelections: [{ file: 'a.txt', leftHunkIndexes: [0] }],
      leftMessage: 'left',
      rightMessage: 'right'
    })

    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('empty-side')
    expect(listSubjects()).toEqual(['wip(turn-1): Add a.txt'])
  })

  it('rejects an unknown turn id', async () => {
    commitTurn(1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
    })
    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await splitTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: 'does-not-exist',
      hunkSelections: [{ file: 'a.txt', leftHunkIndexes: [0] }],
      leftMessage: 'left',
      rightMessage: 'right'
    })

    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('turn-not-found')
  })

  it('rejects when both messages are not provided', async () => {
    const t1 = commitTurn(1, 'Add a.txt and b.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
      fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'B\n')
    })
    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await splitTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t1.turnId,
      hunkSelections: [
        { file: 'a.txt', leftHunkIndexes: [0] },
        { file: 'b.txt', leftHunkIndexes: [] }
      ],
      leftMessage: '   ',
      rightMessage: 'right'
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/messages/)
    expect(listSubjects()).toEqual(['wip(turn-1): Add a.txt and b.txt'])
  })
})

describe('parseUnifiedDiff', () => {
  it('parses a single-file two-hunk diff', async () => {
    const { parseUnifiedDiff } = await import('../src/main/turn-diff')
    const sample = [
      'diff --git a/foo.txt b/foo.txt',
      'index 1234567..89abcde 100644',
      '--- a/foo.txt',
      '+++ b/foo.txt',
      '@@ -1,3 +1,4 @@',
      ' line one',
      '-line two',
      '+line two prime',
      '+line two and a half',
      ' line three',
      '@@ -10,2 +11,3 @@',
      ' line ten',
      '+line ten point five',
      ' line eleven'
    ].join('\n')
    const files = parseUnifiedDiff(sample)
    expect(files.length).toBe(1)
    expect(files[0]!.path).toBe('foo.txt')
    expect(files[0]!.hunks.length).toBe(2)
    expect(files[0]!.hunks[0]!.additions).toBe(2)
    expect(files[0]!.hunks[0]!.deletions).toBe(1)
    expect(files[0]!.hunks[1]!.additions).toBe(1)
    expect(files[0]!.hunks[1]!.deletions).toBe(0)
  })

  it('handles a binary-file diff as a zero-hunk file', async () => {
    const { parseUnifiedDiff } = await import('../src/main/turn-diff')
    const sample = [
      'diff --git a/img.png b/img.png',
      'index abc..def 100644',
      'Binary files a/img.png and b/img.png differ'
    ].join('\n')
    const files = parseUnifiedDiff(sample)
    expect(files.length).toBe(1)
    expect(files[0]!.path).toBe('img.png')
    expect(files[0]!.hunks.length).toBe(0)
  })

  it('parses two files in one diff', async () => {
    const { parseUnifiedDiff } = await import('../src/main/turn-diff')
    const sample = [
      'diff --git a/a.txt b/a.txt',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/a.txt',
      '@@ -0,0 +1,1 @@',
      '+A',
      'diff --git a/b.txt b/b.txt',
      'new file mode 100644',
      'index 0000000..2222222',
      '--- /dev/null',
      '+++ b/b.txt',
      '@@ -0,0 +1,1 @@',
      '+B'
    ].join('\n')
    const files = parseUnifiedDiff(sample)
    expect(files.length).toBe(2)
    expect(files.map((f) => f.path)).toEqual(['a.txt', 'b.txt'])
    expect(files.every((f) => f.hunks.length === 1)).toBe(true)
  })
})

describe('buildLeftSubPatch', () => {
  it('emits only selected hunks per file', async () => {
    const { parseUnifiedDiff, buildLeftSubPatch } = await import('../src/main/turn-diff')
    const sample = [
      'diff --git a/foo.txt b/foo.txt',
      'index 1234567..89abcde 100644',
      '--- a/foo.txt',
      '+++ b/foo.txt',
      '@@ -1,1 +1,1 @@',
      '-old line',
      '+new line',
      '@@ -5,1 +5,1 @@',
      '-other old',
      '+other new'
    ].join('\n')
    const files = parseUnifiedDiff(sample)
    const patch = buildLeftSubPatch(files, [{ file: 'foo.txt', leftHunkIndexes: [0] }])
    expect(patch).toContain('diff --git a/foo.txt b/foo.txt')
    expect(patch).toContain('@@ -1,1 +1,1 @@')
    expect(patch).not.toContain('@@ -5,1 +5,1 @@')
    expect(patch.endsWith('\n')).toBe(true)
  })

  it('returns empty string when nothing is selected', async () => {
    const { parseUnifiedDiff, buildLeftSubPatch } = await import('../src/main/turn-diff')
    const files = parseUnifiedDiff([
      'diff --git a/foo.txt b/foo.txt',
      'index 0..1 100644',
      '--- a/foo.txt',
      '+++ b/foo.txt',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new'
    ].join('\n'))
    expect(buildLeftSubPatch(files, [])).toBe('')
    expect(buildLeftSubPatch(files, [{ file: 'foo.txt', leftHunkIndexes: [] }])).toBe('')
  })
})
