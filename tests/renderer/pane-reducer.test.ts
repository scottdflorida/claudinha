// @vitest-environment happy-dom
/**
 * Tests for the pane state reducer — the renderer's core state management.
 * Directly tests the exported reducer function without needing React rendering.
 */

import { paneReducer } from '../../src/renderer/hooks/usePaneState'
import type { PaneStoreState, PaneAction, RendererPane } from '../../src/renderer/hooks/usePaneState'
import type { PaneMetricsIpc } from '../../src/shared/ipc-channels'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyMetrics: PaneMetricsIpc = {
  totalTokens: null,
  contextPercent: null,
  toolsUsed: null,
  totalCostUsd: null,
  durationMs: null,
  modelDisplayName: null,
  linesAdded: null,
  linesRemoved: null,
  sessionTitle: null
}

function makePane(overrides?: Partial<RendererPane>): RendererPane {
  return {
    id: 'pane-1',
    repoName: 'repo',
    worktreeName: 'wt',
    worktreePath: '/path/wt',
    isApiBilling: false,
    effort: 'high',
    model: 'opus',
    status: 'awaiting-prompt',
    activeToolName: null,
    statusSource: 'pty-fallback',
    metrics: emptyMetrics,
    terminated: false,
    hasUnseenStatusChange: false,
    initialBuffer: null,
    gitStatus: null,
    isWorktree: false,
    completionStatus: null,
    ...overrides
  }
}

