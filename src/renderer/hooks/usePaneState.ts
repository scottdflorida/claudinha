import { createContext, useContext, useReducer, useEffect, useCallback, useRef, useState } from 'react'
import React from 'react'
import { IPC } from '../../shared/ipc-channels'
import type {
  PaneSpawnedPayload,
  PaneClosedPayload,
  PaneStatusPayload,
  PaneMetricsPayload,
  PaneMovedInPayload,
  PaneTerminatedPayload,
  PaneRespawnedPayload,
  PaneMetricsIpc,
  PaneGitStatusPayload,
  PanePermissionModePayload,
  CompletionStatusPayload,
  PaneResolvingConflictPayload,
  CompletionPolicyGlobalChangedPayload,
  CompletionPolicyWorkspaceChangedPayload,
  PaneListResult,
  PaneRehydrateEntry
} from '../../shared/ipc-channels'
import type { PaneStatus, EffortLevel, Model, GitStatus, CompletionActionStatus, CompletionPolicy } from '../../shared/types'
import { DEFAULT_COMPLETION_POLICY } from '../../shared/types'
import { ipcSend, ipcInvoke, useIpcListener } from './useIpc'
import { playStatusSound } from '../lib/sound'

// ---------------------------------------------------------------------------
// Renderer-side pane state (subset of main-process PaneState)
// ---------------------------------------------------------------------------

export interface RendererPane {
  id: string
  repoName: string
  worktreeName: string
  worktreePath: string
  isApiBilling: boolean
  effort: EffortLevel
  /** Claude model the pane is running. Updated live via /model slash command. */
  model: Model
  status: PaneStatus
  activeToolName: string | null
  statusSource: 'hook' | 'pty-fallback'
  metrics: PaneMetricsIpc
  /** True if the PTY has exited (pane:closed received but not yet removed) */
  terminated: boolean
  /**
   * True if status changed while this pane was not focused.
   * Used by PaneBorder to show a subtle attention indicator.
   * Cleared when the pane receives focus.
   */
  hasUnseenStatusChange: boolean
  /**
   * Serialized xterm.js buffer to restore when this pane was moved in from
   * another window (B-048). Consumed once by XTermView on mount, then null.
   */
  initialBuffer: string | null
  /** Git status of the worktree (polled periodically) */
  gitStatus: GitStatus | null
  /** True if pane was spawned as a worktree (new-worktree mode) */
  isWorktree: boolean
  /** Completion action status (merge/PR flow) — null when not applicable or dismissed */
  completionStatus: CompletionActionStatus | null
  /** True when Claude is resuming to resolve a merge conflict */
  isResolvingConflict: boolean
  /**
   * Optional user-supplied display name override. `null` = use the auto
   * fallback (sessionTitle → worktreeName). Updated optimistically by the
   * Kanban inline rename and persisted to the main process via
   * PANE_SET_USER_NAME so renderer reloads pick it up via PANE_LIST_GET.
   */
  userName: string | null
  /**
   * Claude Code permission mode (normal | plan) from the main-process PTY
   * detector. Drives the Kanban mode badge and is rendered only when it
   * differs from 'normal'.
   */
  permissionMode: 'normal' | 'plan'
}

// ---------------------------------------------------------------------------
// Store state and actions
// ---------------------------------------------------------------------------

export interface PaneStoreState {
  panes: RendererPane[]
  focusedPaneId: string | null
}

