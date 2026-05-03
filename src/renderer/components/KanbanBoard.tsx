import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { MergeStrategy, PaneStatus } from '../../shared/types'
import type { RendererPane } from '../hooks/usePaneState'
import { IPC } from '../../shared/ipc-channels'
import { ipcInvoke, ipcSend } from '../hooks/useIpc'
import { KanbanColumn } from './KanbanColumn'
import { DirtyMainModal } from './DirtyMainModal'
import { ConflictResolveModal } from './ConflictResolveModal'
import { ChangesReadyModal } from './ChangesReadyModal'
import { useStrings } from '../lib/strings'
import { useKanbanCardMoves } from '../hooks/useKanbanCardMoves'
import { KanbanOverlayCard } from './KanbanOverlayCard'

interface KanbanBoardProps {
  panes: RendererPane[]
  activePaneId: string | null
  /** Workspace owning these panes — passed to ChangesReadyModal so it can
   *  invoke per-repo composite IPCs (Merge+Push). Null in workspace-less
   *  contexts (legacy or transient). */
  workspaceId?: string | null
  onCardClick: (paneId: string) => void
  /** Routes the card-level X through the shared close-pane flow. */
  onCloseCard?: (paneId: string) => void
}

/**
 * Column order follows the new lifecycle:
 *   awaiting-orders → planning → plan-ready → needs-input → working → changes-ready
 *
 * Awaiting-orders is the leftmost narrow rail (idle, untouched terminals).
 * Errors are no longer a column — they surface as a red border on whichever
 * column the pane currently sits in (driven by `terminated` or
 * `completionStatus.state === 'error'`).
 */
const COLUMN_STATUSES: PaneStatus[] = [
  'awaiting-prompt',
  'planning',
  'plan-ready',
  'needs-input',
  'working',
  'changes-ready'
]

function bucketFor(pane: RendererPane): PaneStatus {
  // Plan-mode tool work shows in Planning, not Working — composing a plan is
  // a distinct activity from building code, even though both run tools.
  // (Plan-ready is owned by hook-listener's routeStopStatus and arrives via
  // pane.status === 'plan-ready' on Stop; this branch is only the
  // mid-composition case.)
  if (pane.status === 'working' && pane.permissionMode === 'plan') {
    return 'planning'
  }
  return pane.status
}

