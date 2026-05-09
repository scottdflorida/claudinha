/**
 * Integration tests for `bulk-action-pipeline` against real temp git
 * repos. Pins the M5 ship criterion: bulk action across N panes drains
 * with mixed outcomes and emits one `BULK_COMPLETED` with the full
 * results.
 *
 * Coverage:
 *   - `discard-all` across two panes, both with publishable turns →
 *     both end up with empty projections; BULK_COMPLETED fires with
 *     two `{ ok: true }` results.
 *   - Mixed outcome: one pane succeeds, one fails (resolved branch is
 *     bogus) → pipeline drains both; results array carries the error
 *     for the failing pane; BULK_COMPLETED still fires.
 *   - Cancellation: cancelling between panes records the remaining
 *     panes as `cancelled` errors and the run still emits
 *     BULK_COMPLETED.
 *
 * The pipeline is fire-and-forget (returns runId immediately), so the
 * tests await a Promise that resolves when the stub WindowManager
 * receives a BULK_COMPLETED event.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'

import {
  runBulkAction,
  cancelBulkRun
} from '../src/main/bulk-action-pipeline'
import { formatTurnCommitMessage } from '../src/main/turn-recorder'
import { IPC } from '../src/shared/ipc-channels'
import type {
  BulkCompletedPayload,
  BulkProgressPayload
} from '../src/shared/ipc-channels'
import type { PaneState } from '../src/shared/types'

// ----------------------------------------------------------------------------
// Stubs
// ----------------------------------------------------------------------------

interface CapturedEvent {
  channel: string
  payload: unknown
}

function makePane(args: {
  id: string
  workspaceId: string
  worktreePath: string
}): PaneState {
  return {
    id: args.id,
    windowId: 'win-1',
    workspaceId: args.workspaceId,
    ptyId: `pty-${args.id}`,
    sessionId: null,
    transcriptPath: null,
    contextWindowSize: null,
    repoName: 'bulk-repo',
    worktreeName: path.basename(args.worktreePath),
    worktreePath: args.worktreePath,
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
      totalTokens: null, contextPercent: null, toolsUsed: null,
      totalCostUsd: null, durationMs: null, modelDisplayName: null,
      linesAdded: null, linesRemoved: null, sessionTitle: null,
      agentName: null, initialPrompt: null, lastMessage: null
    },
    createdAt: Date.now(),
    gitStatus: null,
    isWorktree: false,
    completionActionStatus: null,
    autoCommitEnabled: true
  }
}

function makeStubs(panes: PaneState[]): {
  events: CapturedEvent[]
  sessionRegistry: Parameters<typeof runBulkAction>[0]['sessionRegistry']
  windowManager: Parameters<typeof runBulkAction>[0]['windowManager']
  sideCloneManager: Parameters<typeof runBulkAction>[0]['sideCloneManager']
  waitForCompleted: () => Promise<BulkCompletedPayload>
} {
  const events: CapturedEvent[] = []
  let resolveCompleted: ((p: BulkCompletedPayload) => void) | null = null
  const completedPromise = new Promise<BulkCompletedPayload>((r) => { resolveCompleted = r })
  const stubWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        events.push({ channel, payload })
        if (channel === IPC.BULK_COMPLETED && resolveCompleted) {
          resolveCompleted(payload as BulkCompletedPayload)
        }
      }
    }
  }
  const sessionRegistry = {
    getPane: (id: string) => panes.find((p) => p.id === id),
    getAllPanes: () => new Map(panes.map((p) => [p.id, p]))
  } as unknown as Parameters<typeof runBulkAction>[0]['sessionRegistry']
  const windowManager = {
    getWindow: () => stubWindow,
    getAllWindows: () => new Map([['win-1', stubWindow]])
  } as unknown as Parameters<typeof runBulkAction>[0]['windowManager']
  // Stub side-clone manager (only used by merge/PR paths; discard-all
  // doesn't reach it).
  const sideCloneManager = {
    ensure: async () => path.join(os.tmpdir(), 'never-used'),
    withSideClone: async () => { throw new Error('not used in test') },
    gc: async () => null
  } as unknown as Parameters<typeof runBulkAction>[0]['sideCloneManager']
  return {
    events,
    sessionRegistry,
    windowManager,
    sideCloneManager,
    waitForCompleted: () => completedPromise
  }
}

// ----------------------------------------------------------------------------
// Fixture
// ----------------------------------------------------------------------------

let panePaths: string[] = []
let remoteRoots: string[] = []

beforeEach(() => {
  panePaths = []
  remoteRoots = []
})

afterEach(() => {
  for (const dir of [...remoteRoots, ...panePaths]) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  panePaths = []
  remoteRoots = []
})

// Each pane gets its own bare remote — they're independent repos, not
// colocated worktrees. Sharing a single bare across pane repos with
// independent `init` commits causes the second push to fail non-FF.
function makePaneRepo(): string {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-remote-'))
  execFileSync('git', ['init', '--bare', '--initial-branch=main', '-q'], { cwd: remote })
  remoteRoots.push(remote)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-pane-'))
  panePaths.push(root)
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: root })
  for (const cfg of [
    ['user.email', 't@t.com'], ['user.name', 't'], ['commit.gpgsign', 'false']
  ]) {
    execFileSync('git', ['config', cfg[0]!, cfg[1]!], { cwd: root })
  }
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root })
  fs.writeFileSync(path.join(root, 'README.md'), 'init\n')
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'init', '-q'], { cwd: root })
  execFileSync('git', ['push', '-u', 'origin', 'main', '-q'], { cwd: root })
  return root
}

function commitTurn(repoRoot: string, index: number, summary: string, edit: () => void, paneId: string): string {
  edit()
  execFileSync('git', ['add', '-A'], { cwd: repoRoot })
  const turnId = `turn-${index}-${Math.random().toString(36).slice(2)}`
  execFileSync('git', ['commit', '-m', formatTurnCommitMessage(index, summary, turnId, paneId), '-q'], { cwd: repoRoot })
  return turnId
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('runBulkAction — discard-all', () => {
  it('drops every publishable turn on each pane and emits one BULK_COMPLETED', async () => {
    const repoA = makePaneRepo()
    const repoB = makePaneRepo()
    commitTurn(repoA, 1, 'A1', () => {
      fs.writeFileSync(path.join(repoA, 'a1.txt'), 'A1\n')
    }, 'pane-A')
    commitTurn(repoA, 2, 'A2', () => {
      fs.writeFileSync(path.join(repoA, 'a2.txt'), 'A2\n')
    }, 'pane-A')
    commitTurn(repoB, 1, 'B1', () => {
      fs.writeFileSync(path.join(repoB, 'b1.txt'), 'B1\n')
    }, 'pane-B')

    const paneA = makePane({ id: 'pane-A', workspaceId: 'ws-1', worktreePath: repoA })
    const paneB = makePane({ id: 'pane-B', workspaceId: 'ws-1', worktreePath: repoB })
    const stubs = makeStubs([paneA, paneB])

    const runResult = await runBulkAction({
      workspaceId: 'ws-1',
      repoPath: repoA, // not used by discard-all — pipeline runs whatever paneIds we pass
      paneIds: ['pane-A', 'pane-B'],
      action: 'discard-all',
      sessionRegistry: stubs.sessionRegistry,
      windowManager: stubs.windowManager,
      sideCloneManager: stubs.sideCloneManager
    })
    expect(runResult.error).toBeNull()
    expect(runResult.runId).toBeDefined()

    const completed = await stubs.waitForCompleted()
    expect(completed.runId).toBe(runResult.runId)
    expect(completed.results.map((r) => r.ok)).toEqual([true, true])
    expect(completed.results[0]!.paneId).toBe('pane-A')
    expect(completed.results[1]!.paneId).toBe('pane-B')

    // Both repos are at HEAD = init now (no commits ahead of origin/main).
    const aSubject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repoA }).toString().trim()
    const bSubject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repoB }).toString().trim()
    expect(aSubject).toBe('init')
    expect(bSubject).toBe('init')

    // BULK_PROGRESS fired twice (one per pane), in pane order.
    const progress = stubs.events.filter((e) => e.channel === IPC.BULK_PROGRESS)
      .map((e) => e.payload as BulkProgressPayload)
    expect(progress.length).toBe(2)
    expect(progress[0]!.paneId).toBe('pane-A')
    expect(progress[1]!.paneId).toBe('pane-B')
    expect(progress[0]!.completed).toBe(1)
    expect(progress[0]!.total).toBe(2)
    expect(progress[1]!.completed).toBe(2)
  })

  it('records errors for unknown panes and still drains', async () => {
    const repoA = makePaneRepo()
    commitTurn(repoA, 1, 'A1', () => {
      fs.writeFileSync(path.join(repoA, 'a1.txt'), 'A1\n')
    }, 'pane-A')
    const paneA = makePane({ id: 'pane-A', workspaceId: 'ws-1', worktreePath: repoA })
    const stubs = makeStubs([paneA])

    const runResult = await runBulkAction({
      workspaceId: 'ws-1',
      repoPath: repoA,
      paneIds: ['pane-A', 'pane-NOPE'],
      action: 'discard-all',
      sessionRegistry: stubs.sessionRegistry,
      windowManager: stubs.windowManager,
      sideCloneManager: stubs.sideCloneManager
    })
    expect(runResult.error).toBeNull()

    const completed = await stubs.waitForCompleted()
    expect(completed.results.length).toBe(2)
    expect(completed.results[0]!.ok).toBe(true)
    expect(completed.results[1]!.ok).toBe(false)
    expect(completed.results[1]!.errorMessage).toMatch(/pane not found/)
  })

  it('cancellation marks remaining panes as cancelled and still emits BULK_COMPLETED', async () => {
    const repoA = makePaneRepo()
    const repoB = makePaneRepo()
    commitTurn(repoA, 1, 'A1', () => {
      fs.writeFileSync(path.join(repoA, 'a1.txt'), 'A1\n')
    }, 'pane-A')
    commitTurn(repoB, 1, 'B1', () => {
      fs.writeFileSync(path.join(repoB, 'b1.txt'), 'B1\n')
    }, 'pane-B')
    const paneA = makePane({ id: 'pane-A', workspaceId: 'ws-1', worktreePath: repoA })
    const paneB = makePane({ id: 'pane-B', workspaceId: 'ws-1', worktreePath: repoB })
    const stubs = makeStubs([paneA, paneB])

    const runResult = await runBulkAction({
      workspaceId: 'ws-1',
      repoPath: repoA,
      paneIds: ['pane-A', 'pane-B'],
      action: 'discard-all',
      sessionRegistry: stubs.sessionRegistry,
      windowManager: stubs.windowManager,
      sideCloneManager: stubs.sideCloneManager
    })
    // Cancel before the pipeline completes.
    cancelBulkRun(runResult.runId!)

    const completed = await stubs.waitForCompleted()
    // Pane A may or may not have completed before cancellation kicked
    // in — accept either order, but at least one pane must be marked
    // cancelled.
    const cancelledCount = completed.results.filter(
      (r) => !r.ok && r.errorMessage === 'cancelled'
    ).length
    expect(cancelledCount).toBeGreaterThanOrEqual(1)
  })
})