export type PaneAction =
  | { type: 'ADD_PANE'; payload: PaneSpawnedPayload }
  | { type: 'ADD_PANE_MOVED'; payload: PaneMovedInPayload }
  | { type: 'REMOVE_PANE'; payload: PaneClosedPayload }
  | { type: 'UPDATE_STATUS'; payload: PaneStatusPayload }
  | { type: 'UPDATE_METRICS'; payload: PaneMetricsPayload }
  | { type: 'SET_FOCUSED'; paneId: string | null }
  | { type: 'PANE_TERMINATED'; payload: PaneTerminatedPayload }
  | { type: 'PANE_RESPAWNED'; payload: PaneRespawnedPayload }
  | { type: 'UPDATE_EFFORT'; paneId: string; effort: EffortLevel }
  | { type: 'UPDATE_ALL_EFFORT'; effort: EffortLevel }
  | { type: 'UPDATE_MODEL'; paneId: string; model: Model }
  | { type: 'UPDATE_GIT_STATUS'; payload: PaneGitStatusPayload }
  | { type: 'UPDATE_COMPLETION_STATUS'; payload: CompletionStatusPayload }
  | { type: 'UPDATE_RESOLVING_CONFLICT'; payload: PaneResolvingConflictPayload }
  | { type: 'UPDATE_USER_NAME'; paneId: string; userName: string | null }
  | { type: 'UPDATE_PERMISSION_MODE'; payload: PanePermissionModePayload }
  /**
   * Seed from the main-process registry. Used once on provider mount to
   * recover pane state after a renderer reload / Fast-Refresh remount, when
   * the original one-shot PANE_SPAWNED broadcasts are no longer replayed.
   * Merges into existing state by id so a PANE_SPAWNED that arrives during
   * the invoke round-trip isn't stomped.
   */
  | { type: 'SEED_PANES'; payload: PaneRehydrateEntry[] }

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

