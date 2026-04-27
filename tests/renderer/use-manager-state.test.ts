// @vitest-environment jsdom
/**
 * Tests for useManagerState — specifically the mount-time seed that recovers
 * from the dropped initial MANAGER_STATE_UPDATE broadcast (L-006-style race).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { installMockApi, uninstallMockApi } from './helpers/mock-api'
import { useManagerState } from '../../src/renderer/hooks/useManagerState'
import { IPC } from '../../src/shared/ipc-channels'
import type { RendererWorkspace } from '../../src/shared/types'

function makeHive(overrides: Partial<RendererWorkspace> = {}): RendererWorkspace {
  return {
    id: 'workspace-1',
    name: 'My Workspace',
    workspaceNumber: 1,
    type: 'general',
    constraint: {},
    status: 'dormant',
    activePaneCount: 0,
    activePanes: [],
    pausedTerminals: [],
    lastActiveAt: 1_700_000_000_000,
    completionPolicy: null,
    ...overrides
  }
}

let api: ReturnType<typeof installMockApi>

beforeEach(() => {
  api = installMockApi()
})

afterEach(() => {
  cleanup()
  uninstallMockApi()
})

describe('useManagerState', () => {
  it('seeds initial state via ipcInvoke(WORKSPACE_LIST) on mount', async () => {
    const dormantHive = makeHive({ id: 'h1', name: 'Dormant One', status: 'dormant' })
    const activeHive = makeHive({ id: 'h2', name: 'Active One', status: 'active', activePaneCount: 2 })
    api.invoke.mockImplementation((channel: string) => {
      if (channel === IPC.WORKSPACE_LIST) {
        return Promise.resolve({
          activeWorkspaces: [activeHive],
          dormantWorkspaces: [dormantHive],
          archivedWorkspaces: []
        })
      }
      return Promise.resolve({})
    })

    const { result } = renderHook(() => useManagerState())

    // Initial state is empty (the reducer's initialState)
    expect(result.current.activeWorkspaces).toHaveLength(0)
    expect(result.current.dormantWorkspaces).toHaveLength(0)

    // After the mount effect resolves, the seed should populate the state
    await waitFor(() => {
      expect(result.current.activeWorkspaces).toHaveLength(1)
      expect(result.current.dormantWorkspaces).toHaveLength(1)
    })
    expect(result.current.activeWorkspaces[0].id).toBe('h2')
    expect(result.current.dormantWorkspaces[0].id).toBe('h1')
    expect(api.invoke).toHaveBeenCalledWith(IPC.WORKSPACE_LIST, undefined)
  })

  it('does not overwrite a fresher MANAGER_STATE_UPDATE broadcast that arrives first', async () => {
    const stale = makeHive({ id: 'stale', name: 'Stale Workspace' })
    const fresh = makeHive({ id: 'fresh', name: 'Fresh Workspace' })

    // Capture the listener so we can fire it manually before the invoke resolves
    let listener: ((payload: unknown) => void) | null = null
    api.on.mockImplementation((channel: string, handler: (payload: unknown) => void) => {
      if (channel === IPC.MANAGER_STATE_UPDATE) listener = handler
    })

    // Make the invoke resolve only when we explicitly trigger it
    let resolveInvoke: ((value: unknown) => void) | null = null
    api.invoke.mockImplementation((channel: string) => {
      if (channel === IPC.WORKSPACE_LIST) {
        return new Promise((resolve) => { resolveInvoke = resolve })
      }
      return Promise.resolve({})
    })

    const { result } = renderHook(() => useManagerState())

    // Broadcast arrives first with the FRESH workspace
    expect(listener).not.toBeNull()
    act(() => {
      listener!({ activeWorkspaces: [], dormantWorkspaces: [fresh], archivedWorkspaces: [] })
    })
    expect(result.current.dormantWorkspaces[0].id).toBe('fresh')

    // Now the stale invoke result resolves — must NOT overwrite the fresh state
    await act(async () => {
      resolveInvoke!({ activeWorkspaces: [], dormantWorkspaces: [stale], archivedWorkspaces: [] })
      await Promise.resolve()
    })
    expect(result.current.dormantWorkspaces).toHaveLength(1)
    expect(result.current.dormantWorkspaces[0].id).toBe('fresh')
  })
})
