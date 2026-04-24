/**
 * PlanApprovalSequencer unit tests.
 *
 * Covers queue seeding, the `1\r` keystroke injection (Claude Code's
 * plan-approval picker option 1 = "Yes, and use auto mode"), multi-stage
 * status transition handling (`needs-input → working → terminal`), dedupe,
 * mid-run arrivals, stop semantics, watchdog timeout, and pane-close cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PaneState, PaneStatus } from '../src/shared/types'
import type { SessionRegistry } from '../src/main/session-registry'
import type { PtyPool } from '../src/main/pty-pool'
import { PlanApprovalSequencer, isPaneAwaitingPlanApproval } from '../src/main/plan-approval-sequencer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusListener = (paneId: string, next: PaneStatus, prev: PaneStatus) => void

/**
 * Minimal SessionRegistry harness that stores PaneStates by id and
 * dispatches status-change listeners registered via `onNextStatusChange`.
 * The sequencer only reads a handful of methods so this is cheaper than
 * instantiating the real registry.
 */
function makeMockRegistry(initial: PaneState[]) {
  const panes = new Map<string, PaneState>()
  for (const p of initial) panes.set(p.id, p)

  const listeners = new Map<string, Set<StatusListener>>()

  const getPane = (id: string): PaneState | undefined => panes.get(id)

  const getPanesForWorkspace = (workspaceId: string): PaneState[] => {
    return Array.from(panes.values()).filter((p) => p.workspaceId === workspaceId)
  }

  const onNextStatusChange = (paneId: string, listener: StatusListener): (() => void) => {
    let set = listeners.get(paneId)
    if (!set) {
      set = new Set()
      listeners.set(paneId, set)
    }
    set.add(listener)
    return () => {
      listeners.get(paneId)?.delete(listener)
    }
  }

  const setPaneState = (paneId: string, patch: Partial<PaneState>): void => {
    const current = panes.get(paneId)
    if (!current) return
    Object.assign(current, patch)
  }

  /**
   * Simulate a status transition: updates the PaneState and fires (one-shot)
   * every listener registered for the pane. Matches real registry semantics.
   */
  const fireStatus = (paneId: string, next: PaneStatus, activeToolName: string | null = null): void => {
    const pane = panes.get(paneId)
    if (!pane) return
    const prev = pane.status
    pane.status = next
    pane.activeToolName = activeToolName
    const set = listeners.get(paneId)
    if (!set || set.size === 0) return
    const snapshot = [...set]
    listeners.delete(paneId)
    for (const fn of snapshot) fn(paneId, next, prev)
  }

  const addPane = (pane: PaneState): void => {
    panes.set(pane.id, pane)
  }

  const removePane = (paneId: string): void => {
    panes.delete(paneId)
    listeners.delete(paneId)
  }

  const registry = {
    getPane,
    getPanesForWorkspace,
    onNextStatusChange
  } as unknown as SessionRegistry

  return { registry, setPaneState, fireStatus, addPane, removePane, listeners }
}

function makeMockPool() {
  const alive = new Set<string>()
  const writes: Array<{ paneId: string; data: string }> = []

  const pool = {
    isAlive: vi.fn((paneId: string) => alive.has(paneId)),
    write: vi.fn((paneId: string, data: string) => {
      writes.push({ paneId, data })
    })
  } as unknown as PtyPool

  return {
    pool,
    alive,
    writes
  }
}