export function paneReducer(state: PaneStoreState, action: PaneAction): PaneStoreState {
  switch (action.type) {
    case 'ADD_PANE': {
      const { paneId, repoName, worktreeName, worktreePath, isApiBilling, effort, model, isWorktree } =
        action.payload as PaneSpawnedPayload
      // Avoid duplicates (e.g. if pane:spawned fires twice)
      if (state.panes.some((p) => p.id === paneId)) return state
      const newPane: RendererPane = {
        id: paneId,
        repoName,
        worktreeName,
        worktreePath,
        isApiBilling,
        effort: effort ?? 'high',
        model: model ?? 'opus',
        status: 'awaiting-prompt',
        activeToolName: null,
        statusSource: 'pty-fallback',
        metrics: emptyMetrics,
        terminated: false,
        hasUnseenStatusChange: false,
        initialBuffer: null,
        gitStatus: null,
        isWorktree: isWorktree ?? false,
        completionStatus: null,
        isResolvingConflict: false,
        userName: null,
        permissionMode: 'normal'
      }
      return {
        ...state,
        panes: [...state.panes, newPane],
        // Always focus the newly spawned pane
        focusedPaneId: paneId
      }
    }

    case 'ADD_PANE_MOVED': {
      const {
        paneId, repoName, worktreeName, worktreePath, isApiBilling, effort, model,
        status, activeToolName, metrics, serializedBuffer
      } = action.payload as PaneMovedInPayload
      if (state.panes.some((p) => p.id === paneId)) return state
      const movedPane: RendererPane = {
        id: paneId,
        repoName,
        worktreeName,
        worktreePath,
        isApiBilling,
        effort: effort ?? 'high',
        model: model ?? 'opus',
        status,
        activeToolName,
        statusSource: 'hook',
        metrics,
        terminated: false,
        hasUnseenStatusChange: false,
        initialBuffer: serializedBuffer ?? null,
        gitStatus: null,
        isWorktree: false,
        completionStatus: null,
        isResolvingConflict: false,
        userName: null,
        permissionMode: 'normal'
      }
      return {
        ...state,
        panes: [...state.panes, movedPane],
        focusedPaneId: state.focusedPaneId ?? paneId
      }
    }

    case 'REMOVE_PANE': {
      const { paneId } = action.payload
      const remaining = state.panes.filter((p) => p.id !== paneId)
      let focusedPaneId = state.focusedPaneId
      if (focusedPaneId === paneId) {
        // Focus the last remaining pane, or null if none
        focusedPaneId = remaining.length > 0 ? remaining[remaining.length - 1].id : null
      }
      return { panes: remaining, focusedPaneId }
    }

    case 'UPDATE_STATUS': {
      const { paneId, status, activeToolName, source } = action.payload
      return {
        ...state,
        panes: state.panes.map((p) => {
          if (p.id !== paneId) return p
          const statusChanged = p.status !== status
          const toolChanged = p.activeToolName !== activeToolName
          // Track unseen status change for unfocused panes
          const hasUnseenStatusChange =
            (statusChanged || toolChanged) && state.focusedPaneId !== paneId
              ? true
              : p.hasUnseenStatusChange
          // Clear stale completion status on any status transition so the
          // completion bar always starts fresh when a pane re-enters 'done'.
          const completionStatus = statusChanged ? null : p.completionStatus
          return { ...p, status, activeToolName, statusSource: source, hasUnseenStatusChange, completionStatus }
        })
      }
    }

    case 'UPDATE_METRICS': {
      const { paneId, metrics } = action.payload
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === paneId ? { ...p, metrics } : p
        )
      }
    }

    case 'UPDATE_EFFORT': {
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === action.paneId ? { ...p, effort: action.effort } : p
        )
      }
    }

    case 'UPDATE_ALL_EFFORT': {
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.terminated ? p : { ...p, effort: action.effort }
        )
      }
    }

    case 'UPDATE_MODEL': {
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === action.paneId ? { ...p, model: action.model } : p
        )
      }
    }

    case 'SET_FOCUSED': {
      // Clear hasUnseenStatusChange on the pane receiving focus
      const panes = action.paneId
        ? state.panes.map((p) =>
            p.id === action.paneId ? { ...p, hasUnseenStatusChange: false } : p
          )
        : state.panes
      return { ...state, focusedPaneId: action.paneId, panes }
    }

    case 'PANE_TERMINATED': {
      const { paneId } = action.payload
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === paneId ? { ...p, terminated: true } : p
        )
      }
    }

    case 'PANE_RESPAWNED': {
      const { paneId } = action.payload
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === paneId
            ? { ...p, terminated: false, status: 'awaiting-prompt', activeToolName: null, metrics: emptyMetrics }
            : p
        )
      }
    }

    case 'UPDATE_GIT_STATUS': {
      const { paneId, gitStatus } = action.payload
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === paneId ? { ...p, gitStatus } : p
        )
      }
    }

    case 'UPDATE_COMPLETION_STATUS': {
      const { paneId, status } = action.payload
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === paneId ? { ...p, completionStatus: status } : p
        )
      }
    }

    case 'UPDATE_RESOLVING_CONFLICT': {
      const { paneId, isResolvingConflict } = action.payload
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === paneId ? { ...p, isResolvingConflict } : p
        )
      }
    }

    case 'UPDATE_USER_NAME': {
      const { paneId, userName } = action
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === paneId ? { ...p, userName } : p
        )
      }
    }

    case 'UPDATE_PERMISSION_MODE': {
      const { paneId, permissionMode } = action.payload
      return {
        ...state,
        panes: state.panes.map((p) =>
          p.id === paneId ? { ...p, permissionMode } : p
        )
      }
    }

    case 'SEED_PANES': {
      const entries = action.payload
      // Merge the main-side snapshot with anything already in state. Broadcasts
      // that arrived before the seed (ADD_PANE, UPDATE_STATUS, …) win — they
      // are fresher than the snapshot that the invoke returned.
      const knownIds = new Set(state.panes.map((p) => p.id))
      const seeded: RendererPane[] = entries
        .filter((e) => !knownIds.has(e.paneId))
        .map((e) => ({
          id: e.paneId,
          repoName: e.repoName,
          worktreeName: e.worktreeName,
          worktreePath: e.worktreePath,
          isApiBilling: e.isApiBilling,
          effort: e.effort,
          model: e.model,
          status: e.status,
          activeToolName: e.activeToolName,
          statusSource: e.statusSource,
          metrics: e.metrics,
          terminated: e.terminated,
          hasUnseenStatusChange: false,
          initialBuffer: null,
          gitStatus: e.gitStatus,
          isWorktree: e.isWorktree,
          completionStatus: e.completionStatus,
          isResolvingConflict: e.isResolvingConflict,
          userName: e.userName ?? null,
          permissionMode: e.permissionMode ?? 'normal'
        }))
      if (seeded.length === 0) return state
      const panes = [...state.panes, ...seeded]
      // Focus the last seeded pane only if nothing is focused yet. A live
      // focus (from a PANE_SPAWNED broadcast that beat the seed) sticks.
      const focusedPaneId = state.focusedPaneId ?? panes[panes.length - 1].id
      return { panes, focusedPaneId }
    }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PaneStoreContext {
  panes: RendererPane[]
  focusedPaneId: string | null
  globalEffort: EffortLevel
  setFocusedPane: (paneId: string | null) => void
  setEffort: (paneId: string, effort: EffortLevel) => void
  setGlobalEffort: (effort: EffortLevel) => void
  /** Switch a pane's Claude model live (sends /model slash command to PTY). */
  setModel: (paneId: string, model: Model) => void
  /**
   * Set or clear a pane's user-supplied display name override (Kanban inline
   * rename). Pass `null` (or an empty string after trim) to clear.
   */
  setUserName: (paneId: string, userName: string | null) => void
  /** App-wide default completion policy (mirrors main-process state). */
  globalCompletionPolicy: CompletionPolicy
  /** Workspace-scoped override for the window's workspace (null = inherit global). */
  workspaceCompletionPolicy: CompletionPolicy | null
  /** Effective completion policy for this window (workspace override ?? global). */
  effectiveCompletionPolicy: CompletionPolicy
  /** The workspaceId this window belongs to (set from WINDOW_INIT for workspace windows). */
  windowHiveId: string | null
}

