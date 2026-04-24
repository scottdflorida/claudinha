// @vitest-environment happy-dom
/**
 * Tests for the workspace state reducer.
 */

import { workspaceReducer } from '../../src/renderer/hooks/useWorkspaceState'
import type { WorkspaceState } from '../../src/renderer/hooks/useWorkspaceState'
import type { TerminalSnapshot } from '../../src/shared/types'

const initialState: WorkspaceState = { pausedTerminals: [] }

function makeDrone(overrides?: Partial<TerminalSnapshot>): TerminalSnapshot {
  return {
    paneId: 'terminal-1',
    sessionId: 'session-1',
    worktreePath: '/wt',
    repoName: 'repo',
    worktreeName: 'wt',
    sessionTitle: 'Task',
    wasActiveAtClose: true,
    snapshotAt: '2026-03-25T00:00:00Z',
    ...overrides
  }
}

describe('workspaceReducer', () => {
  it('SET_DORMANT replaces pausedTerminals array', () => {
    const terminals = [makeDrone({ paneId: 'd1' }), makeDrone({ paneId: 'd2' })]
    const result = workspaceReducer(initialState, { type: 'SET_DORMANT', payload: terminals })
    expect(result.pausedTerminals).toEqual(terminals)
  })

  it('SET_DORMANT with empty array clears terminals', () => {
    const state = { pausedTerminals: [makeDrone()] }
    const result = workspaceReducer(state, { type: 'SET_DORMANT', payload: [] })
    expect(result.pausedTerminals).toEqual([])
  })

  it('returns same state for unknown action type', () => {
    const result = workspaceReducer(initialState, { type: 'UNKNOWN' } as any)
    expect(result).toBe(initialState)
  })
})
