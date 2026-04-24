import { useReducer } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { WorkspacePausedUpdatePayload } from '../../shared/ipc-channels'
import type { TerminalSnapshot, WorkspaceType, WorkspaceConstraint } from '../../shared/types'
import { useIpcListener } from './useIpc'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface WorkspaceState {
  pausedTerminals: TerminalSnapshot[]
}

export type WorkspaceAction =
  | { type: 'SET_DORMANT'; payload: TerminalSnapshot[] }

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'SET_DORMANT':
      return { ...state, pausedTerminals: action.payload }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useWorkspaceState — lightweight state hook for workspace windows.
 *
 * Provides the dormant terminals list and listens for WORKSPACE_PAUSED_UPDATE
 * IPC messages to keep the list current.
 */
export function useWorkspaceState(workspaceId?: string) {
  const [state, dispatch] = useReducer(workspaceReducer, { pausedTerminals: [] })

  // Listen for dormant terminal updates from main process
  useIpcListener(IPC.WORKSPACE_PAUSED_UPDATE, (payload: unknown) => {
    const update = payload as WorkspacePausedUpdatePayload
    // Only accept updates for our workspace
    if (update.workspaceId === workspaceId) {
      dispatch({ type: 'SET_DORMANT', payload: update.pausedTerminals })
    }
  })

  return {
    pausedTerminals: state.pausedTerminals
  }
}