function makePane(overrides: Partial<PaneState>): PaneState {
  return {
    id: 'pane-x',
    workspaceId: 'ws-1',
    windowId: 'win-1',
    workingDirectory: '/repo-a/tree-x',
    worktreePath: '/repo-a/tree-x',
    worktreeName: 'tree-x',
    repoName: 'repo-a',
    isWorktree: true,
    status: 'needs-input',
    statusSource: 'hook',
    statusChangedAt: Date.now(),
    isFocused: false,
    hasUnseenStatusChange: false,
    createdAt: Date.now(),
    activeToolName: 'ExitPlanMode',
    sessionId: null,
    transcriptPath: null,
    contextWindowSize: null,
    terminated: false,
    metrics: {
      totalTokens: null,
      contextPercent: null,
      toolsUsed: null,
      totalCostUsd: null,
      durationMs: null,
      modelDisplayName: null,
      linesAdded: null,
      linesRemoved: null,
      sessionTitle: null
    },
    gitStatus: null,
    completionActionStatus: null,
    isResolvingConflict: false,
    permissionMode: 'plan',
    effort: null,
    model: null,
    userName: null,
    ...overrides
  } as unknown as PaneState
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isPaneAwaitingPlanApproval', () => {
  it('matches ExitPlanMode + needs-input', () => {
    const pane = makePane({ activeToolName: 'ExitPlanMode', status: 'needs-input' })
    expect(isPaneAwaitingPlanApproval(pane)).toBe(true)
  })

  it('matches permissionMode plan + needs-input (fallback)', () => {
    const pane = makePane({ activeToolName: null, permissionMode: 'plan', status: 'needs-input' })
    expect(isPaneAwaitingPlanApproval(pane)).toBe(true)
  })

  it('rejects working status even with plan mode', () => {
    const pane = makePane({
      activeToolName: null,
      permissionMode: 'plan',
      status: 'working'
    })
    expect(isPaneAwaitingPlanApproval(pane)).toBe(false)
  })

  it('rejects needs-input with no plan signal', () => {
    const pane = makePane({
      activeToolName: null,
      permissionMode: 'normal',
      status: 'needs-input'
    })
    expect(isPaneAwaitingPlanApproval(pane)).toBe(false)
  })
})

