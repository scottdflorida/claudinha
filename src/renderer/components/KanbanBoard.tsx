import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { PaneStatus } from '../../shared/types'
import type { RendererPane } from '../hooks/usePaneState'
import { KanbanColumn } from './KanbanColumn'
import { DiffViewerModal } from './DiffViewerModal'
import { DirtyMainModal } from './DirtyMainModal'
import { ConflictResolveModal } from './ConflictResolveModal'
import { useStrings } from '../lib/strings'

interface KanbanBoardProps {
  panes: RendererPane[]
  activePaneId: string | null
  onCardClick: (paneId: string) => void
  /** Routes the card-level X through the shared close-pane flow. */
  onCloseCard?: (paneId: string) => void
}

/**
 * Column order follows a left-to-right lifecycle: idle → active → user-blocked
 * → finished → broken. Needs input sits dead center (position 3 of 5) so the
 * "a human is blocking something" column catches the eye on scan without the
 * warm red of Error dominating on first look.
 */
const COLUMN_STATUSES: PaneStatus[] = ['awaiting-prompt', 'working', 'needs-input', 'done', 'error']

/**
 * Per Kanban concept doc, "Error column definition":
 *   - PaneStatus === 'error' → error column
 *   - terminated PTY → error column
 *   - completionActionStatus === 'error' alone (agent healthy) → stays in
 *     `done` with a conflict-state sync indicator. NOT moved here.
 */
function bucketFor(pane: RendererPane): PaneStatus {
  if (pane.status === 'error' || pane.terminated) return 'error'
  return pane.status
}

export function KanbanBoard({ panes, activePaneId, onCardClick, onCloseCard }: KanbanBoardProps): React.JSX.Element {
  const t = useStrings()
  const columnTitle: Record<PaneStatus, string> = {
    'awaiting-prompt': t.kanban.columnAwaitingPrompt,
    'working': t.kanban.columnWorking,
    'needs-input': t.kanban.columnNeedsInput,
    'done': t.kanban.columnDone,
    'error': t.kanban.columnError
  }
  const grouped: Record<PaneStatus, RendererPane[]> = {
    'awaiting-prompt': [],
    'working': [],
    'needs-input': [],
    'done': [],
    'error': []
  }
  for (const pane of panes) {
    grouped[bucketFor(pane)].push(pane)
  }

  // Diff viewer state lives at the board level so the modal overlays the
  // entire window regardless of which card opened it.
  const [diffPane, setDiffPane] = useState<{ paneId: string; paneName: string } | null>(null)
  const onDiffClick = useCallback((paneId: string, paneName: string) => {
    setDiffPane({ paneId, paneName })
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
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
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
            onDiffClick={onDiffClick}
            onCloseCard={onCloseCard}
            onResolveDirtyMain={onResolveDirtyMain}
            onResolveConflict={onResolveConflict}
          />
        ))}
      </div>
      {diffPane && (
        <DiffViewerModal
          paneId={diffPane.paneId}
          paneName={diffPane.paneName}
          onClose={() => setDiffPane(null)}
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
