import React from 'react'
import type { PaneStatus } from '../../shared/types'
import { STATUS_COLORS } from '../lib/constants'
import type { RendererPane } from '../hooks/usePaneState'
import { KanbanCard } from './KanbanCard'

// Theme-aware text color for the column header. The hex STATUS_COLORS map is
// dark-mode-tuned (working = near-white) and disappears on the cream
// light-mode column background. These CSS-var references resolve through the
// --color-status-* block in globals.css, so each label picks up its
// theme-appropriate shade (working = #2A2418 dark warm charcoal in light).
const STATUS_TEXT_VAR: Record<PaneStatus, string> = {
  'awaiting-prompt': 'var(--color-status-awaiting)',
  'working':         'var(--color-status-working)',
  'needs-input':     'var(--color-status-needs-input)',
  'done':            'var(--color-status-done)',
  'error':           'var(--color-status-lost)',
}

interface KanbanColumnProps {
  status: PaneStatus
  title: string
  panes: RendererPane[]
  activePaneId: string | null
  onCardClick: (paneId: string) => void
  /** Optional: forwarded to each KanbanCard for the diff-chip click. */
  onDiffClick?: (paneId: string, paneName: string) => void
  /** Optional: forwarded to each KanbanCard's X button. */
  onCloseCard?: (paneId: string) => void
  /** Optional: forwarded to each KanbanCard for the "Main dirty" chip click. */
  onResolveDirtyMain?: (paneId: string) => void
  /** Optional: forwarded to each KanbanCard for the "Conflict" chip click. */
  onResolveConflict?: (paneId: string) => void
  /** Optional: forwarded to each KanbanCard for the "Action failed" chip click. */
  onShowError?: (paneId: string) => void
}

/**
 * One column in the Kanban board.
 *
 * Header text uses the status color so a card and its column share the same
 * visual language as the existing Wall pane border. Empty columns render an
 * em-dash placeholder rather than disappearing — per L-024, structural
 * fixtures must stay visible so users can tell "no agents in this state" from
 * "the column is broken."
 */
export function KanbanColumn({ status, title, panes, activePaneId, onCardClick, onDiffClick, onCloseCard, onResolveDirtyMain, onResolveConflict, onShowError }: KanbanColumnProps): React.JSX.Element {
  const color = STATUS_COLORS[status]
  const count = panes.length
  // Error column gets a subtle red wash + thicker header underline when it has
  // any cards, so stalled agents are impossible to miss on a casual scan.
  const isPopulatedError = status === 'error' && count > 0

  return (
    <section
      aria-label={`${title} (${count})`}
      className="flex flex-col min-w-0 min-h-0"
      style={{
        // Column body uses the theme canvas so it sits correctly in both
        // light and dark mode. Error columns still take a faint red wash
        // blended on top of the canvas.
        background: isPopulatedError ? `${color}0d` : 'var(--color-bg-canvas)'
      }}
    >
      <header
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{
          borderColor: isPopulatedError ? color : 'var(--color-border-strong)',
          borderBottomWidth: isPopulatedError ? 2 : 1
        }}
      >
        <span
          className="text-xs font-[600] uppercase tracking-wider truncate"
          style={{ color: STATUS_TEXT_VAR[status] }}
          title={title}
        >
          {title}
        </span>
        <span
          className="text-xs tabular-nums shrink-0 ml-2"
          style={{ color: isPopulatedError ? color : 'var(--color-fg-muted)' }}
        >
          {count}
        </span>
      </header>

      <div className="kanban-column-viewport flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
        {panes.length === 0 ? (
          <div
            className="flex-1 flex items-center justify-center text-fg-muted text-xs select-none"
            aria-hidden="true"
          >
            —
          </div>
        ) : (
          panes.map((pane) => (
            <KanbanCard
              key={pane.id}
              pane={pane}
              statusColor={color}
              isActive={pane.id === activePaneId}
              onClick={() => onCardClick(pane.id)}
              onDiffClick={onDiffClick ? () => onDiffClick(pane.id, pane.userName || pane.metrics.sessionTitle || pane.worktreeName) : undefined}
              onClose={onCloseCard ? () => onCloseCard(pane.id) : undefined}
              onResolveDirtyMain={onResolveDirtyMain ? () => onResolveDirtyMain(pane.id) : undefined}
              onResolveConflict={onResolveConflict ? () => onResolveConflict(pane.id) : undefined}
              onShowError={onShowError ? () => onShowError(pane.id) : undefined}
            />
          ))
        )}
      </div>
    </section>
  )
}