const PaneContext = createContext<PaneStoreContext | null>(null)

// ---------------------------------------------------------------------------
// Provider — subscribes to IPC events and updates state
// ---------------------------------------------------------------------------

interface PaneStateProviderProps {
  children: React.ReactNode
  /**
   * Fields from the WINDOW_INIT payload that seed pane-state context.
   * Passed as props (not re-fetched from IPC) because the payload is
   * consumed by App before this provider mounts (L-014): the second
   * RENDERER_READY has nothing to deliver, so a WINDOW_INIT listener
   * here would never fire.
   */
  initialHiveId?: string | null
  initialGlobalPolicy?: CompletionPolicy
  initialHivePolicy?: CompletionPolicy | null
}

export function PaneStateProvider({
  children,
  initialHiveId = null,
  initialGlobalPolicy = DEFAULT_COMPLETION_POLICY,
  initialHivePolicy = null
}: PaneStateProviderProps): React.JSX.Element {
  const [state, dispatch] = useReducer(paneReducer, {
    panes: [],
    focusedPaneId: null
  })

  // Global effort level — initialized from ~/.claude/settings.json on mount
  const [globalEffort, setGlobalEffortState] = useState<EffortLevel>('high')

  // Completion policy + workspace id — seeded from App's WINDOW_INIT payload via
  // props (not via an IPC listener; see PaneStateProviderProps). Kept fresh
  // via COMPLETION_POLICY_*_CHANGED broadcasts below.
  const [globalCompletionPolicy, setGlobalCompletionPolicyState] = useState<CompletionPolicy>(initialGlobalPolicy)
  const [workspaceCompletionPolicy, setHiveCompletionPolicyState] = useState<CompletionPolicy | null>(initialHivePolicy)
  const [windowHiveId] = useState<string | null>(initialHiveId)

  // Read the actual effort level from settings on mount
  const effortLoaded = useRef(false)
  useEffect(() => {
    if (!effortLoaded.current) {
      effortLoaded.current = true
      ipcInvoke(IPC.GLOBAL_EFFORT_GET)
        .then((level) => {
          const l = level as EffortLevel
          if (l === 'low' || l === 'medium' || l === 'high' || l === 'xhigh' || l === 'max') {
            setGlobalEffortState(l)
          }
        })
        .catch(() => {/* non-fatal */})
    }
  }, [])

  // Ref to current panes for stable setGlobalEffort callback
  const panesRef = useRef(state.panes)
  panesRef.current = state.panes

  useIpcListener(IPC.PANE_SPAWNED, (payload) => {
    dispatch({ type: 'ADD_PANE', payload: payload as PaneSpawnedPayload })
  })

  useIpcListener(IPC.PANE_CLOSED, (payload) => {
    dispatch({ type: 'REMOVE_PANE', payload: payload as PaneClosedPayload })
  })

  useIpcListener(IPC.PANE_STATUS, (payload) => {
    const p = payload as PaneStatusPayload
    // Play sound on genuine status transitions — only for unfocused panes
    const prev = panesRef.current.find((pane) => pane.id === p.paneId)
    if (prev && prev.status !== p.status && state.focusedPaneId !== p.paneId) {
      playStatusSound(p.status)
    }
    dispatch({ type: 'UPDATE_STATUS', payload: p })
  })

  useIpcListener(IPC.PANE_METRICS, (payload) => {
    dispatch({ type: 'UPDATE_METRICS', payload: payload as PaneMetricsPayload })
  })

  useIpcListener(IPC.PANE_MOVED_IN, (payload) => {
    dispatch({ type: 'ADD_PANE_MOVED', payload: payload as PaneMovedInPayload })
  })

  useIpcListener(IPC.PANE_TERMINATED, (payload) => {
    dispatch({ type: 'PANE_TERMINATED', payload: payload as PaneTerminatedPayload })
  })

  useIpcListener(IPC.PANE_RESPAWNED, (payload) => {
    dispatch({ type: 'PANE_RESPAWNED', payload: payload as PaneRespawnedPayload })
  })

  useIpcListener(IPC.PANE_GIT_STATUS, (payload) => {
    dispatch({ type: 'UPDATE_GIT_STATUS', payload: payload as PaneGitStatusPayload })
  })

  useIpcListener(IPC.PANE_PERMISSION_MODE, (payload) => {
    dispatch({ type: 'UPDATE_PERMISSION_MODE', payload: payload as PanePermissionModePayload })
  })

  useIpcListener(IPC.COMPLETION_STATUS, (payload) => {
    dispatch({ type: 'UPDATE_COMPLETION_STATUS', payload: payload as CompletionStatusPayload })
  })

  useIpcListener(IPC.PANE_RESOLVING_CONFLICT, (payload) => {
    dispatch({ type: 'UPDATE_RESOLVING_CONFLICT', payload: payload as PaneResolvingConflictPayload })
  })

  // Per L-014: a WINDOW_INIT listener here would never fire — the payload is
  // consumed by App before this provider mounts, and the main process does
  // not re-send on the second RENDERER_READY. Seed state from props instead
  // (see PaneStateProviderProps).

  useIpcListener(IPC.COMPLETION_POLICY_GLOBAL_CHANGED, (payload) => {
    const p = payload as CompletionPolicyGlobalChangedPayload
    setGlobalCompletionPolicyState(p.policy)
  })

  useIpcListener(IPC.COMPLETION_POLICY_WORKSPACE_CHANGED, (payload) => {
    const p = payload as CompletionPolicyWorkspaceChangedPayload
    // This window only cares about its own workspace. The main process already
    // scopes the broadcast to the relevant workspace's window, so we accept the
    // update unconditionally.
    setHiveCompletionPolicyState(p.policy)
  })

  // Mount-time seed of the pane list from the main-process registry.
  // Recovers pane state after a renderer reload / Fast-Refresh remount: the
  // one-shot PANE_SPAWNED broadcasts that fired on original spawn are gone,
  // so the window would show its empty-state even though PTYs are still
  // live. Pattern mirrors useManagerState's WORKSPACE_LIST seed (L-014).
  // `seededRef` prevents the seed from stomping a fresher broadcast that
  // may land during the round-trip; the reducer's SEED_PANES case also
  // dedupes by id for the same reason.
  const seededRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    ipcInvoke(IPC.PANE_LIST_GET)
      .then((result) => {
        if (cancelled || seededRef.current) return
        seededRef.current = true
        const payload = result as PaneListResult
        if (payload.panes.length > 0) {
          dispatch({ type: 'SEED_PANES', payload: payload.panes })
        }
      })
      .catch((err) => {
        console.warn('[usePaneState] pane-list seed failed', err)
      })
    return () => { cancelled = true }
  }, [])

  // Signal to the main process that all IPC listeners are registered.
  // Placed AFTER all useIpcListener calls — useEffect hooks run in declaration
  // order, so by the time this fires every listener above is active.
  const readySent = useRef(false)
  useEffect(() => {
    if (!readySent.current) {
      readySent.current = true
      ipcSend(IPC.RENDERER_READY)
    }
  }, [])

  const setFocusedPane = useCallback((paneId: string | null) => {
    dispatch({ type: 'SET_FOCUSED', paneId })
  }, [])

  // Per-pane effort (retained for future per-session support).
  // Also syncs globalEffort since CLI propagates effort changes globally.
  const setEffort = useCallback((paneId: string, effort: EffortLevel) => {
    dispatch({ type: 'UPDATE_EFFORT', paneId, effort })
    ipcSend(IPC.PANE_INPUT, { paneId, data: `/effort ${effort}\r` })
    ipcSend(IPC.PANE_EFFORT, { paneId, effort })
    // Sync global — CLI will propagate this to all sessions anyway
    setGlobalEffortState(effort)
  }, [])

  // Per-pane model switch. Mirrors setEffort: optimistic local update,
  // `/model <name>` slash command to the live PTY for an in-session switch,
  // and PANE_MODEL to the registry so the choice survives a respawn.
  const setModel = useCallback((paneId: string, model: Model) => {
    dispatch({ type: 'UPDATE_MODEL', paneId, model })
    ipcSend(IPC.PANE_INPUT, { paneId, data: `/model ${model}\r` })
    ipcSend(IPC.PANE_MODEL, { paneId, model })
  }, [])

  // Per-pane user-name override (Kanban inline rename). Trim+empty maps to
  // null so an empty submission clears the override.
  const setUserName = useCallback((paneId: string, userName: string | null) => {
    const next = userName?.trim() ? userName.trim().slice(0, 80) : null
    dispatch({ type: 'UPDATE_USER_NAME', paneId, userName: next })
    ipcSend(IPC.PANE_SET_USER_NAME, { paneId, userName: next })
  }, [])

  // Global effort — updates all panes and writes ~/.claude/settings.json
  const setGlobalEffort = useCallback((effort: EffortLevel) => {
    setGlobalEffortState(effort)
    dispatch({ type: 'UPDATE_ALL_EFFORT', effort })
    for (const pane of panesRef.current) {
      if (!pane.terminated) {
        ipcSend(IPC.PANE_INPUT, { paneId: pane.id, data: `/effort ${effort}\r` })
        ipcSend(IPC.PANE_EFFORT, { paneId: pane.id, effort })
      }
    }
    ipcSend(IPC.GLOBAL_EFFORT, { effort })
  }, [])

  const effectiveCompletionPolicy = workspaceCompletionPolicy ?? globalCompletionPolicy

  return React.createElement(
    PaneContext.Provider,
    {
      value: {
        panes: state.panes,
        focusedPaneId: state.focusedPaneId,
        globalEffort,
        setFocusedPane,
        setEffort,
        setGlobalEffort,
        setModel,
        setUserName,
        globalCompletionPolicy,
        workspaceCompletionPolicy,
        effectiveCompletionPolicy,
        windowHiveId
      }
    },
    children
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * usePaneState — access renderer pane state and actions.
 * Must be called inside <PaneStateProvider>.
 */
export function usePaneState(): PaneStoreContext {
  const ctx = useContext(PaneContext)
  if (!ctx) {
    throw new Error('usePaneState must be used inside <PaneStateProvider>')
  }
  return ctx
}
