import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { EffortLevel, Model } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import { ipcSend } from '../hooks/useIpc'
import { usePaneState } from '../hooks/usePaneState'
import { resolvePaneDisplayName } from '../../shared/pane-display'
import { useAppConfig } from '../hooks/useAppConfig'
import { HEADER_ROW2_HEIGHT_PX, COMPLETION_BAR_HEIGHT_PX } from '../lib/constants'
import { PaneBorder } from './PaneBorder'
import { PaneHeader } from './PaneHeader'
import { MetricsOverlay } from './MetricsOverlay'
import { StatusOverlay } from './StatusOverlay'
import { ToolUsageRow } from './ToolUsageRow'
import { WindowPicker } from './WindowPicker'
import { TurnsModal } from './TurnsModal'
import { ModelPopover } from './ModelPopover'
import { XTermView } from './XTermView'
import type { XTermViewHandle } from './XTermView'

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

interface PaneProps {
  paneId: string
  /** Called when user requests closing this pane — routed through WindowShell for confirmation gating */
  onRequestClose?: (paneId: string) => void
  /**
   * Which surrounding context this pane lives in.
   *   - 'wall' (default): tiled grid; full chrome (focus halo, move/close,
   *     floating status/metrics overlays).
   *   - 'kanban': single-active-terminal stack. Focus halo, move/close, and
   *     floating overlays are suppressed; status + metrics render inline
   *     inside the header instead.
   */
  chromeMode?: 'wall' | 'kanban'
  /**
   * Whether this pane's wrapper is currently `visibility: visible` (kanban
   * stack only — wall layout always shows every pane). Forwarded to XTermView
   * so it can fit + refresh on hidden→visible transitions.
   */
  isVisible?: boolean
}

/**
 * Pane — container for a single Claude Code terminal session.
 *
 * Layout:
 *   outer relative wrapper
 *     PaneBorder (status-colored outer border)
 *       PaneHeader (row 1)
 *       ToolUsageRow (row 2)
 *       Separator (2px)
 *       XTermView
 *     StatusOverlay (top border center, absolute)
 *     MetricsOverlay (bottom border center, absolute) — added in B-026
 */
