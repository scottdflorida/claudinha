import { useCallback, useEffect, useReducer, useRef } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { ManagerStatePayload } from '../../shared/ipc-channels'
import type { RendererWorkspace } from '../../shared/types'
import { ipcSend, ipcInvoke, useIpcListener } from './useIpc'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ManagerState {
  activeWorkspaces: RendererWorkspace[]
  dormantWorkspaces: RendererWorkspace[]
  archivedWorkspaces: RendererWorkspace[]
  nextWorkspaceNumber: number
}

export type ManagerAction =
  | { type: 'SET_STATE'; payload: ManagerStatePayload }

export function managerReducer(state: ManagerState, action: ManagerAction): ManagerState {
  switch (action.type) {
    case 'SET_STATE':
      return {
        activeWorkspaces: action.payload.activeWorkspaces,
        dormantWorkspaces: action.payload.dormantWorkspaces,
        archivedWorkspaces: action.payload.archivedWorkspaces ?? [],
        nextWorkspaceNumber: action.payload.nextWorkspaceNumber ?? 1
      }
    default:
      return state
  }
}

const initialState: ManagerState = {
  activeWorkspaces: [],
  dormantWorkspaces: [],
  archivedWorkspaces: [],
  nextWorkspaceNumber: 1
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useManagerState — state management for the Claudinha Manager window.
 *
 * Listens for MANAGER_STATE_UPDATE IPC messages from the main process
 * and provides actions for workspace operations.
 *
 * Mount-time seed: the broadcast `MANAGER_STATE_UPDATE` that the main process
 * sends in response to `RENDERER_READY` is dispatched while `App` is still
 * showing its loading screen — `ManagerWindow` (and therefore this hook) has
 * not mounted yet, so the broadcast listener is not registered in time and
 * the message is silently dropped (L-006). To recover, this hook also pulls
 * the current state via `IPC.WORKSPACE_LIST` on mount and seeds the reducer from
 * the result. A `seededRef` guard prevents that seed from overwriting any
 * fresher state that may have arrived via the broadcast listener in between.
 */
export function useManagerState() {
  const [state, dispatch] = useReducer(managerReducer, initialState)
  const seededRef = useRef(false)

  // Listen for state updates from main process
  useIpcListener(IPC.MANAGER_STATE_UPDATE, (payload: unknown) => {
    seededRef.current = true
    dispatch({ type: 'SET_STATE', payload: payload as ManagerStatePayload })
  })

  // One-time mount seed via invoke — recovers from the dropped initial broadcast
  useEffect(() => {
    let cancelled = false
    ipcInvoke(IPC.WORKSPACE_LIST)
      .then((result) => {
        if (cancelled || seededRef.current) return
        seededRef.current = true
        dispatch({ type: 'SET_STATE', payload: result as ManagerStatePayload })
      })
      .catch((err) => {
        console.error('[manager] initial state seed failed:', err)
      })
    return () => { cancelled = true }
  }, [])

  const focusWorkspace = useCallback((workspaceId: string) => {
    ipcSend(IPC.MANAGER_FOCUS_WORKSPACE, { workspaceId })
  }, [])

  const focusTerminal = useCallback((workspaceId: string, paneId: string) => {
    ipcSend(IPC.MANAGER_FOCUS_TERMINAL, { workspaceId, paneId })
  }, [])

  const activateWorkspace = useCallback(async (workspaceId: string, terminalIds?: string[]) => {
    await ipcInvoke(IPC.WORKSPACE_ACTIVATE, { workspaceId, terminalIds })
  }, [])

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    await ipcInvoke(IPC.WORKSPACE_DELETE, { workspaceId })
  }, [])

  const archiveWorkspace = useCallback(async (workspaceId: string) => {
    await ipcInvoke(IPC.WORKSPACE_ARCHIVE, { workspaceId })
  }, [])

  const unarchiveWorkspace = useCallback(async (workspaceId: string) => {
    await ipcInvoke(IPC.WORKSPACE_UNARCHIVE, { workspaceId })
  }, [])

  const deleteArchivedWorkspace = useCallback(async (workspaceId: string) => {
    await ipcInvoke(IPC.WORKSPACE_DELETE_ARCHIVED, { workspaceId })
  }, [])

  const createWorkspace = useCallback(async (payload: { type: string; name?: string; constraint: Record<string, unknown> }) => {
    return await ipcInvoke(IPC.WORKSPACE_CREATE, payload)
  }, [])

  return {
    activeWorkspaces: state.activeWorkspaces,
    dormantWorkspaces: state.dormantWorkspaces,
    archivedWorkspaces: state.archivedWorkspaces,
    nextWorkspaceNumber: state.nextWorkspaceNumber,
    focusWorkspace,
    focusTerminal,
    activateWorkspace,
    deleteWorkspace,
    archiveWorkspace,
    unarchiveWorkspace,
    deleteArchivedWorkspace,
    createWorkspace
  }
}
