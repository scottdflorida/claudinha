/**
 * Integration tests for main-mode panes (M2.5).
 *
 * Pins the design decision that v2 supports working directly on `main`,
 * not just on worktree branches. The projection generalizes to use
 * `origin/<branch>..HEAD` when `currentBranch === baseBranch`, and the
 * publish path refuses to push when `origin/<branch>` has diverged.
 *
 * Pieces under test:
 *   1. `projectTurnsForPane` returns commits ahead of origin (not nothing)
 *      when the pane is on the base branch.
 *   2. `squashAndPublish` with `path: 'push-branch'` refuses when
 *      `origin/<branch>` has commits the local branch doesn't.
 *   3. `squashAndPublish` with `path: 'push-branch'` succeeds in main
 *      mode when origin is up-to-date — and uses plain `push`, not
 *      `--force-with-lease`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'

import { projectTurnsForPane } from '../src/main/turn-projection'
import { squashAndPublish } from '../src/main/publish-engine'
import { formatTurnCommitMessage } from '../src/main/turn-recorder'
import type { PaneState, TurnPendingAction } from '../src/shared/types'

// ----------------------------------------------------------------------------
// Stubs
// ----------------------------------------------------------------------------

function makeStubPane(worktreePath: string): PaneState {
  return {
    id: 'pane-1', windowId: 'win-1', workspaceId: 'ws-1', ptyId: 'pty-1',
    sessionId: null, transcriptPath: null, contextWindowSize: null,
    repoName: 'main-mode-repo', worktreeName: 'main', worktreePath,
    status: 'awaiting-prompt', activeToolName: null,
    statusChangedAt: Date.now(), statusSource: 'hook',
    isFocused: false, hasUnseenStatusChange: false, isApiBilling: false,
    effort: 'high', model: 'opus',
    metrics: {
      totalTokens: null, contextPercent: null, toolsUsed: null,
      totalCostUsd: null, durationMs: null, modelDisplayName: null,
      linesAdded: null, linesRemoved: null, sessionTitle: null,
      agentName: null, initialPrompt: null
    },
    createdAt: Date.now(), gitStatus: null, isWorktree: false,
    completionActionStatus: null, autoCommitEnabled: true
  }
}

function makeStubs(pane: PaneState): {
  sessionRegistry: Parameters<typeof squashAndPublish>[0]['sessionRegistry']
  windowManager: Parameters<typeof squashAndPublish>[0]['windowManager']
} {
  const sessionRegistry = {
    getPane: (id: string) => (id === pane.id ? pane : undefined)
  } as unknown as Parameters<typeof squashAndPublish>[0]['sessionRegistry']
  const windowManager = {
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: () => {} }
    })
  } as unknown as Parameters<typeof squashAndPublish>[0]['windowManager']
  void sessionRegistry; void windowManager
  return { sessionRegistry, windowManager }
}

// ----------------------------------------------------------------------------
// Fixture: a "remote" repo (bare) and a "local" clone where the pane lives.
// ----------------------------------------------------------------------------

let remoteRoot: string
let localRoot: string

beforeEach(() => {
  // Bare "origin" so push works.
  remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'main-mode-remote-'))
  execFileSync('git', ['init', '--bare', '--initial-branch=main', '-q'], { cwd: remoteRoot })

  // Local clone with an initial commit on main and an upstream tracking ref.
  localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'main-mode-local-'))
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: localRoot })
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: localRoot })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: localRoot })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: localRoot })
  execFileSync('git', ['remote', 'add', 'origin', remoteRoot], { cwd: localRoot })
  fs.writeFileSync(path.join(localRoot, 'README.md'), 'init\n')
  execFileSync('git', ['add', '.'], { cwd: localRoot })
  execFileSync('git', ['commit', '-m', 'init', '-q'], { cwd: localRoot })
  execFileSync('git', ['push', '-u', 'origin', 'main', '-q'], { cwd: localRoot })
})

afterEach(() => {
  for (const dir of [remoteRoot, localRoot]) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function commitTurn(repoRoot: string, index: number, summary: string, fileEdit: () => void): {
  sha: string
  turnId: string
} {
  fileEdit()
  execFileSync('git', ['add', '-A'], { cwd: repoRoot })
  const turnId = `turn-uuid-${index}`
  execFileSync('git', ['commit', '-m', formatTurnCommitMessage(index, summary, turnId), '-q'], { cwd: repoRoot })
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
  return { sha, turnId }
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('projectTurnsForPane — main mode (currentBranch === baseBranch)', () => {
  it('returns commits ahead of origin/<base> as turns', async () => {
    commitTurn(localRoot, 1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(localRoot, 'a.txt'), 'A\n')
    })
    commitTurn(localRoot, 2, 'Add b.txt', () => {
      fs.writeFileSync(path.join(localRoot, 'b.txt'), 'B\n')
    })

    const turns = await projectTurnsForPane(localRoot, 'pane-1', 'main', 'main')
    expect(turns.length).toBe(2)
    expect(turns[0]!.summary).toBe('Add a.txt')
    expect(turns[1]!.summary).toBe('Add b.txt')
    // Main-mode turns are always `open` — no `pushed` state because pushed
    // commits leave the range automatically.
    expect(turns.every((t) => t.state === 'open')).toBe(true)
  })

  it('returns empty when the local branch has no commits ahead of origin', async () => {
    const turns = await projectTurnsForPane(localRoot, 'pane-1', 'main', 'main')
    expect(turns).toEqual([])
  })

  it('drops a turn from the projection once it is pushed to origin', async () => {
    commitTurn(localRoot, 1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(localRoot, 'a.txt'), 'A\n')
    })
    const beforePush = await projectTurnsForPane(localRoot, 'pane-1', 'main', 'main')
    expect(beforePush.length).toBe(1)
    // Push and re-check.
    execFileSync('git', ['push', 'origin', 'main', '-q'], { cwd: localRoot })
    const afterPush = await projectTurnsForPane(localRoot, 'pane-1', 'main', 'main')
    expect(afterPush).toEqual([])
  })
})

describe('squashAndPublish — main mode', () => {
  it('refuses to push when origin/main has diverged (per design decision)', async () => {
    // Local commit.
    const local = commitTurn(localRoot, 1, 'Local turn', () => {
      fs.writeFileSync(path.join(localRoot, 'a.txt'), 'A\n')
    })

    // Simulate a teammate's push by working in a sibling clone of the
    // bare remote, committing, and pushing. Direct manipulation of the
    // bare repo via `git push` from a separate worktree avoids hand-
    // crafting object writes.
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), 'main-mode-sibling-'))
    try {
      execFileSync('git', ['clone', '-q', remoteRoot, sibling])
      execFileSync('git', ['config', 'user.email', 'sib@t.com'], { cwd: sibling })
      execFileSync('git', ['config', 'user.name', 'sib'], { cwd: sibling })
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: sibling })
      fs.writeFileSync(path.join(sibling, 'teammate.txt'), 'their work\n')
      execFileSync('git', ['add', '.'], { cwd: sibling })
      execFileSync('git', ['commit', '-m', 'teammate change', '-q'], { cwd: sibling })
      execFileSync('git', ['push', 'origin', 'main', '-q'], { cwd: sibling })
    } finally {
      try { fs.rmSync(sibling, { recursive: true, force: true }) } catch { /* ignore */ }
    }

    const pane = makeStubPane(localRoot)
    const stubs = makeStubs(pane)

    const result = await squashAndPublish({
      worktreePath: localRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnIds: [local.turnId],
      message: 'try to publish',
      path: 'push-branch'
    })

    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('push-rejected')
    expect(result.error).toMatch(/origin\/main has commits/)
    // Local branch is unchanged — no publish attempt left behind.
    expect(
      execFileSync('git', ['log', '-1', '--format=%s'], { cwd: localRoot }).toString().trim()
    ).toBe('wip(turn-1): Local turn')
  })

  // Regression: user reported selecting only the latest of three turns
  // and clicking publish → direct-merge. The engine pushed the worktree
  // branch (which carried T1 + T2 as ancestors of the squash commit),
  // and main fast-forwarded to include all three. The gate that
  // protected `push-branch` against this never fired for `direct-merge`
  // / `pr` paths even though they all push the worktree branch under
  // the hood. The fix makes the gate path-agnostic. We exercise it via
  // the cheaper push-branch path (same gate, no side-clone needed).
  it('refuses publish when selection skips earlier unpublished turns (any path)', async () => {
    const t1 = commitTurn(localRoot, 1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(localRoot, 'a.txt'), 'A\n')
    })
    const _t2 = commitTurn(localRoot, 2, 'Add b.txt', () => {
      fs.writeFileSync(path.join(localRoot, 'b.txt'), 'B\n')
    })
    const t3 = commitTurn(localRoot, 3, 'Add c.txt', () => {
      fs.writeFileSync(path.join(localRoot, 'c.txt'), 'C\n')
    })
    void _t2
    void t1

    const pane = makeStubPane(localRoot)
    const stubs = makeStubs(pane)

    const result = await squashAndPublish({
      worktreePath: localRoot,
      repoPath: localRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      sideCloneManager: null,
      turnIds: [t3.turnId],
      message: 'just T3',
      path: 'push-branch'
    })

    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('non-contiguous')
    expect(result.error).toMatch(/skips earlier unpublished/i)
    // Local branch is unchanged.
    const headSubject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: localRoot }).toString().trim()
    expect(headSubject).toBe('wip(turn-3): Add c.txt')
  })

  it('succeeds when origin/main is up-to-date', async () => {
    const t1 = commitTurn(localRoot, 1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(localRoot, 'a.txt'), 'A\n')
    })
    const t2 = commitTurn(localRoot, 2, 'Add b.txt', () => {
      fs.writeFileSync(path.join(localRoot, 'b.txt'), 'B\n')
    })

    const pane = makeStubPane(localRoot)
    const stubs = makeStubs(pane)

    const result = await squashAndPublish({
      worktreePath: localRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnIds: [t1.turnId, t2.turnId],
      message: 'feat: add files',
      path: 'push-branch'
    })

    expect(result.ok).toBe(true)
    // Local main is now one commit (the squash).
    const subjects = execFileSync(
      'git',
      ['log', 'origin/main..HEAD', '--reverse', '--pretty=format:%s'],
      { cwd: localRoot }
    ).toString().trim().split('\n').filter(Boolean)
    expect(subjects).toEqual([])
    // The squash commit's subject made it into the most recent commit on main.
    const headSubject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: localRoot }).toString().trim()
    expect(headSubject).toBe('feat: add files')
    // Origin received the same head sha.
    const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localRoot }).toString().trim()
    const originHead = execFileSync('git', ['rev-parse', 'main'], { cwd: remoteRoot }).toString().trim()
    expect(originHead).toBe(localHead)
  })
})