function makeState(overrides?: Partial<PaneStoreState>): PaneStoreState {
  return {
    panes: [],
    focusedPaneId: null,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// ADD_PANE
// ---------------------------------------------------------------------------

describe('ADD_PANE', () => {
  it('adds a new pane and auto-focuses it', () => {
    const state = makeState()
    const result = paneReducer(state, {
      type: 'ADD_PANE',
      payload: {
        paneId: 'p1', repoName: 'repo', worktreeName: 'wt',
        worktreePath: '/wt', isApiBilling: false, effort: 'high', model: 'opus', isWorktree: true
      }
    })
    expect(result.panes).toHaveLength(1)
    expect(result.panes[0].id).toBe('p1')
    expect(result.focusedPaneId).toBe('p1')
    expect(result.panes[0].isWorktree).toBe(true)
  })

  it('always focuses the new pane even when another is focused', () => {
    const state = makeState({ panes: [makePane({ id: 'existing' })], focusedPaneId: 'existing' })
    const result = paneReducer(state, {
      type: 'ADD_PANE',
      payload: {
        paneId: 'new', repoName: 'r', worktreeName: 'w',
        worktreePath: '/w', isApiBilling: false, effort: 'medium', model: 'opus', isWorktree: false
      }
    })
    expect(result.focusedPaneId).toBe('new')
  })

  it('deduplicates — ignores if pane already exists', () => {
    const existing = makePane({ id: 'dup' })
    const state = makeState({ panes: [existing], focusedPaneId: 'dup' })
    const result = paneReducer(state, {
      type: 'ADD_PANE',
      payload: {
        paneId: 'dup', repoName: 'r', worktreeName: 'w',
        worktreePath: '/w', isApiBilling: false, effort: 'high', model: 'opus', isWorktree: false
      }
    })
    expect(result).toBe(state) // reference equality — no change
  })
})

// ---------------------------------------------------------------------------
// ADD_PANE_MOVED
// ---------------------------------------------------------------------------

describe('ADD_PANE_MOVED', () => {
  it('adds moved pane with buffer and preserves existing focus', () => {
    const state = makeState({ panes: [makePane({ id: 'existing' })], focusedPaneId: 'existing' })
    const result = paneReducer(state, {
      type: 'ADD_PANE_MOVED',
      payload: {
        paneId: 'moved', repoName: 'r', worktreeName: 'w', worktreePath: '/w',
        isApiBilling: true, effort: 'low', model: 'opus', status: 'working', activeToolName: 'Edit',
        metrics: emptyMetrics, serializedBuffer: 'buffer-data'
      }
    })
    expect(result.panes).toHaveLength(2)
    expect(result.panes[1].initialBuffer).toBe('buffer-data')
    expect(result.focusedPaneId).toBe('existing') // preserved
  })

  it('auto-focuses moved pane when no pane is focused', () => {
    const state = makeState()
    const result = paneReducer(state, {
      type: 'ADD_PANE_MOVED',
      payload: {
        paneId: 'moved', repoName: 'r', worktreeName: 'w', worktreePath: '/w',
        isApiBilling: false, effort: 'high', model: 'opus', status: 'changes-ready', activeToolName: null,
        metrics: emptyMetrics
      }
    })
    expect(result.focusedPaneId).toBe('moved')
  })
})

// ---------------------------------------------------------------------------
// REMOVE_PANE
// ---------------------------------------------------------------------------

describe('REMOVE_PANE', () => {
  it('removes the pane', () => {
    const state = makeState({ panes: [makePane({ id: 'p1' }), makePane({ id: 'p2' })], focusedPaneId: 'p1' })
    const result = paneReducer(state, { type: 'REMOVE_PANE', payload: { paneId: 'p2' } })
    expect(result.panes).toHaveLength(1)
    expect(result.panes[0].id).toBe('p1')
  })

  it('shifts focus to last remaining pane when focused pane is removed', () => {
    const state = makeState({
      panes: [makePane({ id: 'a' }), makePane({ id: 'b' }), makePane({ id: 'c' })],
      focusedPaneId: 'c'
    })
    const result = paneReducer(state, { type: 'REMOVE_PANE', payload: { paneId: 'c' } })
    expect(result.focusedPaneId).toBe('b')
  })

  it('sets focus to null when last pane is removed', () => {
    const state = makeState({ panes: [makePane({ id: 'only' })], focusedPaneId: 'only' })
    const result = paneReducer(state, { type: 'REMOVE_PANE', payload: { paneId: 'only' } })
    expect(result.panes).toHaveLength(0)
    expect(result.focusedPaneId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// UPDATE_STATUS
// ---------------------------------------------------------------------------

describe('UPDATE_STATUS', () => {
  it('updates status and source for the correct pane', () => {
    const state = makeState({ panes: [makePane({ id: 'p1' })], focusedPaneId: 'p1' })
    const result = paneReducer(state, {
      type: 'UPDATE_STATUS',
      payload: { paneId: 'p1', status: 'working', activeToolName: 'Bash', source: 'hook' }
    })
    expect(result.panes[0].status).toBe('working')
    expect(result.panes[0].activeToolName).toBe('Bash')
    expect(result.panes[0].statusSource).toBe('hook')
  })

  it('sets hasUnseenStatusChange for unfocused panes', () => {
    const state = makeState({
      panes: [makePane({ id: 'focused' }), makePane({ id: 'bg' })],
      focusedPaneId: 'focused'
    })
    const result = paneReducer(state, {
      type: 'UPDATE_STATUS',
      payload: { paneId: 'bg', status: 'changes-ready', activeToolName: null, source: 'hook' }
    })
    expect(result.panes[1].hasUnseenStatusChange).toBe(true)
  })

  it('does NOT set hasUnseenStatusChange for the focused pane', () => {
    const state = makeState({ panes: [makePane({ id: 'p1' })], focusedPaneId: 'p1' })
    const result = paneReducer(state, {
      type: 'UPDATE_STATUS',
      payload: { paneId: 'p1', status: 'working', activeToolName: null, source: 'hook' }
    })
    expect(result.panes[0].hasUnseenStatusChange).toBe(false)
  })

  it('clears completionStatus on status transition', () => {
    const state = makeState({
      panes: [makePane({ id: 'p1', status: 'changes-ready', completionStatus: { state: 'idle' } as any })],
      focusedPaneId: 'p1'
    })
    const result = paneReducer(state, {
      type: 'UPDATE_STATUS',
      payload: { paneId: 'p1', status: 'working', activeToolName: null, source: 'hook' }
    })
    expect(result.panes[0].completionStatus).toBeNull()
  })

  it('preserves completionStatus when status does not change', () => {
    const cs = { state: 'idle' } as any
    const state = makeState({
      panes: [makePane({ id: 'p1', status: 'changes-ready', completionStatus: cs })],
      focusedPaneId: 'p1'
    })
    const result = paneReducer(state, {
      type: 'UPDATE_STATUS',
      payload: { paneId: 'p1', status: 'changes-ready', activeToolName: 'Read', source: 'hook' }
    })
    expect(result.panes[0].completionStatus).toBe(cs)
  })
})

// ---------------------------------------------------------------------------
// UPDATE_METRICS
// ---------------------------------------------------------------------------

describe('UPDATE_METRICS', () => {
  it('updates metrics for the correct pane', () => {
    const state = makeState({ panes: [makePane({ id: 'p1' })] })
    const newMetrics = { ...emptyMetrics, totalTokens: 500 }
    const result = paneReducer(state, {
      type: 'UPDATE_METRICS',
      payload: { paneId: 'p1', metrics: newMetrics }
    })
    expect(result.panes[0].metrics.totalTokens).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// SET_FOCUSED
// ---------------------------------------------------------------------------

describe('SET_FOCUSED', () => {
  it('sets focusedPaneId and clears hasUnseenStatusChange', () => {
    const state = makeState({
      panes: [makePane({ id: 'p1', hasUnseenStatusChange: true })],
      focusedPaneId: null
    })
    const result = paneReducer(state, { type: 'SET_FOCUSED', paneId: 'p1' })
    expect(result.focusedPaneId).toBe('p1')
    expect(result.panes[0].hasUnseenStatusChange).toBe(false)
  })

  it('can set focus to null', () => {
    const state = makeState({ panes: [makePane({ id: 'p1' })], focusedPaneId: 'p1' })
    const result = paneReducer(state, { type: 'SET_FOCUSED', paneId: null })
    expect(result.focusedPaneId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PANE_TERMINATED / PANE_RESPAWNED
// ---------------------------------------------------------------------------

describe('PANE_TERMINATED', () => {
  it('sets terminated flag', () => {
    const state = makeState({ panes: [makePane({ id: 'p1' })] })
    const result = paneReducer(state, { type: 'PANE_TERMINATED', payload: { paneId: 'p1', exitCode: 1 } })
    expect(result.panes[0].terminated).toBe(true)
  })
})

describe('PANE_RESPAWNED', () => {
  it('clears terminated and resets status/metrics', () => {
    const state = makeState({
      panes: [makePane({ id: 'p1', terminated: true, status: 'needs-input', metrics: { ...emptyMetrics, totalTokens: 100 } })]
    })
    const result = paneReducer(state, { type: 'PANE_RESPAWNED', payload: { paneId: 'p1' } })
    expect(result.panes[0].terminated).toBe(false)
    expect(result.panes[0].status).toBe('awaiting-prompt')
    expect(result.panes[0].metrics.totalTokens).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// UPDATE_EFFORT
// ---------------------------------------------------------------------------

describe('UPDATE_EFFORT', () => {
  it('updates effort for a specific pane', () => {
    const state = makeState({ panes: [makePane({ id: 'p1', effort: 'high' })] })
    const result = paneReducer(state, { type: 'UPDATE_EFFORT', paneId: 'p1', effort: 'low' })
    expect(result.panes[0].effort).toBe('low')
  })
})

describe('UPDATE_ALL_EFFORT', () => {
  it('updates effort for all non-terminated panes', () => {
    const state = makeState({
      panes: [
        makePane({ id: 'active', effort: 'high', terminated: false }),
        makePane({ id: 'dead', effort: 'high', terminated: true })
      ]
    })
    const result = paneReducer(state, { type: 'UPDATE_ALL_EFFORT', effort: 'low' })
    expect(result.panes[0].effort).toBe('low')
    expect(result.panes[1].effort).toBe('high') // terminated — unchanged
  })
})

// ---------------------------------------------------------------------------
// UPDATE_USER_NAME (Phase 8 — Kanban inline rename)
// ---------------------------------------------------------------------------

describe('UPDATE_USER_NAME', () => {
  it('sets a userName override on the target pane only', () => {
    const state = makeState({
      panes: [
        makePane({ id: 'p1', userName: null }),
        makePane({ id: 'p2', userName: 'keep me' })
      ]
    })
    const result = paneReducer(state, { type: 'UPDATE_USER_NAME', paneId: 'p1', userName: 'Refactor X' })
    expect(result.panes[0].userName).toBe('Refactor X')
    expect(result.panes[1].userName).toBe('keep me')
  })

  it('clears the override when userName is null', () => {
    const state = makeState({
      panes: [makePane({ id: 'p1', userName: 'old' })]
    })
    const result = paneReducer(state, { type: 'UPDATE_USER_NAME', paneId: 'p1', userName: null })
    expect(result.panes[0].userName).toBeNull()
  })

  it('is a no-op for unknown pane ids', () => {
    const state = makeState({
      panes: [makePane({ id: 'p1', userName: 'stays' })]
    })
    const result = paneReducer(state, { type: 'UPDATE_USER_NAME', paneId: 'nope', userName: 'never' })
    expect(result.panes[0].userName).toBe('stays')
  })
})

// ---------------------------------------------------------------------------
// UPDATE_MODEL
// ---------------------------------------------------------------------------

describe('UPDATE_MODEL', () => {
  it('updates model for a specific pane', () => {
    const state = makeState({
      panes: [
        makePane({ id: 'p1', model: 'opus' }),
        makePane({ id: 'p2', model: 'opus' })
      ]
    })
    const result = paneReducer(state, { type: 'UPDATE_MODEL', paneId: 'p1', model: 'sonnet' })
    expect(result.panes[0].model).toBe('sonnet')
    expect(result.panes[1].model).toBe('opus') // unchanged
  })

  it('seeds model from ADD_PANE payload', () => {
    const state = makeState()
    const result = paneReducer(state, {
      type: 'ADD_PANE',
      payload: {
        paneId: 'p1', repoName: 'r', worktreeName: 'w', worktreePath: '/w',
        isApiBilling: false, effort: 'high', model: 'haiku', isWorktree: false
      }
    })
    expect(result.panes[0].model).toBe('haiku')
  })

  it('preserves model across PANE_RESPAWNED', () => {
    const state = makeState({
      panes: [makePane({ id: 'p1', model: 'sonnet', terminated: true })]
    })
    const result = paneReducer(state, {
      type: 'PANE_RESPAWNED',
      payload: { paneId: 'p1' }
    })
    expect(result.panes[0].model).toBe('sonnet')
    expect(result.panes[0].terminated).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// UPDATE_GIT_STATUS / UPDATE_COMPLETION_STATUS
// ---------------------------------------------------------------------------

describe('UPDATE_GIT_STATUS', () => {
  it('updates gitStatus for the correct pane', () => {
    const state = makeState({ panes: [makePane({ id: 'p1' })] })
    const gs = { hasUncommittedChanges: true, changedFileCount: 3, commitsAhead: 1, branchName: 'feat' }
    const result = paneReducer(state, {
      type: 'UPDATE_GIT_STATUS',
      payload: { paneId: 'p1', gitStatus: gs }
    })
    expect(result.panes[0].gitStatus).toEqual(gs)
  })
})

describe('UPDATE_COMPLETION_STATUS', () => {
  it('updates completionStatus for the correct pane', () => {
    const state = makeState({ panes: [makePane({ id: 'p1' })] })
    const cs = { state: 'merging' as const }
    const result = paneReducer(state, {
      type: 'UPDATE_COMPLETION_STATUS',
      payload: { paneId: 'p1', status: cs as any }
    })
    expect(result.panes[0].completionStatus).toEqual(cs)
  })
})

// ---------------------------------------------------------------------------
// SEED_PANES
//
// Mount-time rehydrate: PaneStateProvider invokes PANE_LIST_GET once and
// seeds its reducer from the main-process registry snapshot. Under a
// renderer reload or Fast-Refresh remount, the original PANE_SPAWNED
// broadcasts are gone, so this seed is the *only* path by which panes
// re-appear in the UI. Regression guard: the workspace window showed its
// empty-state despite live PTYs because the renderer had no way to
// recover pane state after the provider remounted.
// ---------------------------------------------------------------------------

describe('SEED_PANES', () => {
  const seedEntry = (id: string) => ({
    paneId: id,
    repoName: 'repo',
    worktreeName: 'wt',
    worktreePath: '/wt',
    isApiBilling: false,
    effort: 'high' as const,
    model: 'opus' as const,
    isWorktree: true,
    status: 'awaiting-prompt' as const,
    activeToolName: null,
    statusSource: 'pty-fallback' as const,
    metrics: emptyMetrics,
    terminated: false,
    gitStatus: null,
    completionStatus: null,
    isResolvingConflict: false
  })

  it('adds every entry when state starts empty', () => {
    const state = makeState()
    const result = paneReducer(state, {
      type: 'SEED_PANES',
      payload: [seedEntry('p1'), seedEntry('p2')]
    })
    expect(result.panes.map((p) => p.id)).toEqual(['p1', 'p2'])
    // Focus defaults to the last seeded pane when nothing was focused.
    expect(result.focusedPaneId).toBe('p2')
  })

  it('does NOT overwrite a pane already in state (broadcast wins over seed)', () => {
    // A PANE_SPAWNED broadcast that beat the PANE_LIST_GET response is a
    // live, fresher source of truth than the snapshot. Re-adding it from
    // the seed would wipe any status/metrics updates that came in between.
    const live = makePane({ id: 'p1', status: 'working', activeToolName: 'Read' })
    const state = makeState({ panes: [live], focusedPaneId: 'p1' })
    const result = paneReducer(state, {
      type: 'SEED_PANES',
      payload: [{ ...seedEntry('p1'), status: 'awaiting-prompt', activeToolName: null }]
    })
    expect(result.panes).toHaveLength(1)
    expect(result.panes[0].status).toBe('working')
    expect(result.panes[0].activeToolName).toBe('Read')
    // Focus on the live pane is preserved.
    expect(result.focusedPaneId).toBe('p1')
  })

  it('merges — keeps live panes and appends seed-only ones', () => {
    const live = makePane({ id: 'p1' })
    const state = makeState({ panes: [live], focusedPaneId: 'p1' })
    const result = paneReducer(state, {
      type: 'SEED_PANES',
      payload: [seedEntry('p1'), seedEntry('p2')]
    })
    expect(result.panes.map((p) => p.id)).toEqual(['p1', 'p2'])
    // Focus stays on the live pane — the seed does not steal focus.
    expect(result.focusedPaneId).toBe('p1')
  })

  it('is a no-op when every seeded pane is already live', () => {
    const live = makePane({ id: 'p1' })
    const state = makeState({ panes: [live], focusedPaneId: 'p1' })
    const result = paneReducer(state, {
      type: 'SEED_PANES',
      payload: [seedEntry('p1')]
    })
    expect(result).toBe(state)
  })
})