describe('PlanApprovalSequencer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('seeds the queue from matching awaiting-plan-approval panes and writes "1\\r" in order', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1', createdAt: 1 }),
      makePane({ id: 'p2', worktreePath: '/repo-a/tree-2', createdAt: 2 })
    ]
    const { registry } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')
    alive.add('p2')

    const seq = new PlanApprovalSequencer(registry, pool)
    const onStateChange = vi.fn()
    const { queuedCount } = seq.start('ws-1', '/repo-a', onStateChange)

    expect(queuedCount).toBe(2)
    expect(seq.isRunning('ws-1', '/repo-a')).toBe(true)

    // Settle delay must elapse before the first write.
    expect(writes).toEqual([])
    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([{ paneId: 'p1', data: '1\r' }])
  })

  it('guards: skips a pane that is no longer awaiting approval by the time it is processed', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' }),
      makePane({ id: 'p2', worktreePath: '/repo-a/tree-2' })
    ]
    const { registry, setPaneState, fireStatus } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')
    alive.add('p2')

    const seq = new PlanApprovalSequencer(registry, pool)
    seq.start('ws-1', '/repo-a', vi.fn())

    // User manually approves p1 before the settle delay elapses — pane is
    // no longer in ExitPlanMode state.
    setPaneState('p1', { activeToolName: null, permissionMode: 'normal', status: 'working' })
    // Two cascading settle-delays: p1's fires (skips), processNext schedules
    // another for p2. 500ms covers both.
    await vi.advanceTimersByTimeAsync(500)

    // p1 skipped; p2 takes its place.
    expect(writes).toEqual([{ paneId: 'p2', data: '1\r' }])

    // Finish p2 so the sequencer can drain.
    fireStatus('p2', 'working')
    fireStatus('p2', 'done')
    await vi.advanceTimersByTimeAsync(500)
    expect(seq.isRunning('ws-1', '/repo-a')).toBe(false)
  })

  it('waits through needs-input → working → done before advancing', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' }),
      makePane({ id: 'p2', worktreePath: '/repo-a/tree-2' })
    ]
    const { registry, fireStatus } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')
    alive.add('p2')

    const seq = new PlanApprovalSequencer(registry, pool)
    seq.start('ws-1', '/repo-a', vi.fn())
    await vi.advanceTimersByTimeAsync(250)

    expect(writes).toEqual([{ paneId: 'p1', data: '1\r' }])

    // The first transition is to 'working' — sequencer must NOT advance yet.
    fireStatus('p1', 'working')
    await vi.advanceTimersByTimeAsync(0)
    expect(writes.length).toBe(1)

    // Completion — now it advances.
    fireStatus('p1', 'done')
    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([
      { paneId: 'p1', data: '1\r' },
      { paneId: 'p2', data: '1\r' }
    ])
  })

  it('treats any terminal state — needs-input, error, awaiting-prompt — as advance-ready', async () => {
    for (const terminal of ['needs-input', 'error', 'awaiting-prompt'] as const) {
      const panes = [
        makePane({ id: 'a', worktreePath: '/repo-a/tree-a' }),
        makePane({ id: 'b', worktreePath: '/repo-a/tree-b' })
      ]
      const { registry, fireStatus } = makeMockRegistry(panes)
      const { pool, alive, writes } = makeMockPool()
      alive.add('a')
      alive.add('b')

      const seq = new PlanApprovalSequencer(registry, pool)
      seq.start('ws-1', '/repo-a', vi.fn())
      await vi.advanceTimersByTimeAsync(250)

      fireStatus('a', 'working')
      fireStatus('a', terminal)
      await vi.advanceTimersByTimeAsync(250)

      expect(writes.map((w) => w.paneId)).toEqual(['a', 'b'])
    }
  })

  it('picks up a pane that newly enters awaiting-plan-approval between approvals', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' }),
      // p2 is not yet awaiting approval (different activeToolName)
      makePane({
        id: 'p2',
        worktreePath: '/repo-a/tree-2',
        activeToolName: null,
        permissionMode: 'normal',
        status: 'working'
      })
    ]
    const { registry, setPaneState, fireStatus } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')
    alive.add('p2')

    const seq = new PlanApprovalSequencer(registry, pool)
    const { queuedCount } = seq.start('ws-1', '/repo-a', vi.fn())
    expect(queuedCount).toBe(1) // only p1 matched at start

    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([{ paneId: 'p1', data: '1\r' }])

    // While p1 is implementing, p2 arrives at the plan-approval picker.
    setPaneState('p2', {
      activeToolName: 'ExitPlanMode',
      permissionMode: 'plan',
      status: 'needs-input'
    })
    fireStatus('p1', 'working')
    fireStatus('p1', 'done')
    await vi.advanceTimersByTimeAsync(250)

    // p2 was picked up on re-scan.
    expect(writes).toEqual([
      { paneId: 'p1', data: '1\r' },
      { paneId: 'p2', data: '1\r' }
    ])
  })

  it('dedupe: a pane does not get approved twice even if it re-enters ExitPlanMode after completion', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' })
    ]
    const { registry, fireStatus, setPaneState } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')

    const seq = new PlanApprovalSequencer(registry, pool)
    seq.start('ws-1', '/repo-a', vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([{ paneId: 'p1', data: '1\r' }])

    fireStatus('p1', 'working')

    // p1 replans on its own — briefly back to ExitPlanMode after finishing.
    setPaneState('p1', {
      activeToolName: 'ExitPlanMode',
      permissionMode: 'plan'
    })
    fireStatus('p1', 'needs-input')
    await vi.advanceTimersByTimeAsync(250)

    // Queue drained — no second keystroke.
    expect(writes.length).toBe(1)
    expect(seq.isRunning('ws-1', '/repo-a')).toBe(false)
  })

  it('stop(): clears the queue without writing more keystrokes', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' }),
      makePane({ id: 'p2', worktreePath: '/repo-a/tree-2' }),
      makePane({ id: 'p3', worktreePath: '/repo-a/tree-3' })
    ]
    const { registry, fireStatus } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')
    alive.add('p2')
    alive.add('p3')

    const seq = new PlanApprovalSequencer(registry, pool)
    seq.start('ws-1', '/repo-a', vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([{ paneId: 'p1', data: '1\r' }])

    // User cancels after p1 is approved but before p2 starts.
    seq.stop('ws-1', '/repo-a')

    // In-flight pane runs to its natural terminal state — the sequencer
    // doesn't interrupt it, but nothing further is written.
    fireStatus('p1', 'working')
    fireStatus('p1', 'done')
    await vi.advanceTimersByTimeAsync(1000)

    expect(writes).toEqual([{ paneId: 'p1', data: '1\r' }])
    expect(seq.isRunning('ws-1', '/repo-a')).toBe(false)
  })

  it('stop() before any pane is in flight drains immediately', async () => {
    const panes = [makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' })]
    const { registry } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')

    const seq = new PlanApprovalSequencer(registry, pool)
    seq.start('ws-1', '/repo-a', vi.fn())
    // Stop BEFORE the settle-delay callback runs for p1.
    seq.stop('ws-1', '/repo-a')
    await vi.advanceTimersByTimeAsync(250)

    expect(writes).toEqual([])
    expect(seq.isRunning('ws-1', '/repo-a')).toBe(false)
  })

  it('watchdog fires and advances the queue if the approved pane never transitions', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' }),
      makePane({ id: 'p2', worktreePath: '/repo-a/tree-2' })
    ]
    const { registry } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')
    alive.add('p2')

    const seq = new PlanApprovalSequencer(registry, pool)
    seq.start('ws-1', '/repo-a', vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([{ paneId: 'p1', data: '1\r' }])

    // No status change arrives — fast-forward past the watchdog timeout.
    await vi.advanceTimersByTimeAsync(31 * 60 * 1_000)

    expect(writes).toEqual([
      { paneId: 'p1', data: '1\r' },
      { paneId: 'p2', data: '1\r' }
    ])
  })

  it('onPaneClosed() cleans up listeners and advances the queue if the in-flight pane dies', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' }),
      makePane({ id: 'p2', worktreePath: '/repo-a/tree-2' })
    ]
    const { registry, listeners } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')
    alive.add('p2')

    const seq = new PlanApprovalSequencer(registry, pool)
    seq.start('ws-1', '/repo-a', vi.fn())
    await vi.advanceTimersByTimeAsync(250)

    // p1 is the in-flight pane and has an onNextStatusChange subscription.
    expect(listeners.get('p1')?.size ?? 0).toBe(1)

    seq.onPaneClosed('p1')
    // Listener cleaned up.
    expect(listeners.get('p1')?.size ?? 0).toBe(0)

    // Queue advances to p2.
    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([
      { paneId: 'p1', data: '1\r' },
      { paneId: 'p2', data: '1\r' }
    ])
  })

  it('start() on a repo that is already running is a no-op', async () => {
    const panes = [makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' })]
    const { registry } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')

    const seq = new PlanApprovalSequencer(registry, pool)
    seq.start('ws-1', '/repo-a', vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([{ paneId: 'p1', data: '1\r' }])

    // Second start while running — should not write a second keystroke.
    const { queuedCount } = seq.start('ws-1', '/repo-a', vi.fn())
    expect(queuedCount).toBeGreaterThanOrEqual(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(writes.length).toBe(1)
  })

  it('start() returns queuedCount 0 when no panes match (no state change, no write)', async () => {
    const panes = [
      makePane({
        id: 'p1',
        worktreePath: '/repo-a/tree-1',
        status: 'working',
        activeToolName: 'Edit',
        permissionMode: 'normal'
      })
    ]
    const { registry } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')

    const seq = new PlanApprovalSequencer(registry, pool)
    const onStateChange = vi.fn()
    const { queuedCount } = seq.start('ws-1', '/repo-a', onStateChange)

    expect(queuedCount).toBe(0)
    expect(seq.isRunning('ws-1', '/repo-a')).toBe(false)
    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([])
    expect(onStateChange).not.toHaveBeenCalled()
  })

  it('filters by repoPath — does not pick up awaiting-plan-approval panes in other repos', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' }),
      makePane({ id: 'p2', worktreePath: '/repo-b/tree-1' })
    ]
    const { registry, fireStatus } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    alive.add('p1')
    alive.add('p2')

    const seq = new PlanApprovalSequencer(registry, pool)
    const { queuedCount } = seq.start('ws-1', '/repo-a', vi.fn())
    expect(queuedCount).toBe(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(writes).toEqual([{ paneId: 'p1', data: '1\r' }])

    fireStatus('p1', 'working')
    fireStatus('p1', 'done')
    await vi.advanceTimersByTimeAsync(250)

    // p2 stayed out — different repo.
    expect(writes.length).toBe(1)
  })

  it('skips a pane whose PTY is not alive and advances to the next', async () => {
    const panes = [
      makePane({ id: 'p1', worktreePath: '/repo-a/tree-1' }),
      makePane({ id: 'p2', worktreePath: '/repo-a/tree-2' })
    ]
    const { registry, fireStatus } = makeMockRegistry(panes)
    const { pool, alive, writes } = makeMockPool()
    // p1's PTY is dead; p2 is alive.
    alive.add('p2')

    const seq = new PlanApprovalSequencer(registry, pool)
    seq.start('ws-1', '/repo-a', vi.fn())
    // Two settle-delays: p1 fires and is skipped (no PTY), then p2's is scheduled.
    await vi.advanceTimersByTimeAsync(500)

    expect(writes).toEqual([{ paneId: 'p2', data: '1\r' }])
    fireStatus('p2', 'working')
    fireStatus('p2', 'done')
    await vi.advanceTimersByTimeAsync(500)
    expect(seq.isRunning('ws-1', '/repo-a')).toBe(false)
  })
})
