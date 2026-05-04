import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type {
  RateLimitsPayload,
  WorkspaceSetViewModePayload,
  WorkspaceSetActivePanePayload,
  WorkspaceFocusPanePayload,
  WorkspaceInitialSpawnBeginPayload,
  WorkspaceInitialSpawnCompletePayload
} from '../../shared/ipc-channels'
import { SegmentedControl } from './ui/SegmentedControl'
import { ipcInvoke, ipcSend, useIpcListener } from '../hooks/useIpc'
import { usePaneState } from '../hooks/usePaneState'
import { useKanbanActiveTransition } from '../hooks/useKanbanActiveTransition'
import { PaneGrid } from './PaneGrid'
import { KanbanBoard } from './KanbanBoard'
import { KanbanRepoRail } from './KanbanRepoRail'
import { KanbanResizeHandle } from './KanbanResizeHandle'
import { EmptyState } from './EmptyState'
import { AddTerminalsDialog } from './AddTerminalsDialog'
import { PaneCloseConfirmModal } from './PaneCloseConfirmModal'
import { WorkspaceCloseOverlay } from './WorkspaceCloseOverlay'
import { WorkspaceSpawnOverlay } from './WorkspaceSpawnOverlay'
import { AnalyticsConsentDialog } from './AnalyticsConsentDialog'
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal'
import { RateLimitBar } from './RateLimitBar'
import type { ConsentState } from '../../shared/types'
import { PausedTerminalsPanel } from './PausedTerminalsPanel'
import { useWorkspaceState } from '../hooks/useWorkspaceState'
import { useAppConfig } from '../hooks/useAppConfig'
import { useInspector } from '../hooks/useInspector'
import { InspectorDrawer } from './InspectorDrawer'
import { LanguageFlagToggle } from './LanguageFlagToggle'
import { useStrings } from '../lib/strings'
import { openFeedbackUrl } from '../lib/open-feedback'
import type { EffortLevel, WorkspaceType, WorkspaceConstraint, TerminalSnapshot, PaneCloseAction } from '../../shared/types'
import {
  KANBAN_MIN_HEIGHT_PX,
  KANBAN_DEFAULT_HEIGHT_PX,
  TERMINAL_RESERVED_PX
} from '../../shared/types'
import type { PaneCloseWorktreeResult, PaneMergeAndCloseResult, CloseSequencePaneDescriptor } from '../../shared/ipc-channels'
import type { PaneCloseDescriptor } from '../lib/pane-close-options'
import { buildPaneCloseOptions } from '../lib/pane-close-options'
import { useWorkspaceCloseSequence } from '../hooks/useWorkspaceCloseSequence'
import { stripAnsi } from '../../shared/strip-ansi'

// Inspector drawer is hidden from the UI. Service, IPC, hook, and tests stay
// intact; KanbanRepoRail still subscribes to INSPECTOR_SUMMARY via useInspector.
// Flip to false to restore the drawer (also re-add a toggle affordance).
const INSPECTOR_HIDDEN = true

interface WindowShellProps {
  workspaceId?: string
  workspaceName?: string
  workspaceType?: WorkspaceType
  workspaceConstraint?: WorkspaceConstraint
  /** Panes to auto-resume when this workspace window opens (from workspace reactivation) */
  terminalsToResume?: TerminalSnapshot[]
  /** Persisted top-level view mode (Wall vs Kanban). Defaults to 'wall'. */
  initialViewMode?: 'wall' | 'kanban'
  /** Persisted Kanban-mode active pane selection (null = no selection yet). */
  initialActivePaneId?: string | null
}

/**
 * WindowShell — top-level layout container for one Workspace BrowserWindow.
 *
 * - Shows EmptyState when no panes exist (initial launch or after all closed).
 * - Shows PaneGrid + spawn button once panes exist.
 * - Closes the window when the last pane is removed (PRD F2).
 *   Confirmation for active sessions is deferred to B-051.
 */
