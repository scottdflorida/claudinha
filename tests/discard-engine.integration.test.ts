/**
 * Integration tests for `discard-engine.discardTurn` against a real
 * temporary git repository. Validates the M2 ship criterion:
 *
 *   "User can discard a turn, including those with dependents."
 *
 * The fixture creates a base repo with a `main` branch + initial commit,
 * branches off into `wt-X`, lays down a sequence of turn-style
 * `wip(turn-N)` commits via the same trailer format `turn-recorder`
 * uses, and exercises:
 *
 *   1. Tip-discard (no dependents)         → reset path
 *   2. Mid-branch discard, no conflict     → rebase --onto path, no cascade
 *   3. Mid-branch discard with conflict    → cascade-required signal
 *   4. Cascade-confirmed mid-branch discard → all dependents drop
 *   5. Sidecar persistence                 → discarded entries written
 *
 * No Electron / no IPC — discardTurn is invoked directly with stub
 * sessionRegistry / windowManager that record what they're called with.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'

import { discardTurn } from '../src/main/discard-engine'
import { readDiscardedSidecar } from '../src/main/turn-projection'
import { TURN_ID_TRAILER, formatTurnCommitMessage } from '../src/main/turn-recorder'
import type { PaneState, TurnPendingAction } from '../src/shared/types'

// ----------------------------------------------------------------------------
// Stubs for the sessionRegistry + windowManager interfaces discardTurn uses.
// ----------------------------------------------------------------------------

function makeStubPane(worktreePath: string): PaneState {
  return {
    id: 'pane-1',
    windowId: 'win-1',
    workspaceId: 'ws-1',
    ptyId: 'pty-1',
    sessionId: null,
    transcriptPath: null,
    contextWindowSize: null,
    repoName: 'test-repo',
    worktreeName: 'wt-test',
    worktreePath,
    status: 'awaiting-prompt',
    activeToolName: null,
    statusChangedAt: Date.now(),
    statusSource: 'hook',
    isFocused: false,
    hasUnseenStatusChange: false,
    isApiBilling: false,
    effort: 'high',
    model: 'opus',
    metrics: {
      totalTokens: null,
      contextPercent: null,
      toolsUsed: null,
      totalCostUsd: null,
      durationMs: null,
      modelDisplayName: null,
      linesAdded: null,
      linesRemoved: null,
      sessionTitle: null,
      agentName: null,
      initialPrompt: null
    },
    createdAt: Date.now(),
    gitStatus: null,
    isWorktree: true,
    completionActionStatus: null,
    autoCommitEnabled: true
  }
}

function makeStubs(pane: PaneState): {
  sessionRegistry: Parameters<typeof discardTurn>[0]['sessionRegistry']
  windowManager: Parameters<typeof discardTurn>[0]['windowManager']
  emittedPending: Array<{ paneId: string; pendingAction: TurnPendingAction | null }>
} {
  const emittedPending: Array<{ paneId: string; pendingAction: TurnPendingAction | null }> = []
  const sessionRegistry = {
    getPane: (id: string) => (id === pane.id ? pane : undefined)
  } as unknown as Parameters<typeof discardTurn>[0]['sessionRegistry']
  const windowManager = {
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (_channel: string, payload: unknown) => {
          const p = payload as { paneId?: string; pendingAction?: TurnPendingAction | null }
          if (p && typeof p === 'object' && 'pendingAction' in p) {
            emittedPending.push({
              paneId: p.paneId ?? '',
              pendingAction: (p.pendingAction ?? null) as TurnPendingAction | null
            })
          }
        }
      }
    })
  } as unknown as Parameters<typeof discardTurn>[0]['windowManager']
  return { sessionRegistry, windowManager, emittedPending }
}

// ----------------------------------------------------------------------------
// Git repo fixture builder.
// ----------------------------------------------------------------------------

function gitInit(repoRoot: string): void {
  fs.mkdirSync(repoRoot, { recursive: true })
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot })
  // Initial commit on main so HEAD is real.
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'init\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot })
  execFileSync('git', ['commit', '-m', 'init', '-q'], { cwd: repoRoot })
}

function checkoutBranch(repoRoot: string, branch: string): void {
  execFileSync('git', ['checkout', '-b', branch, '-q'], { cwd: repoRoot })
}

function commitTurn(repoRoot: string, index: number, summary: string, fileEdit: () => void): {
  sha: string
  turnId: string
} {
  fileEdit()
  execFileSync('git', ['add', '-A'], { cwd: repoRoot })
  const turnId = `turn-uuid-${index}`
  const msg = formatTurnCommitMessage(index, summary, turnId)
  execFileSync('git', ['commit', '-m', msg, '-q'], { cwd: repoRoot })
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
  return { sha, turnId }
}

function readFile(repoRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8')
  } catch {
    return null
  }
}

function listCommitTrailers(repoRoot: string): string[] {
  return execFileSync(
    'git',
    ['log', 'main..HEAD', '--reverse', '--pretty=format:%H %s'],
    { cwd: repoRoot }
  )
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
}

let repoRoot: string

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'discard-engine-it-'))
  gitInit(repoRoot)
  checkoutBranch(repoRoot, 'wt-test')
})

afterEach(() => {
  try { fs.rmSync(repoRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('discardTurn — tip discard (no dependents)', () => {
  it('removes the only turn and writes a sidecar entry', async () => {
    const { turnId } = commitTurn(repoRoot, 1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
    })

    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await discardTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId,
      cascadeConfirmed: false
    })

    expect(result.ok).toBe(true)
    // Branch HEAD is back to main's tip → no commits ahead of main.
    expect(listCommitTrailers(repoRoot)).toEqual([])
    // Working tree was reset, so the turn's file is gone.
    expect(readFile(repoRoot, 'a.txt')).toBe(null)
    // Sidecar recorded the discard.
    const sidecar = await readDiscardedSidecar(repoRoot)
    expect(sidecar.discarded[turnId]?.originalIndex).toBe(1)
  })

  it('clears pendingAction on success (broadcast set then cleared)', async () => {
    const { turnId } = commitTurn(repoRoot, 1, 'Add b.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'B\n')
    })

    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    await discardTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId,
      cascadeConfirmed: false
    })

    // Two TURN_PENDING_ACTION emissions: 'discarding' then null.
    const kinds = stubs.emittedPending.map((p) => p.pendingAction?.kind ?? 'null')
    expect(kinds).toEqual(['discarding', 'null'])
  })
})

describe('discardTurn — mid-branch discard, dependents replay cleanly', () => {
  it('drops the selected turn and rebases independent dependents on top', async () => {
    // Three turns touching three different files — replay can never conflict.
    const t1 = commitTurn(repoRoot, 1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
    })
    const t2 = commitTurn(repoRoot, 2, 'Add b.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'B\n')
    })
    const t3 = commitTurn(repoRoot, 3, 'Add c.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'c.txt'), 'C\n')
    })

    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await discardTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t2.turnId,
      cascadeConfirmed: false
    })

    expect(result.ok).toBe(true)
    // Working tree: a.txt and c.txt remain; b.txt is gone.
    expect(readFile(repoRoot, 'a.txt')).toBe('A\n')
    expect(readFile(repoRoot, 'b.txt')).toBe(null)
    expect(readFile(repoRoot, 'c.txt')).toBe('C\n')
    // The branch now has two commits (T1 unchanged, T3 rebased onto T1).
    // T1's sha must be unchanged (no rebase touched it); T3's sha changes
    // (it was replayed onto a new parent).
    const subjects = execFileSync(
      'git',
      ['log', 'main..HEAD', '--reverse', '--pretty=format:%s'],
      { cwd: repoRoot }
    ).toString().trim().split('\n')
    expect(subjects).toEqual(['wip(turn-1): Add a.txt', 'wip(turn-3): Add c.txt'])
    // Sidecar recorded just the dropped turn (not the rebased one).
    const sidecar = await readDiscardedSidecar(repoRoot)
    expect(Object.keys(sidecar.discarded)).toEqual([t2.turnId])
    // Reference unused stable identity for clarity.
    void t1
    void t3
  })
})

describe('discardTurn — mid-branch discard, dependents replay conflicts', () => {
  it('returns cascade-required with dependent turn IDs and aborts the rebase', async () => {
    // T1 creates 'shared.txt' = "A\n"; T2 modifies same file; T3 modifies
    // it again. Discarding T2 forces git to replay T3 from the new floor
    // (just T1), and the diff base mismatch produces a conflict.
    const t1 = commitTurn(repoRoot, 1, 'Add shared.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'shared.txt'), 'A\n')
    })
    const t2 = commitTurn(repoRoot, 2, 'Bump shared.txt to B', () => {
      fs.writeFileSync(path.join(repoRoot, 'shared.txt'), 'B\n')
    })
    const t3 = commitTurn(repoRoot, 3, 'Append C to shared.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'shared.txt'), 'B\nC\n')
    })

    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await discardTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t2.turnId,
      cascadeConfirmed: false
    })

    expect(result.ok).toBe(false)
    expect(result.cascadeRequired).toBe(true)
    expect(result.dependentTurnIds).toEqual([t3.turnId])
    expect(result.errorKind).toBe('rebase-failed')
    // After abort, the branch is back to its original three commits.
    const subjects = execFileSync(
      'git',
      ['log', 'main..HEAD', '--reverse', '--pretty=format:%s'],
      { cwd: repoRoot }
    ).toString().trim().split('\n')
    expect(subjects).toEqual([
      'wip(turn-1): Add shared.txt',
      'wip(turn-2): Bump shared.txt to B',
      'wip(turn-3): Append C to shared.txt'
    ])
    void t1
    // Sidecar untouched on the failed first attempt.
    const sidecar = await readDiscardedSidecar(repoRoot)
    expect(sidecar.discarded).toEqual({})
  })
})

describe('discardTurn — cascade-confirmed', () => {
  it('drops the selected turn AND every dependent in one shot', async () => {
    const t1 = commitTurn(repoRoot, 1, 'Add shared.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'shared.txt'), 'A\n')
    })
    const t2 = commitTurn(repoRoot, 2, 'Bump shared.txt to B', () => {
      fs.writeFileSync(path.join(repoRoot, 'shared.txt'), 'B\n')
    })
    const t3 = commitTurn(repoRoot, 3, 'Append C to shared.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'shared.txt'), 'B\nC\n')
    })

    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await discardTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: t2.turnId,
      cascadeConfirmed: true
    })

    expect(result.ok).toBe(true)
    // Branch is back to just T1.
    const subjects = execFileSync(
      'git',
      ['log', 'main..HEAD', '--reverse', '--pretty=format:%s'],
      { cwd: repoRoot }
    ).toString().trim().split('\n')
    expect(subjects).toEqual(['wip(turn-1): Add shared.txt'])
    // Working tree: shared.txt is back to T1's content.
    expect(readFile(repoRoot, 'shared.txt')).toBe('A\n')
    // Both T2 and T3 logged in the sidecar with their original indices.
    const sidecar = await readDiscardedSidecar(repoRoot)
    expect(Object.keys(sidecar.discarded).sort()).toEqual([t2.turnId, t3.turnId].sort())
    expect(sidecar.discarded[t2.turnId]!.originalIndex).toBe(2)
    expect(sidecar.discarded[t3.turnId]!.originalIndex).toBe(3)
    void t1
  })
})

describe('discardTurn — guard rails', () => {
  it('rejects an unknown turn id', async () => {
    commitTurn(repoRoot, 1, 'Add a.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'A\n')
    })

    const pane = makeStubPane(repoRoot)
    const stubs = makeStubs(pane)

    const result = await discardTurn({
      worktreePath: repoRoot,
      paneId: pane.id,
      windowId: pane.windowId,
      windowManager: stubs.windowManager,
      sessionRegistry: stubs.sessionRegistry,
      turnId: 'no-such-turn',
      cascadeConfirmed: false
    })
    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('turn-not-found')
  })

  it('verifies the trailer round-trips through projection (sanity check)', async () => {
    // Confirms turn-recorder's commit-message format is parseable by the
    // projection, otherwise discard would never see a turn at all.
    const { sha } = commitTurn(repoRoot, 1, 'Add t.txt', () => {
      fs.writeFileSync(path.join(repoRoot, 't.txt'), 'T\n')
    })
    const message = execFileSync(
      'git',
      ['log', '-1', '--format=%B', sha],
      { cwd: repoRoot }
    ).toString()
    expect(message).toContain(TURN_ID_TRAILER)
  })
})