export function KanbanBoard({ panes, activePaneId, workspaceId, onCardClick, onCloseCard }: KanbanBoardProps): React.JSX.Element {
  const t = useStrings()
  const columnTitle: Record<PaneStatus, string> = {
    'awaiting-prompt': t.kanban.columnAwaitingOrders,
    'planning': t.kanban.columnPlanning,
    'plan-ready': t.kanban.columnPlanReady,
    'needs-input': t.kanban.columnNeedsInput,
    'working': t.kanban.columnWorking,
    'changes-ready': t.kanban.columnChangesReady
  }
  // Refs shared with useKanbanCardMoves: per-card DOM nodes for fromRect
  // measurement, per-column drop-target nodes for toRect. Populated by
  // KanbanCard / KanbanColumn via ref callbacks.
  const cardRefs = useRef<Map<string, HTMLElement | null>>(new Map())
  const dropTargetRefs = useRef<Map<PaneStatus, HTMLElement | null>>(new Map())

  // displayedPanes lags `panes` while a card is mid-move. The currently
  // moving pane is omitted entirely (it lives in `movingCard` as an overlay).
  const { displayedPanes, movingCard } = useKanbanCardMoves(panes, {
    cardRefs,
    dropTargetRefs
  })

  const grouped: Record<PaneStatus, RendererPane[]> = {
    'awaiting-prompt': [],
    'planning': [],
    'plan-ready': [],
    'needs-input': [],
    'working': [],
    'changes-ready': []
  }
  for (const pane of displayedPanes) {
    grouped[bucketFor(pane)].push(pane)
  }

  // FLIP helper in KanbanColumn syncs its compaction duration to the
  // currently in-flight move (so the source column closes its gap at the
  // same time the moving overlay lands). When no move is in flight, the
  // column uses its fallback constant.
  const compactionDurationMs = movingCard?.durationMs ?? null

  // ChangesReadyModal state lives at the board level so the modal overlays the
  // entire window regardless of which card opened it. Replaces the old
  // diff-chip-driven DiffViewerModal — the diff viewer is now a sub-modal
  // inside ChangesReadyModal.
  const [pillPane, setPillPane] = useState<{ paneId: string; paneName: string } | null>(null)
  const onPillClick = useCallback((paneId: string, paneName: string) => {
    setPillPane({ paneId, paneName })
  }, [])

  // Dirty-main resolution modal state. The board owns it (not each card) so
  // the dialog overlays the entire Kanban view regardless of which column the
  // offending card lives in. Auto-opens once per dirty-main transition —
  // mirrors CompletionActionBar's auto-open-on-error pattern so the user
  // doesn't have to hunt for the small chip on a busy board.
  const [dirtyMainPaneId, setDirtyMainPaneId] = useState<string | null>(null)
  const autoOpenedFor = useRef<Set<string>>(new Set())
  const previousDirtyPanes = useRef<Set<string>>(new Set())

  useEffect(() => {
    const nowDirty = new Set<string>()
    for (const pane of panes) {
      if (pane.completionStatus?.state === 'dirty-main') {
        nowDirty.add(pane.id)
      }
    }
    // Detect panes that just transitioned INTO dirty-main (present now, absent
    // last tick). If no modal is already open, auto-open for the first such
    // pane and mark it as auto-opened so a dismiss + new dirty-main lands
    // back on the modal rather than suppressing it permanently.
    let paneToAutoOpen: string | null = null
    for (const paneId of nowDirty) {
      if (!previousDirtyPanes.current.has(paneId)) {
        paneToAutoOpen = paneId
        break
      }
    }
    // Clear auto-open marker for panes that left dirty-main so a future
    // re-entry retriggers.
    for (const paneId of autoOpenedFor.current) {
      if (!nowDirty.has(paneId)) autoOpenedFor.current.delete(paneId)
    }
    if (paneToAutoOpen && !dirtyMainPaneId && !autoOpenedFor.current.has(paneToAutoOpen)) {
      autoOpenedFor.current.add(paneToAutoOpen)
      setDirtyMainPaneId(paneToAutoOpen)
    }
    previousDirtyPanes.current = nowDirty
  }, [panes, dirtyMainPaneId])

  const onResolveDirtyMain = useCallback((paneId: string) => {
    setDirtyMainPaneId(paneId)
  }, [])

  const dirtyMainPane = dirtyMainPaneId
    ? panes.find((p) => p.id === dirtyMainPaneId) ?? null
    : null

  // Same auto-open / click-to-reopen pattern for the conflict state. Distinct
  // pane-tracking refs so transitions into dirty-main and conflict can each
  // open their own modal without one suppressing the other. Only one modal
  // renders at a time because the board checks dirtyMainPane first (exclusive
  // in render order) — that matches the user's recovery flow: resolve main
  // dirtiness, then retry, then handle conflict if one surfaces.
  const [conflictPaneId, setConflictPaneId] = useState<string | null>(null)
  const autoOpenedForConflict = useRef<Set<string>>(new Set())
  const previousConflictPanes = useRef<Set<string>>(new Set())

  useEffect(() => {
    const nowConflict = new Set<string>()
    for (const pane of panes) {
      if (pane.completionStatus?.state === 'conflict') {
        nowConflict.add(pane.id)
      }
    }
    let paneToAutoOpen: string | null = null
    for (const paneId of nowConflict) {
      if (!previousConflictPanes.current.has(paneId)) {
        paneToAutoOpen = paneId
        break
      }
    }
    for (const paneId of autoOpenedForConflict.current) {
      if (!nowConflict.has(paneId)) autoOpenedForConflict.current.delete(paneId)
    }
    if (paneToAutoOpen && !conflictPaneId && !dirtyMainPaneId && !autoOpenedForConflict.current.has(paneToAutoOpen)) {
      autoOpenedForConflict.current.add(paneToAutoOpen)
      setConflictPaneId(paneToAutoOpen)
    }
    previousConflictPanes.current = nowConflict
  }, [panes, conflictPaneId, dirtyMainPaneId])

  const onResolveConflict = useCallback((paneId: string) => {
    setConflictPaneId(paneId)
  }, [])

  const conflictPane = conflictPaneId
    ? panes.find((p) => p.id === conflictPaneId) ?? null
    : null

  return (
    <>
      <div
        className="grid w-full h-full bg-surface"
        style={{
          // Awaiting-orders is a narrow rail (~140px) — the others split the
          // remaining width evenly. Reflects the plan's "compact awaiting rail"
          // requirement.
          gridTemplateColumns: '140px repeat(5, minmax(0, 1fr))',
          gap: 1,
          background: 'var(--color-border-strong)' // hairline column dividers via gap fill
        }}
      >
        {COLUMN_STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            title={columnTitle[status]}
            panes={grouped[status]}
            activePaneId={activePaneId}
            onCardClick={onCardClick}
            onPillClick={onPillClick}
            onCloseCard={onCloseCard}
            onResolveDirtyMain={onResolveDirtyMain}
            onResolveConflict={onResolveConflict}
            cardRefs={cardRefs}
            dropTargetRef={(el) => {
              if (el) dropTargetRefs.current.set(status, el)
              else dropTargetRefs.current.delete(status)
            }}
            compactionDurationMs={compactionDurationMs}
          />
        ))}
      </div>
      {movingCard && <KanbanOverlayCard moving={movingCard} />}
      {pillPane && (
        <ChangesReadyModal
          paneId={pillPane.paneId}
          paneName={pillPane.paneName}
          workspaceId={workspaceId ?? null}
          onClose={() => setPillPane(null)}
        />
      )}
      {dirtyMainPane && (
        <DirtyMainModal
          pane={dirtyMainPane}
          onClose={() => setDirtyMainPaneId(null)}
        />
      )}
      {!dirtyMainPane && conflictPane && (
        <ConflictResolveModal
          pane={conflictPane}
          onClose={() => setConflictPaneId(null)}
        />
      )}
    </>
  )
}