export function WindowShell({ workspaceId, workspaceName, workspaceType, workspaceConstraint, terminalsToResume, initialViewMode, initialActivePaneId }: WindowShellProps): React.JSX.Element {
  const { panes, focusedPaneId, globalEffort, setFocusedPane, setGlobalEffort } = usePaneState()
  const { pausedTerminals } = useWorkspaceState(workspaceId)
  const { config: appConfig, setConfig: setAppConfig } = useAppConfig()
  const { summary: inspectorSummary } = useInspector(workspaceId ?? null)
  const paneIds = panes.map((p) => p.id)

  // Repo of the most recently spawned pane in this workspace. The
  // AddTerminalsDialog uses it as the first-choice default for the repo path
  // when the user clicks "+ Terminal(s)" from within a running workspace.
  // RendererPane arrives in append order (ADD_PANE → [...panes, newPane]),
  // so the last entry is the newest; we look up its repoPath via the
  // inspector summary.
  const lastSpawnedRepoPath = useMemo<string | undefined>(() => {
    if (panes.length === 0 || !inspectorSummary) return undefined
    const newest = panes[panes.length - 1]
    const row = inspectorSummary.panes.find((r) => r.paneId === newest.id)
    return row?.repoPath || undefined
  }, [panes, inspectorSummary])
  const [isSpawnDialogOpen, setIsSpawnDialogOpen] = useState(false)
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false)
  const [analyticsMode, setAnalyticsMode] = useState<'consent' | 'settings' | null>(null)
  const [consentState, setConsentState] = useState<ConsentState>('pending')
  const [rateLimits, setRateLimits] = useState<RateLimitsPayload | null>(null)
  const [pendingClosePane, setPendingClosePane] = useState<{
    paneId: string
    repoName: string
    agentName: string
    descriptor: PaneCloseDescriptor
  } | null>(null)
  const [closeInFlight, setCloseInFlight] = useState(false)
  const [mergeCloseError, setMergeCloseError] = useState<string | null>(null)
  // workspace name is editable in-place. Seed from the WINDOW_INIT prop; subsequent
  // edits update optimistically and the main process persists + re-titles the
  // BrowserWindow via the WORKSPACE_RENAME handler.
  const [displayName, setDisplayName] = useState<string>(workspaceName ?? '')
  const [isEditingName, setIsEditingName] = useState(false)
  const [draftName, setDraftName] = useState<string>('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  // Top-level view mode (Wall vs Kanban). Seeded from WINDOW_INIT (L-014 — the
  // workspace-window IPC payload arrives once on mount, so any later listener
  // would miss it). Optimistic local update + persist via WORKSPACE_SET_VIEW_MODE.
  const t = useStrings()
  const [viewMode, setViewMode] = useState<'wall' | 'kanban'>(initialViewMode ?? 'kanban')
  const handleViewModeChange = useCallback((next: 'wall' | 'kanban') => {
    if (next === viewMode) return
    setViewMode(next)
    if (!workspaceId) return
    const payload: WorkspaceSetViewModePayload = { workspaceId, viewMode: next }
    ipcInvoke(IPC.WORKSPACE_SET_VIEW_MODE, payload)
      .catch((err) => console.warn('[WindowShell] set view mode failed', err))
  }, [viewMode, workspaceId])

  // ---------- Kanban board height (draggable) ----------
  //
  // The board's persisted height lives in AppConfig.kanban.heightPx. During a
  // drag we track the candidate height locally (`kanbanDragHeight`) so the
  // layout animates at native cadence without round-tripping every move
  // through the main-process store. On mouseup the resize handle calls
  // onCommit, which writes the final value back to AppConfig.
  //
  // `kanbanContainerHeight` is the clientHeight of the flex-col that owns the
  // board + terminal column; it's measured via ResizeObserver and used to
  // derive `kanbanMaxHeight = container - 6 terminal rows`. When the window
  // shrinks, the render-time clamp pushes the visible height down without
  // touching the persisted value.
  const persistedKanbanHeight = appConfig.kanban?.heightPx ?? KANBAN_DEFAULT_HEIGHT_PX
  const [kanbanDragHeight, setKanbanDragHeight] = useState<number | null>(null)
  const kanbanColumnRef = useRef<HTMLDivElement | null>(null)
  const [kanbanContainerHeight, setKanbanContainerHeight] = useState<number>(0)
  // The kanban-column ref div is gated behind `panes.length > 0`, so include
  // its mount/unmount transition in the deps. Without this, the effect runs
  // once with a null ref on first mount of an empty workspace, never reattaches
  // when the first pane spawns, and kanbanContainerHeight stays at 0 — which
  // collapses kanbanMaxHeight onto the persisted value and silently clamps the
  // drag-down direction, freezing the resize handle.
  const kanbanColumnMounted = panes.length > 0
  useEffect(() => {
    const el = kanbanColumnRef.current
    if (!el) return
    setKanbanContainerHeight(el.clientHeight)
    const ro = new ResizeObserver(() => {
      setKanbanContainerHeight(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [viewMode, kanbanColumnMounted])
  const kanbanMaxHeight = Math.max(
    kanbanContainerHeight > 0 ? kanbanContainerHeight - TERMINAL_RESERVED_PX : persistedKanbanHeight,
    KANBAN_MIN_HEIGHT_PX
  )
  const kanbanVisibleHeight = Math.min(
    kanbanDragHeight ?? persistedKanbanHeight,
    kanbanMaxHeight
  )
  const onKanbanResizeCommit = useCallback(
    (nextPx: number) => {
      // Hold the drag height until the persisted value catches up via the
      // setAppConfig IPC roundtrip. If we cleared kanbanDragHeight first,
      // kanbanVisibleHeight would briefly fall back to the stale
      // persistedKanbanHeight — flashing the terminal back to its pre-drag
      // position for a frame before the new config propagates.
      setAppConfig({ kanban: { heightPx: nextPx } }).finally(() => {
        setKanbanDragHeight(null)
      })
    },
    [setAppConfig]
  )

  // Kanban single-active-pane selection. Optimistic local state mirrored to
  // workspace.activePaneId via WORKSPACE_SET_ACTIVE_PANE. Auto-selects the
  // first pane when none is currently selected and panes exist (so Kanban
  // never opens with the bottom region pointing at a stale id).
  const [activePaneId, setActivePaneId] = useState<string | null>(initialActivePaneId ?? null)
  useEffect(() => {
    if (activePaneId && panes.some((p) => p.id === activePaneId)) return
    if (panes.length === 0) {
      if (activePaneId !== null) setActivePaneId(null)
      return
    }
    setActivePaneId(panes[0].id)
  }, [panes, activePaneId])

  // Drives Animation A: when activePaneId changes, the new pane slides up
  // over the previously-active one. This is purely visual — focus + IPC fire
  // immediately in selectActivePane below, so keystrokes route to the new
  // pane the moment the user clicks (the slide is decoration on top).
  // Always called with the canonical activePaneId so the hook's internal
  // baseLayer stays synced even across wall <-> kanban toggles; the
  // transition state is only consumed by PaneGrid in kanban-stack mode.
  const kanbanTransition = useKanbanActiveTransition(activePaneId)

  const selectActivePane = useCallback((paneId: string) => {
    // Drive keyboard focus along with active-pane selection so the terminal
    // shown in the Kanban bottom region actually receives keystrokes. Without
    // this, the pane swaps visually but focus stays on the previously-focused
    // pane (or nowhere). XTermView's focused-prop effect calls term.focus()
    // on the transition.
    setFocusedPane(paneId)
    if (paneId === activePaneId) return
    setActivePaneId(paneId)
    if (!workspaceId) return
    const payload: WorkspaceSetActivePanePayload = { workspaceId, paneId }
    ipcInvoke(IPC.WORKSPACE_SET_ACTIVE_PANE, payload)
      .catch((err) => console.warn('[WindowShell] set active pane failed', err))
  }, [activePaneId, workspaceId, setFocusedPane])

  // Bring a newly-spawned terminal into focus in both view modes. The reducer
  // already flips focusedPaneId to the new pane (L-001), but Kanban's
  // activePaneId is separate state — without this, Kanban adds the pane to
  // the rail but keeps the bottom region on the previously-active terminal.
  // selectActivePane early-returns when paneId already matches activePaneId,
  // so this is a no-op when spawning the first pane (the auto-select effect
  // has already set activePaneId to it).
  useIpcListener(IPC.PANE_SPAWNED, (payload) => {
    const { paneId } = payload as { paneId: string }
    selectActivePane(paneId)
  })

  // Management window asked us to switch to a specific terminal. Drives the
  // same selectActivePane path the kanban click uses, so the active card and
  // keyboard focus both follow.
  useIpcListener(IPC.WORKSPACE_FOCUS_PANE, (payload) => {
    const { paneId } = payload as WorkspaceFocusPanePayload
    selectActivePane(paneId)
  })

  // ---------- Initial-spawn overlay (WORKSPACE_CREATE_WITH_TERMINALS) ----------
  //
  // Main brackets the batch-spawn loop with BEGIN/COMPLETE so the renderer
  // can cover the workspace window with a calm "Claudinha is launching your
  // agent team…" overlay instead of letting the user watch terminals trickle
  // in over a half-built Kanban + a "Loading repo data…" rail.
  //
  // Dismissal is gated on four conditions so the overlay never lifts onto a
  // still-half-built UI:
  //   1. main has signalled COMPLETE,
  //   2. every PANE_SPAWNED has been reduced into local panes state,
  //   3. the inspector summary is non-null (the rail is no longer pending),
  //   4. the active pane (the last-spawned terminal) has finished Claude
  //      Code's startup — detected by stripping ANSI from accumulated
  //      PANE_DATA and looking for the `❯` prompt arrow anywhere in the
  //      visible text. Trying to match the brand string fails because
  //      Claude Code emits "Claude Code" in an OSC title-set sequence
  //      (`ESC ] 0 ; Claude Code BEL`) seconds before the visible banner
  //      draws. The prompt arrow only appears once Claude is ready for
  //      input — and we deliberately don't anchor it to end-of-string
  //      because Claude Code emits cursor-positioning / refresh chatter
  //      after the prompt is drawn, which would push the arrow away from
  //      the trailing edge and we'd never match.
  // A 25s safety timeout — measured from BEGIN, so a long spawn loop with
  // many terminals doesn't eat the budget — dismisses anyway so a stuck
  // Claude Code startup can't strand the user behind the overlay.
  const CLAUDE_PROMPT_MARKER = /❯/
  const [initialSpawn, setInitialSpawn] = useState<{
    expectedCount: number
    completed: boolean
  } | null>(null)
  // Pane id we're waiting on, plus a rolling accumulator of recent PTY data.
  // Both refs so the high-frequency PANE_DATA listener doesn't re-render
  // WindowShell on every chunk — only the one-shot `setActivePaneReady(true)`
  // does.
  const awaitingActivePaneRef = useRef<string | null>(null)
  const activePaneDataAccumRef = useRef<string>('')
  const initialSpawnDeadlineRef = useRef<number>(0)
  const [activePaneReady, setActivePaneReady] = useState(false)

  useIpcListener(IPC.WORKSPACE_INITIAL_SPAWN_BEGIN, (payload) => {
    const { expectedCount } = payload as WorkspaceInitialSpawnBeginPayload
    awaitingActivePaneRef.current = null
    activePaneDataAccumRef.current = ''
    initialSpawnDeadlineRef.current = Date.now() + 25000
    setActivePaneReady(false)
    setInitialSpawn({ expectedCount, completed: false })
  })

  useIpcListener(IPC.WORKSPACE_INITIAL_SPAWN_COMPLETE, (payload) => {
    const { activePaneId: lastPaneId } = payload as WorkspaceInitialSpawnCompletePayload
    // Belt-and-suspenders for the active-pane selection: assert the last
    // spawned pane as active explicitly even though the per-PANE_SPAWNED
    // listener above already calls selectActivePane on each event. This
    // eliminates any ordering / stale-closure race that could leave
    // activePaneId pointed at an earlier pane.
    if (lastPaneId) {
      selectActivePane(lastPaneId)
      awaitingActivePaneRef.current = lastPaneId
      activePaneDataAccumRef.current = ''
    } else {
      // Every spawn failed — nothing to wait for; let the dismissal effect
      // through.
      setActivePaneReady(true)
    }
    setInitialSpawn((prev) => (prev ? { ...prev, completed: true } : prev))
  })

  // Listen for PANE_DATA so we know when Claude Code is fully booted in the
  // active terminal. The accumulator holds the last ~8 KB of PTY bytes;
  // stripAnsi gets us "what the user sees", and we look for `❯` anywhere
  // in that text. The listener short-circuits cheaply when no spawn is in
  // flight, so overhead during normal operation is negligible.
  useIpcListener(IPC.PANE_DATA, (payload) => {
    const awaiting = awaitingActivePaneRef.current
    if (!awaiting) return
    const { paneId, data } = payload as { paneId: string; data: string }
    if (paneId !== awaiting) return
    activePaneDataAccumRef.current = (activePaneDataAccumRef.current + data).slice(-8192)
    const visible = stripAnsi(activePaneDataAccumRef.current)
    if (CLAUDE_PROMPT_MARKER.test(visible)) {
      awaitingActivePaneRef.current = null
      activePaneDataAccumRef.current = ''
      setActivePaneReady(true)
    }
  })

  // Overlay dismissal effect: clears initialSpawn once the loop is done AND
  // panes are reduced into state AND the inspector summary has populated AND
  // Claude Code's prompt has rendered in the active pane.
  useEffect(() => {
    if (!initialSpawn) return
    if (initialSpawn.completed) {
      const ready =
        panes.length >= initialSpawn.expectedCount
        && inspectorSummary !== null
        && activePaneReady
      if (ready) {
        setInitialSpawn(null)
        return
      }
    }
    // Safety net measured from BEGIN — large spawn loops can chew >10s on
    // their own, so timing the timeout from COMPLETE leaves Claude Code
    // too little budget to actually boot.
    const remaining = Math.max(0, initialSpawnDeadlineRef.current - Date.now())
    const t = setTimeout(() => {
      awaitingActivePaneRef.current = null
      activePaneDataAccumRef.current = ''
      setInitialSpawn(null)
    }, remaining)
    return () => clearTimeout(t)
  }, [initialSpawn, panes.length, inspectorSummary, activePaneReady])

  useEffect(() => {
    if (workspaceName !== undefined) setDisplayName(workspaceName)
  }, [workspaceName])

  const commitGroveName = useCallback(() => {
    if (!workspaceId) { setIsEditingName(false); return }
    const trimmed = draftName.trim().slice(0, 64)
    const nextName = trimmed.length > 0 ? trimmed : displayName
    setDisplayName(nextName)
    setIsEditingName(false)
    if (trimmed.length === 0 && nextName === displayName) return
    ipcInvoke(IPC.WORKSPACE_RENAME, { workspaceId, name: trimmed })
      .catch((err) => console.warn('[WindowShell] rename failed', err))
  }, [workspaceId, draftName, displayName])

  const cancelGroveName = useCallback(() => {
    setIsEditingName(false)
  }, [])

  const startEditingGroveName = useCallback(() => {
    if (!workspaceId) return
    setDraftName(displayName)
    setIsEditingName(true)
    requestAnimationFrame(() => {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    })
  }, [workspaceId, displayName])

  // On first render: query consent state and show consent dialog if pending (B-084)
  useEffect(() => {
    ipcInvoke(IPC.ANALYTICS_GET_CONSENT)
      .then((state) => {
        const s = state as ConsentState
        setConsentState(s)
        if (s === 'pending') {
          setAnalyticsMode('consent')
        }
      })
      .catch(() => {/* non-fatal */})
  }, [])

  // On first render: seed rate limit display with last known data (PE-01)
  useEffect(() => {
    ipcInvoke(IPC.RATE_LIMITS_GET)
      .then((data) => {
        // [rate-limits-debug] temporary — confirms initial seed result
        console.log('[rate-limits] seed on mount:', data ? 'populated' : 'null')
        if (data) setRateLimits(data as RateLimitsPayload)
      })
      .catch(() => {/* non-fatal */})
  }, [])

  // Auto-resume panes from workspace reactivation
  const resumeTriggered = useRef(false)
  useEffect(() => {
    if (!terminalsToResume || terminalsToResume.length === 0 || resumeTriggered.current) return
    resumeTriggered.current = true

    const resumeTrees = async () => {
      for (const terminal of terminalsToResume) {
        if (!terminal.sessionId) continue
        try {
          await ipcInvoke(IPC.PANE_SPAWN, {
            mode: 'resume-session',
            sessionId: terminal.sessionId,
            worktreePath: terminal.worktreePath,
            workspaceId
          })
        } catch {
          console.warn('[WindowShell] Failed to resume pane:', terminal.paneId)
        }
      }
    }
    resumeTrees()
  }, [terminalsToResume, workspaceId])

  // Main process → renderer: account-level rate limit update (PE-01)
  useIpcListener(IPC.RATE_LIMITS_UPDATE, (payload: unknown) => {
    // [rate-limits-debug] temporary — confirms live IPC reception
    const p = payload as RateLimitsPayload | null
    console.log(
      '[rate-limits] live update:',
      'fiveHour=' + (p?.fiveHour ? p.fiveHour.usedPercentage + '%' : 'null'),
      'sevenDay=' + (p?.sevenDay ? p.sevenDay.usedPercentage + '%' : 'null')
    )
    setRateLimits(payload as RateLimitsPayload)
  })

  // Application menu → renderer: "Help > Analytics…" (B-084)
  useIpcListener(IPC.MENU_ANALYTICS, () => {
    setAnalyticsMode('settings')
  })

  // Pane close confirmation — decide bypass vs modal via pane-close-options.
  const requestClosePane = useCallback((paneId: string) => {
    const pane = panes.find((p) => p.id === paneId)
    if (!pane || pane.terminated) {
      // Terminated or not found — close directly.
      ipcSend(IPC.PANE_CLOSE, { paneId })
      return
    }
    const descriptor: PaneCloseDescriptor = {
      status: pane.status,
      isWorktree: pane.isWorktree,
      isUntouched: pane.status === 'awaiting-prompt' && pane.metrics.totalTokens === null,
      hasUncommittedChanges: pane.gitStatus?.hasUncommittedChanges ?? false,
      changedFileCount: pane.gitStatus?.changedFileCount ?? 0,
      commitsAhead: pane.gitStatus?.commitsAhead ?? 0
    }
    const resolution = buildPaneCloseOptions(descriptor)
    if (resolution.bypass) {
      // Silent close — either untouched awaiting-prompt or done+clean.
      if (resolution.bypass === 'close-non-worktree') {
        ipcSend(IPC.PANE_CLOSE, { paneId })
      } else {
        ipcInvoke(IPC.PANE_CLOSE_WORKTREE, { paneId, action: resolution.bypass })
          .catch((err) => console.warn('[WindowShell] bypass close failed:', err))
      }
      return
    }
    const agentName = pane.metrics.sessionTitle ?? pane.worktreeName
    setPendingClosePane({
      paneId,
      repoName: pane.repoName,
      agentName,
      descriptor
    })
    setMergeCloseError(null)
    setCloseInFlight(false)
  }, [panes])

  const handlePaneCloseCancel = useCallback(() => {
    setPendingClosePane(null)
    setMergeCloseError(null)
    setCloseInFlight(false)
  }, [])

  const handlePaneCloseConfirm = useCallback(async (action: PaneCloseAction) => {
    const pending = pendingClosePane
    if (!pending) return
    setMergeCloseError(null)

    if (action === 'close-non-worktree') {
      ipcSend(IPC.PANE_CLOSE, { paneId: pending.paneId })
      setPendingClosePane(null)
      return
    }

    if (action === 'keep-close' || action === 'prune-close') {
      setPendingClosePane(null)
      try {
        const result = await ipcInvoke(IPC.PANE_CLOSE_WORKTREE, { paneId: pending.paneId, action }) as PaneCloseWorktreeResult
        if (result.error) console.error('[WindowShell] worktree close error:', result.error)
      } catch (err) {
        console.error('[WindowShell] worktree close failed:', err)
      }
      return
    }

    // action === 'merge-close' — keep modal open during merge so we can
    // surface conflicts / dirty-main without losing the user's place.
    setCloseInFlight(true)
    try {
      const result = await ipcInvoke(IPC.PANE_MERGE_AND_CLOSE, {
        paneId: pending.paneId,
        strategy: 'rebase-ff'
      }) as PaneMergeAndCloseResult
      if (result.error) {
        setMergeCloseError(result.error)
        setCloseInFlight(false)
        return
      }
      setPendingClosePane(null)
      setCloseInFlight(false)
    } catch (err) {
      setMergeCloseError((err as Error).message ?? String(err))
      setCloseInFlight(false)
    }
  }, [pendingClosePane])

  // ---------------------------------------------------------------------------
  // Workspace close sequence — orchestrated by main, rendered here.
  // ---------------------------------------------------------------------------

  const [sequenceMergeError, setSequenceMergeError] = useState<string | null>(null)
  const [sequencePending, setSequencePending] = useState(false)

  const sequenceState = useWorkspaceCloseSequence({
    resolveBypass: (pane: CloseSequencePaneDescriptor) => {
      const resolution = buildPaneCloseOptions({
        status: pane.status,
        isWorktree: pane.isWorktree,
        isUntouched: pane.isUntouched,
        hasUncommittedChanges: pane.hasUncommittedChanges,
        changedFileCount: pane.changedFileCount,
        commitsAhead: pane.commitsAhead
      })
      if (resolution.bypass) {
        return { kind: 'bypass', action: resolution.bypass }
      }
      return { kind: 'needs-modal' }
    },
    onBypass: (pane, action) => {
      if (action === 'close-non-worktree') {
        ipcSend(IPC.PANE_CLOSE, { paneId: pane.paneId })
      } else {
        ipcInvoke(IPC.PANE_CLOSE_WORKTREE, { paneId: pane.paneId, action })
          .catch((err) => console.warn('[WindowShell] bypass close in sequence failed:', err))
      }
    }
  })

  const sequenceCurrentPane = sequenceState.sequence && sequenceState.queue[sequenceState.currentIndex]
    ? sequenceState.queue[sequenceState.currentIndex]
    : null

  const handleSequencePaneConfirm = useCallback(async (action: PaneCloseAction) => {
    const current = sequenceCurrentPane
    if (!current) return
    setSequenceMergeError(null)

    if (action === 'close-non-worktree') {
      ipcSend(IPC.PANE_CLOSE, { paneId: current.paneId })
      sequenceState.advance()
      return
    }

    if (action === 'keep-close' || action === 'prune-close') {
      try {
        const result = await ipcInvoke(IPC.PANE_CLOSE_WORKTREE, { paneId: current.paneId, action }) as PaneCloseWorktreeResult
        if (result.error) console.error('[WindowShell] sequence worktree close error:', result.error)
      } catch (err) {
        console.error('[WindowShell] sequence worktree close failed:', err)
      }
      sequenceState.advance()
      return
    }

    // merge-close — keep the current modal up during the merge attempt so
    // conflict/dirty-main errors don't skip past the user.
    setSequencePending(true)
    try {
      const result = await ipcInvoke(IPC.PANE_MERGE_AND_CLOSE, {
        paneId: current.paneId,
        strategy: 'rebase-ff'
      }) as PaneMergeAndCloseResult
      if (result.error) {
        setSequenceMergeError(result.error)
        setSequencePending(false)
        return
      }
      setSequencePending(false)
      sequenceState.advance()
    } catch (err) {
      setSequenceMergeError((err as Error).message ?? String(err))
      setSequencePending(false)
    }
  }, [sequenceCurrentPane, sequenceState])

  const openSpawnDialog = useCallback(() => setIsSpawnDialogOpen(true), [])
  const closeSpawnDialog = useCallback(() => setIsSpawnDialogOpen(false), [])

  const showManagerWindow = useCallback(() => {
    ipcSend(IPC.MANAGER_SHOW, {})
  }, [])

  const handleGlobalEffortToggle = useCallback(() => {
    const cycle: Record<EffortLevel, EffortLevel> = {
      low: 'medium',
      medium: 'high',
      high: 'low',
      xhigh: 'low',
      max: 'low'
    }
    setGlobalEffort(cycle[globalEffort])
  }, [globalEffort, setGlobalEffort])

  // Application menu → renderer: "File > New Pane" (B-066)
  useIpcListener(IPC.MENU_NEW_PANE, () => {
    setIsSpawnDialogOpen(true)
  })

  // Application menu → renderer: "File > Close Pane" (B-066)
  useIpcListener(IPC.MENU_CLOSE_PANE, () => {
    if (focusedPaneId) {
      requestClosePane(focusedPaneId)
    }
  })

  // Application menu → renderer: "Help > Send Feedback" (B-066, B-067)
  useIpcListener(IPC.MENU_FEEDBACK, () => {
    void openFeedbackUrl()
  })

  // Global keyboard shortcuts (renderer-side, B-062 + B-063)
  useEffect(() => {
    const trackShortcut = (action: string): void => {
      ipcSend(IPC.ANALYTICS_TRACK_SHORTCUT, { action })
    }
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.startsWith('Mac')
      const meta = isMac ? e.metaKey : e.ctrlKey
      if (!meta || !e.shiftKey) return

      // Cmd+Shift+P / Ctrl+Shift+P — focus the Claudinha Command (manager) window
      if (e.key === 'P') {
        e.preventDefault()
        showManagerWindow()
        trackShortcut('show_manager')
        return
      }

      // Cmd+Shift+N / Ctrl+Shift+N — open AddTerminalsDialog
      if (e.key === 'N') {
        e.preventDefault()
        setIsSpawnDialogOpen(true)
        trackShortcut('new_pane')
        return
      }

      // Cmd+Shift+T / Ctrl+Shift+T — new window (B-047)
      if (e.key === 'T') {
        e.preventDefault()
        ipcSend(IPC.WINDOW_NEW, {})
        trackShortcut('new_window')
        return
      }

      // Cmd+Shift+W / Ctrl+Shift+W — close focused pane (B-062)
      if (e.key === 'W' && focusedPaneId) {
        e.preventDefault()
        requestClosePane(focusedPaneId)
        trackShortcut('close_pane')
        return
      }

      // Cmd+Shift+] / Ctrl+Shift+] — focus next pane (B-063)
      if ((e.key === ']' || e.key === '}') && panes.length > 1) {
        e.preventDefault()
        const idx = panes.findIndex((p) => p.id === focusedPaneId)
        const next = panes[(idx + 1) % panes.length]
        setFocusedPane(next.id)
        trackShortcut('focus_next')
        return
      }

      // Cmd+Shift+[ / Ctrl+Shift+[ — focus previous pane (B-063)
      if ((e.key === '[' || e.key === '{') && panes.length > 1) {
        e.preventDefault()
        const idx = panes.findIndex((p) => p.id === focusedPaneId)
        const prev = panes[(idx - 1 + panes.length) % panes.length]
        setFocusedPane(prev.id)
        trackShortcut('focus_prev')
        return
      }

      // Cmd+Shift+1-9 / Ctrl+Shift+1-9 — focus pane by position (B-063)
      const num = parseInt(e.key, 10)
      if (!isNaN(num) && num >= 1 && num <= 9 && num <= panes.length) {
        e.preventDefault()
        setFocusedPane(panes[num - 1].id)
        trackShortcut('focus_by_number')
        return
      }

      // Cmd+Shift+M / Ctrl+Shift+M — open window picker for focused pane (B-062)
      // Note: compare case-insensitively — on macOS, Cmd+Shift+letter reports
      // lowercase e.key because Cmd overrides the Shift modifier for letters.
      if (e.key.toUpperCase() === 'M' && focusedPaneId) {
        e.preventDefault()
        document.dispatchEvent(
          new CustomEvent('claudinha:open-window-picker', { detail: { paneId: focusedPaneId } })
        )
        trackShortcut('move_pane')
        return
      }

      // Cmd+Shift+E / Ctrl+Shift+E — cycle global effort
      if (e.key.toUpperCase() === 'E') {
        e.preventDefault()
        handleGlobalEffortToggle()
        trackShortcut('global_effort')
        return
      }

      // Cmd+Shift+I / Ctrl+Shift+I — open feedback on GitHub (B-067)
      if (e.key.toUpperCase() === 'I') {
        e.preventDefault()
        void openFeedbackUrl()
        trackShortcut('feedback')
        return
      }

      // Cmd+Shift+G / Ctrl+Shift+G — open merge menu on completion bar
      if (e.key.toUpperCase() === 'G' && focusedPaneId) {
        e.preventDefault()
        document.dispatchEvent(
          new CustomEvent('claudinha:open-completion-menu', { detail: { paneId: focusedPaneId, menu: 'merge' } })
        )
        trackShortcut('open_merge_menu')
        return
      }

      // Cmd+Shift+R / Ctrl+Shift+R — open PR menu on completion bar
      if (e.key.toUpperCase() === 'R' && focusedPaneId) {
        e.preventDefault()
        document.dispatchEvent(
          new CustomEvent('claudinha:open-completion-menu', { detail: { paneId: focusedPaneId, menu: 'pr' } })
        )
        trackShortcut('open_pr_menu')
        return
      }

      // Cmd+Shift+K / Ctrl+Shift+K — toggle Wall ⇄ Kanban view mode
      if (e.key.toUpperCase() === 'K' && workspaceId) {
        e.preventDefault()
        handleViewModeChange(viewMode === 'wall' ? 'kanban' : 'wall')
        trackShortcut('toggle_view_mode')
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // Include panes.length + focusedPaneId so handler can cycle correctly
  }, [panes, focusedPaneId, setFocusedPane, requestClosePane, handleGlobalEffortToggle, showManagerWindow, workspaceId, viewMode, handleViewModeChange])

  // Rate limits are only relevant for non-API billing accounts (PE-01)
  const hasNonApiPane = panes.some((p) => !p.isApiBilling)

  return (
    <div className="w-screen h-screen overflow-hidden bg-terminal-bg flex flex-col relative">
      {/* Custom titlebar — height matches trafficLightPosition.y (10) + button (12) + 10 = 32 */}
      <div
        className="shrink-0 relative flex items-center bg-surface border-b border-[var(--color-border-subtle)]"
        style={{ height: 32, WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left cluster — Back to Management + (wall-only) + Terminal. Left padding
            clears the macOS traffic lights (positioned at x:12, ~70px wide). */}
        {workspaceId && (
          <div
            className="relative z-10 flex items-center gap-1"
            style={{ paddingLeft: 80, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={showManagerWindow}
              className="flex items-center gap-1 text-xs text-fg-secondary hover:text-fg-primary hover:bg-raised rounded px-2 py-0.5 transition-[color,background-color] duration-[80ms]"
              aria-label={t.windowShell.backTooltip}
            >
              ← {t.managerWindow.title.replace(/^Claudinha:\s*/, '')}
            </button>
            {viewMode === 'wall' && (
              <button
                type="button"
                onClick={openSpawnDialog}
                className="flex items-center gap-1 text-xs text-fg-secondary hover:text-fg-primary hover:bg-raised rounded px-2 py-0.5 transition-[color,background-color] duration-[80ms]"
                aria-label={t.windowShell.newTerminalsAria}
              >
                {t.windowShell.newTerminalsButton}
              </button>
            )}
          </div>
        )}
        {/* Centered title — absolute so traffic lights don't offset it.
            Click the name to rename the workspace inline; Enter commits, Esc cancels,
            blank reverts to the default `Workspace N`. */}
        <div className="absolute inset-x-0 flex justify-center items-center gap-2 pointer-events-none">
          {workspaceId ? (
            <>
              <span className="text-[16px] font-[600] text-fg-secondary select-none">Claudinha:</span>
              {isEditingName ? (
                <input
                  ref={nameInputRef}
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitGroveName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitGroveName() }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelGroveName() }
                  }}
                  maxLength={64}
                  aria-label={t.windowShell.workspaceNameAria}
                  className="pointer-events-auto bg-raised text-fg-primary text-[16px] font-[600] text-center px-2 py-0.5 rounded border border-[var(--color-border-subtle)] outline-none"
                  style={{ WebkitAppRegion: 'no-drag', width: '16rem' } as React.CSSProperties}
                />
              ) : (
                <button
                  type="button"
                  onClick={startEditingGroveName}
                  title="Click to rename workspace"
                  aria-label={`Rename workspace (currently ${displayName || 'unnamed'})`}
                  className="pointer-events-auto text-[16px] font-[600] text-fg-secondary hover:text-fg-primary px-2 py-0.5 rounded hover:bg-raised transition-colors duration-[80ms] select-none"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  {displayName || 'unnamed'}
                </button>
              )}
            </>
          ) : (
            <span className="text-[16px] font-[600] text-fg-secondary select-none">Claudinha</span>
          )}
        </div>
        {/* Right-aligned title-bar controls — order is Submit Feedback,
            Wall/Kanban toggle. The Feedback button carries `ml-auto` so the
            whole group anchors to the right edge. */}
        <button
          type="button"
          onClick={() => void openFeedbackUrl()}
          title={t.managerWindow.submitFeedbackTooltip}
          aria-label={t.managerWindow.submitFeedback}
          className="relative ml-auto mr-2 z-10 flex items-center gap-1.5 text-fg-muted hover:text-fg-primary transition-colors px-2 py-1 rounded"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <MessageSquareText size={14} />
          <span className="text-xs">{t.managerWindow.submitFeedback}</span>
        </button>
        {/* View-mode toggle — Wall vs Kanban. Hidden when the window has no
            workspace (manager bootstrap state). Sits at the right edge of the
            title bar; the Feedback button's `ml-auto` anchors the whole group. */}
        {workspaceId && (
          <div
            className="relative z-10 mr-2"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <SegmentedControl<'wall' | 'kanban'>
              size="sm"
              value={viewMode}
              onChange={handleViewModeChange}
              options={[
                { value: 'wall', label: t.windowShell.viewWall },
                { value: 'kanban', label: t.windowShell.viewKanban }
              ]}
            />
          </div>
        )}
      </div>

      {panes.length === 0 ? (
        <>
          <div className="flex-1 min-h-0">
            <EmptyState
              onSpawnClick={openSpawnDialog}
              onShowManager={showManagerWindow}
              workspaceName={workspaceName}
              workspaceType={workspaceType}
            />
          </div>
          {workspaceId && pausedTerminals.length > 0 && (
            <PausedTerminalsPanel workspaceId={workspaceId} pausedTerminals={pausedTerminals} />
          )}
        </>
      ) : (
        <>
          {/* Pane content area + Inspector drawer.

              CRITICAL invariant (L-005, L-008): the PaneGrid component must
              keep the same React-tree parent chain across viewMode switches,
              otherwise its <Pane> children unmount and xterm state is lost.

              Layout:
                <flex-col stable wrapper>
                  [Kanban only: KanbanBoard top]
                  <flex-row stable bottom>
                    [Kanban only: repo-rail placeholder]
                    <stable PaneGrid host>
                      <PaneGrid layout=wall|kanban-stack ... />
                    </stable PaneGrid host>
                    [InspectorDrawer]
                  </flex-row>
                </flex-col>
              The PaneGrid host div is rendered unconditionally; only the
              surrounding chrome differs by viewMode. */}
          <div ref={kanbanColumnRef} className="flex-1 min-h-0 flex flex-col relative">
            {viewMode === 'kanban' && (
              <>
                <div
                  className="shrink-0 border-b overflow-hidden"
                  style={{
                    height: kanbanVisibleHeight,
                    borderColor: 'var(--color-border-strong)'
                  }}
                >
                  <KanbanBoard
                    panes={panes}
                    activePaneId={activePaneId}
                    workspaceId={workspaceId ?? null}
                    onCardClick={selectActivePane}
                    onCloseCard={requestClosePane}
                  />
                </div>
                <KanbanResizeHandle
                  persistedHeightPx={persistedKanbanHeight}
                  maxHeightPx={kanbanMaxHeight}
                  onDrag={setKanbanDragHeight}
                  onCommit={onKanbanResizeCommit}
                />
              </>
            )}
            <div className="flex-1 min-h-0 flex flex-row relative">
              {viewMode === 'kanban' && (
                <div
                  className="shrink-0 min-h-0 p-2"
                  style={{ width: 280, background: 'var(--color-bg-surface)' }}
                >
                  {/* Raised rounded card floats on the rail surface — content
                      sits on --color-bg-raised, chrome on --color-bg-surface,
                      crisped by a subtle border so both themes read cleanly. */}
                  <div
                    className="h-full rounded-lg overflow-hidden"
                    style={{ background: 'var(--color-bg-raised)', border: '1px solid var(--color-border-subtle)' }}
                  >
                    <KanbanRepoRail
                      workspaceId={workspaceId}
                      activePaneId={activePaneId}
                      onSelectSession={selectActivePane}
                      onSpawnClick={openSpawnDialog}
                    />
                  </div>
                </div>
              )}
              <div className="flex-1 min-h-0 min-w-0">
                <PaneGrid
                  paneIds={paneIds}
                  onRequestClosePane={requestClosePane}
                  layout={viewMode === 'kanban' ? 'kanban-stack' : 'wall'}
                  activePaneId={activePaneId}
                  kanbanTransition={viewMode === 'kanban' ? kanbanTransition : undefined}
                />
              </div>
              {!INSPECTOR_HIDDEN && workspaceId && (
                <InspectorDrawer workspaceId={workspaceId} displayName={displayName || workspaceName || 'Workspace'} />
              )}
            </div>
          </div>

          {/* Dormant panes panel — collapsible, below pane grid */}
          {workspaceId && pausedTerminals.length > 0 && (
            <PausedTerminalsPanel workspaceId={workspaceId} pausedTerminals={pausedTerminals} />
          )}
        </>
      )}

      {/* Bottom bar — rate-limit gauges (PE-01, non-API-billing only) on the
          left, Keyboard Shortcuts + language flag right-aligned. Always
          mounted when a workspace is bound so the Shortcuts affordance is
          always visible. The language flag sits inline (not absolute) so it
          pushes the Shortcuts button to the left rather than overlapping it. */}
      {workspaceId && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-surface border-t border-[var(--color-border-subtle)]">
          {hasNonApiPane && (
            <RateLimitBar
              fiveHour={rateLimits?.fiveHour ?? null}
              sevenDay={rateLimits?.sevenDay ?? null}
            />
          )}
          <button
            type="button"
            onClick={() => setIsShortcutsModalOpen(true)}
            className="ml-auto flex items-center gap-1 text-xs text-fg-secondary hover:text-fg-primary hover:bg-raised rounded px-2 py-0.5 transition-[color,background-color] duration-[80ms]"
            aria-label={t.keyboardShortcuts.showShortcuts}
          >
            {t.keyboardShortcuts.title}
          </button>
          <LanguageFlagToggle />
        </div>
      )}

      {initialSpawn !== null && <WorkspaceSpawnOverlay />}

      {workspaceId && (
        <AddTerminalsDialog
          isOpen={isSpawnDialogOpen}
          onClose={closeSpawnDialog}
          workspaceId={workspaceId}
          workspaceType={workspaceType}
          workspaceConstraint={workspaceConstraint}
          lastSpawnedRepoPath={lastSpawnedRepoPath}
        />
      )}
      {pendingClosePane !== null && (
        <PaneCloseConfirmModal
          repoName={pendingClosePane.repoName}
          agentName={pendingClosePane.agentName}
          descriptor={pendingClosePane.descriptor}
          onCancel={handlePaneCloseCancel}
          onConfirm={handlePaneCloseConfirm}
          mergeError={mergeCloseError}
          pending={closeInFlight}
        />
      )}
      {sequenceState.sequence && sequenceCurrentPane && (
        <WorkspaceCloseOverlay
          sequence={sequenceState.sequence}
          currentPane={sequenceCurrentPane}
          currentIndex={sequenceState.currentIndex}
          totalCount={sequenceState.queue.length}
          onConfirm={handleSequencePaneConfirm}
          onCancel={sequenceState.cancel}
          onOverrideAll={sequenceState.overrideAll}
          pending={sequencePending}
          mergeError={sequenceMergeError}
        />
      )}
      {analyticsMode !== null && (
        <AnalyticsConsentDialog
          mode={analyticsMode}
          currentConsent={consentState}
          onClose={() => setAnalyticsMode(null)}
          onConsentChange={setConsentState}
        />
      )}
      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />
    </div>
  )
}
