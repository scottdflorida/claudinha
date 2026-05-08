import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { MergeStrategy, PaneStatus } from '../../shared/types'
import type { RendererPane } from '../hooks/usePaneState'
import { IPC } from '../../shared/ipc-channels'
import { ipcInvoke, ipcSend } from '../hooks/useIpc'
import { KanbanColumn } from './KanbanColumn'
import { ConflictResolveModal } from './ConflictResolveModal'
import { TurnsModal } from './TurnsModal'
import { resolvePaneDisplayName } from '../../shared/pane-display'
import { bucketPaneStatus } from '../../shared/pane-status-bucket'
import { useStrings } from '../lib/strings'
import { useKanbanCardMoves } from '../hooks/useKanbanCardMoves'
import { useColumnOrder } from '../hooks/useColumnOrder'
import { KanbanOverlayCard } from './KanbanOverlayCard'

interface KanbanBoardProps {
  panes: RendererPane[]
  activePaneId: string | null
  /** Workspace owning these panes. Currently unused at this layer; left
   *  in the prop set so call sites that thread workspace context don't
   *  need to be touched when the new completion-actions surfaces wire in. */
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
  return bucketPaneStatus(pane.status, pane.permissionMode)
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

  // Sticky column ordering: panes that stayed in their column keep their
  // slot; panes whose bucket just changed are appended to the bottom of
  // their new column. Without this, panes-array order leaks through and a
  // card moving into a column with an existing card can stack ABOVE that
  // card (apparent "swap"), and the brief slot shift on the resident card
  // makes FLIP animate it on the surrounding renders.
  const grouped = useColumnOrder(displayedPanes, COLUMN_STATUSES, bucketFor)

  // FLIP helper in KanbanColumn syncs its compaction duration to the
  // currently in-flight move (so the source column closes its gap at the
  // same time the moving overlay lands). When no move is in flight, the
  // column uses its fallback constant.
  const compactionDurationMs = movingCard?.durationMs ?? null

  // (M0: dirty-main resolution removed — the v2 turn-as-commit model uses
  // side-clone-based merges, which never touch the user's working tree
  // and so cannot land in dirty-main. Anything previously routed through
  // DirtyMainModal goes away with completion-actions v1.)

  // TurnsModal launcher — kanban-card pill on changes-ready cards opens
  // the per-pane modal. Mirrors the wall-mode CTA's behavior so users in
  // either chrome have a one-click way to reach the new turn surface.
  // M0 removed the legacy ChangesReadyModal launcher; M1 wired the wall
  // path; this restores kanban access.
  const [turnsModalPane, setTurnsModalPane] = useState<{ paneId: string; paneName: string } | null>(null)
  const onPillClick = useCallback((paneId: string, paneName: string) => {
    setTurnsModalPane({ paneId, paneName })
  }, [])

  // Auto-open / click-to-reopen pattern for the conflict state. Conflict
  // is the only completion-state that auto-opens a modal in v2 — dirty-
  // main went away with side-clone merges. M5 will extend
  // ConflictResolveModal to participate in the multi-conflict bulk flow.
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
    if (paneToAutoOpen && !conflictPaneId && !autoOpenedForConflict.current.has(paneToAutoOpen)) {
      autoOpenedForConflict.current.add(paneToAutoOpen)
      setConflictPaneId(paneToAutoOpen)
    }
    previousConflictPanes.current = nowConflict
  }, [panes, conflictPaneId])

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
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
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
            onCloseCard={onCloseCard}
            onResolveConflict={onResolveConflict}
            onPillClick={onPillClick}
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
      {conflictPane && (
        <ConflictResolveModal
          pane={conflictPane}
          onClose={() => setConflictPaneId(null)}
        />
      )}
      {turnsModalPane && (
        <TurnsModal
          paneId={turnsModalPane.paneId}
          paneName={turnsModalPane.paneName}
          workspaceId={workspaceId ?? null}
          onClose={() => setTurnsModalPane(null)}
        />
      )}
    </>
  )
}
