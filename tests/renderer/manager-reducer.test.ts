// @vitest-environment happy-dom
/**
 * Tests for the manager state reducer.
 */

import { managerReducer } from '../../src/renderer/hooks/useManagerState'
import type { ManagerState } from '../../src/renderer/hooks/useManagerState'

const initialState: ManagerState = { activeWorkspaces: [], dormantWorkspaces: [], archivedWorkspaces: [] }

describe('managerReducer', () => {
  it('SET_STATE replaces active, dormant, and archived workspaces', () => {
    const activeWorkspaces = [{ id: 'h1', name: 'Workspace 1', type: 'general' as const, status: 'active' as const, constraint: {}, paneCount: 2, createdAt: '2026-01-01' }]
    const dormantWorkspaces = [{ id: 'h2', name: 'Workspace 2', type: 'repo' as const, status: 'dormant' as const, constraint: {}, paneCount: 0, createdAt: '2026-01-02' }]
    const archivedWorkspaces = [{ id: 'h3', name: 'Workspace 3', type: 'general' as const, status: 'archived' as const, constraint: {}, paneCount: 0, createdAt: '2026-01-03' }]

    const result = managerReducer(initialState, {
      type: 'SET_STATE',
      payload: { activeWorkspaces, dormantWorkspaces, archivedWorkspaces } as any
    })
    expect(result.activeWorkspaces).toEqual(activeWorkspaces)
    expect(result.dormantWorkspaces).toEqual(dormantWorkspaces)
    expect(result.archivedWorkspaces).toEqual(archivedWorkspaces)
  })

  it('returns same state for unknown action type', () => {
    const result = managerReducer(initialState, { type: 'UNKNOWN' } as any)
    expect(result).toBe(initialState)
  })
})
