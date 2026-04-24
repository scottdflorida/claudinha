import React, { useCallback, useState } from 'react'
import type { PaneStatus } from '../../shared/types'
import type { RendererPane } from '../hooks/usePaneState'
import { KanbanColumn } from './KanbanColumn'
import { DiffViewerModal } from './DiffViewerModal'
import { useStrings } from '../lib/strings'

interface KanbanBoardProps {
  panes: RendererPane[]
  activePaneId: string | null
  onCardClick: (paneId: string) => void
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

export function KanbanBoard({ panes, activePaneId, onCardClick }: KanbanBoardProps): React.JSX.Element {
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
    </>
  )
}