export function Pane({ paneId, onRequestClose, chromeMode = 'wall', isVisible = true }: PaneProps): React.JSX.Element {
  const {
    panes,
    focusedPaneId,
    setFocusedPane,
    setEffort,
    setModel,
    windowHiveId
  } = usePaneState()
  const { config: appConfig } = useAppConfig()
  const showToolCountsBar = appConfig.showToolCountsBar
  const pane = panes.find((p) => p.id === paneId)
  const xTermRef = useRef<XTermViewHandle>(null)

  const isFocused = focusedPaneId === paneId
  // Position (1-indexed) in pane list for Cmd+Shift+1-9 labels (B-064)
  const positionIndex = panes.findIndex((p) => p.id === paneId)
  const positionNumber = panes.length >= 2 && positionIndex >= 0 && positionIndex < 9
    ? positionIndex + 1
    : undefined
  const status = pane?.status ?? 'awaiting-prompt'
  const terminated = pane?.terminated ?? false
  const hasUnseenStatusChange = pane?.hasUnseenStatusChange ?? false
  const repoName = pane?.repoName ?? ''
  const worktreeName = pane?.worktreeName ?? ''
  const userName = pane?.userName ?? null
  const activeToolName = pane?.activeToolName ?? null
  const metrics = pane?.metrics ?? {
    totalTokens: null, contextPercent: null, toolsUsed: null,
    totalCostUsd: null, durationMs: null, modelDisplayName: null,
    linesAdded: null, linesRemoved: null, sessionTitle: null,
    agentName: null, initialPrompt: null
  }
  const isApiBilling = pane?.isApiBilling ?? false
  const effort = pane?.effort ?? 'high'
  const model = pane?.model ?? 'opus'
  const gitStatus = pane?.gitStatus ?? null
  const completionStatus = pane?.completionStatus ?? null
  const isWorktreePane = pane?.isWorktree ?? false
  const isResolvingConflict = pane?.isResolvingConflict ?? false
  const toolsUsed = metrics.toolsUsed

  // Completion action bar visibility:
  // Show when pane is done, is a worktree, has work to integrate, and not on main/master.
  // "Work to integrate" means commits ahead OR uncommitted changes (merge flow auto-commits).
  // dismissed tracks local user dismissal (completionStatus null + dismissed = hidden).
  const isOnMainBranch = gitStatus?.branchName === 'main' || gitStatus?.branchName === 'master'
  const hasWorkToIntegrate =
    (gitStatus?.commitsAhead ?? 0) > 0 || (gitStatus?.hasUncommittedChanges ?? false)
  const [completionDismissed, setCompletionDismissed] = useState(false)
  // TurnsModal visibility — opened by the in-strip CTA below and by the
  // global Cmd+Shift+G / Cmd+Shift+R shortcuts (WindowShell dispatches a
  // CustomEvent the focused pane listens for). The legacy menu-focus hint
  // (`merge` / `pr`) is intentionally dropped — the new turn-based UI
  // doesn't have separate Merge / PR menus to focus into.
  const [isTurnsModalOpen, setIsTurnsModalOpen] = useState(false)
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { paneId?: string } | undefined
      if (detail?.paneId !== paneId) return
      setIsTurnsModalOpen(true)
    }
    document.addEventListener('claudinha:open-completion-menu', handler)
    return () => document.removeEventListener('claudinha:open-completion-menu', handler)
  }, [paneId])
  // The bar must also stay visible while a completion action is mid-flight or
  // in a terminal result state (merged / pr-created / error / etc). Otherwise
  // a successful merge consumes hasWorkToIntegrate the moment it lands and
  // the bar unmounts before the user ever sees the "Merged to main"
  // confirmation.
  const hasActiveCompletionState =
    completionStatus !== null && completionStatus.state !== 'ready'
  const showCompletionBar =
    !terminated &&
    !completionDismissed &&
    (
      (
        status === 'changes-ready' &&
        isWorktreePane &&
        hasWorkToIntegrate &&
        !isOnMainBranch
      ) ||
      hasActiveCompletionState
    )

  // Reset dismissed state when pane re-enters changes-ready (e.g., conflict resolution restarts work)
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current !== 'changes-ready' && status === 'changes-ready') {
      setCompletionDismissed(false)
    }
    prevStatusRef.current = status
  }, [status])

  const [isWindowPickerOpen, setIsWindowPickerOpen] = useState(false)
  const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false)

  // Track pane width for progressive metrics truncation (B-040) and narrow adaptations (B-061)
  const paneRef = useRef<HTMLDivElement>(null)
  const [paneWidth, setPaneWidth] = useState<number | undefined>(undefined)
  // "Narrow" when pane is below ~40 terminal columns wide (40 * 8px = 320px)
  const isNarrow = paneWidth !== undefined && paneWidth < 320
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined) setPaneWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Listen for Cmd+Shift+M / Alt+Shift+M keyboard shortcut (B-062)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ paneId: string }>
      if (ce.detail?.paneId === paneId) {
        setIsWindowPickerOpen(true)
      }
    }
    document.addEventListener('claudinha:open-window-picker', handler)
    return () => document.removeEventListener('claudinha:open-window-picker', handler)
  }, [paneId])

  const handleClick = useCallback(() => {
    setFocusedPane(paneId)
  }, [paneId, setFocusedPane])

  const handleEffortToggle = useCallback(() => {
    const cycle: Record<EffortLevel, EffortLevel> = {
      low: 'medium',
      medium: 'high',
      high: 'xhigh',
      xhigh: 'max',
      max: 'low'
    }
    setEffort(paneId, cycle[effort])
  }, [paneId, effort, setEffort])

  const handleModelSelect = useCallback(
    (m: Model) => {
      setModel(paneId, m)
    },
    [paneId, setModel]
  )

  /** Called by WindowPicker with the selected target windowId */
  const handleMoveToWindow = useCallback(
    (targetWindowId: string) => {
      const serializedBuffer = xTermRef.current?.serialize() ?? ''
      ipcSend(IPC.PANE_MOVE, { paneId, targetWindowId, serializedBuffer })
    },
    [paneId]
  )

  /** Called by WindowPicker when "New Window" is selected */
  const handleMoveToNewWindow = useCallback(() => {
    const serializedBuffer = xTermRef.current?.serialize() ?? ''
    ipcSend(IPC.WINDOW_NEW, { paneId, serializedBuffer })
  }, [paneId])

  const handleRespawn = useCallback(() => {
    ipcSend(IPC.PANE_RESPAWN, { paneId })
  }, [paneId])

  /** Close with confirmation gate (routed through WindowShell) */
  const handleClose = useCallback(() => {
    if (onRequestClose) {
      onRequestClose(paneId)
    } else {
      ipcSend(IPC.PANE_CLOSE, { paneId })
    }
  }, [paneId, onRequestClose])

  /** Direct close for terminated panes — no confirmation needed */
  const handleDirectClose = useCallback(() => {
    ipcSend(IPC.PANE_CLOSE, { paneId })
  }, [paneId])

  return (
    <div ref={paneRef} className="w-full relative h-full">
      <PaneBorder
        status={status}
        terminated={terminated}
        hasError={completionStatus?.state === 'error'}
        isFocused={isFocused}
        hasUnseenStatusChange={hasUnseenStatusChange}
        chromeMode={chromeMode}
      >
        <div
          className="w-full flex-1 min-h-0 flex flex-col overflow-hidden"
          onClick={handleClick}
        >
          <div className="relative flex-shrink-0">
            <PaneHeader
              paneId={paneId}
              repoName={repoName}
              worktreeName={worktreeName}
              sessionTitle={metrics.sessionTitle}
              userName={userName}
              onMoveClick={() => setIsWindowPickerOpen(true)}
              isNarrow={isNarrow}
              positionNumber={positionNumber}
              onClose={handleClose}
              gitStatus={gitStatus}
              model={model}
              onModelClick={() => setIsModelPopoverOpen((prev) => !prev)}
              isFocused={isFocused}
              chromeMode={chromeMode}
              paneStatus={status}
              activeToolName={activeToolName}
              terminated={terminated}
              isResolvingConflict={isResolvingConflict}
              metrics={metrics}
              isApiBilling={isApiBilling}
            />
            <WindowPicker
              paneId={paneId}
              isOpen={isWindowPickerOpen}
              onClose={() => setIsWindowPickerOpen(false)}
              onMoveToWindow={handleMoveToWindow}
              onMoveToNewWindow={handleMoveToNewWindow}
            />
            <ModelPopover
              isOpen={isModelPopoverOpen}
              onClose={() => setIsModelPopoverOpen(false)}
              model={model}
              onSelect={handleModelSelect}
            />
          </div>
          {/* ToolUsageRow appears only once at least one tool has been
              used. When it first appears the terminal shrinks by one row
              worth of pixels — a single, one-time resize that xterm's
              ResizeObserver handles cleanly. */}
          {!isNarrow && showToolCountsBar && toolsUsed && Object.keys(toolsUsed).length > 0 && (
            <div className="flex-shrink-0 overflow-hidden" style={{ height: HEADER_ROW2_HEIGHT_PX }}>
              <ToolUsageRow toolsUsed={toolsUsed} isFocused={isFocused} />
            </div>
          )}
          <div className="flex-1 min-h-0 relative">
            <XTermView
              ref={xTermRef}
              paneId={paneId}
              focused={isFocused}
              isVisible={isVisible}
              initialSerializedBuffer={pane?.initialBuffer}
              onFocusRequested={handleClick}
            />
            {terminated && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: 'rgba(0,0,0,0.7)' }}>
                <p className="text-sm font-medium text-danger-fg">
                  Session terminated
                </p>
                <div className="flex gap-2">
                  <button
                    className="px-4 py-1.5 rounded text-sm font-medium text-white"
                    style={{ background: 'var(--color-danger-fg)' }}
                    onClick={handleRespawn}
                  >
                    Respawn
                  </button>
                  <button
                    className="px-4 py-1.5 rounded text-sm font-medium text-white bg-zinc-600 hover:bg-zinc-500"
                    onClick={handleDirectClose}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* "Changes ready" CTA — opens the per-terminal TurnsModal where the
            user picks turns to publish, split, or discard. Wall-mode only —
            the kanban tile's own pill is the entry point in kanban chrome. */}
        {chromeMode === 'wall' && showCompletionBar && (
          <button
            type="button"
            onClick={() => setIsTurnsModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-[600] bg-[var(--color-status-done)] text-canvas hover:brightness-110 transition-[filter] duration-[80ms]"
            style={{ height: COMPLETION_BAR_HEIGHT_PX }}
            title="Open turns modal"
          >
            <span>Changes ready</span>
            <span aria-hidden="true">▸</span>
          </button>
        )}
      </PaneBorder>
      {isTurnsModalOpen && pane && (
        <TurnsModal
          paneId={paneId}
          paneName={resolvePaneDisplayName(pane)}
          workspaceId={windowHiveId ?? null}
          onClose={() => setIsTurnsModalOpen(false)}
        />
      )}

      {/* Status label centered on top border (PRD F5 Layer 2).
          Suppressed in Kanban — the header renders an inline status chip
          instead (feedback item 3). */}
      {chromeMode === 'wall' && (
        <StatusOverlay
          status={status}
          activeToolName={activeToolName}
          terminated={terminated}
          gitStatus={gitStatus}
          isResolvingConflict={isResolvingConflict}
        />
      )}
      {/* Metrics centered on bottom border — shifted up when completion action
          bar is visible to avoid overlap. Also suppressed in Kanban; the
          header carries a compact metrics summary inline. */}
      {chromeMode === 'wall' && (
        <MetricsOverlay
          metrics={metrics}
          isApiBilling={isApiBilling}
          containerWidth={paneWidth}
          isNarrow={isNarrow}
          bottomOffset={0}
        />
      )}
    </div>
  )
}
