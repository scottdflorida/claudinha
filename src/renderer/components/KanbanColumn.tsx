import React, { useRef } from 'react'
import type { PaneStatus } from '../../shared/types'
import { STATUS_COLORS } from '../lib/constants'
import type { RendererPane } from '../hooks/usePaneState'
import { KanbanCard } from './KanbanCard'
import { useFlipChildren } from '../lib/flip'
import { KANBAN_COMPACT_MS } from '../lib/kanbanMotion'

// Theme-aware text color for the column header. The hex STATUS_COLORS map is
// dark-mode-tuned (working = near-white) and disappears on the cream
// light-mode column background. These CSS-var references resolve through the
// --color-status-* block in globals.css, so each label picks up its
// theme-appropriate shade (working = #2A2418 dark warm charcoal in light).
const STATUS_TEXT_VAR: Record<PaneStatus, string> = {
  'awaiting-prompt': 'var(--color-status-awaiting)',
  'planning':        'var(--color-status-plan)',
  'plan-ready':      'var(--color-status-plan)',
  'needs-input':     'var(--color-status-needs-input)',
  'working':         'var(--color-status-working)',
  'changes-ready':   'var(--color-status-done)',
}

interface KanbanColumnProps {
  status: PaneStatus
  title: string
  panes: RendererPane[]
  activePaneId: string | null
  onCardClick: (paneId: string) => void
  /** Optional: forwarded to each KanbanCard's X button. */
  onCloseCard?: (paneId: string) => void
  /** Optional: forwarded to each KanbanCard for the "Main dirty" chip click. */
  /** Optional: forwarded to each KanbanCard for the "Conflict" chip click. */
  onResolveConflict?: (paneId: string) => void
  /**
   * Shared per-pane DOM-element registry. Each KanbanCard registers its
   * outermost element here on mount/unmount so useKanbanCardMoves can read
   * `getBoundingClientRect()` for the source position when starting a move.
   */
  cardRefs?: React.MutableRefObject<Map<string, HTMLElement | null>>
  /**
   * Bottom drop-target ref. KanbanBoard uses this to measure where a card
   * should land in this column (always the bottom). Renders as a 1px-tall
   * invisible spacer below the last card.
   */
  dropTargetRef?: (el: HTMLElement | null) => void
  /**
   * If a card move is currently in flight, the duration to use for FLIP
   * compaction so the source column's gap-closing animation lands at the
   * same time as the moving overlay. When null, falls back to KANBAN_COMPACT_MS.
   */
  compactionDurationMs?: number | null
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
export function KanbanColumn({ status, title, panes, activePaneId, onCardClick, onCloseCard, onResolveConflict, cardRefs, dropTargetRef, compactionDurationMs }: KanbanColumnProps): React.JSX.Element {
  const color = STATUS_COLORS[status]
  const count = panes.length
  // Error column was removed in the new design — error highlight now lives on
  // PaneBorder driven by `terminated`/`completionStatus.state === 'error'`.
  const isPopulatedError = false

  // Local map of paneId -> wrapper div for FLIP. Mirrors any registrations
  // into the parent-shared cardRefs map (used by useKanbanCardMoves to
  // measure source rect at move-start).
  const localRefs = useRef<Map<string, HTMLElement | null>>(new Map())
  const visiblePaneIds = panes.map((p) => p.id)
  useFlipChildren(localRefs, visiblePaneIds, compactionDurationMs ?? KANBAN_COMPACT_MS)

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
          <>
            {/* Drop-target FIRST so its rect anchors at top + padding —
                exactly where the next card will be rendered when it
                arrives. Putting it after a flex-1 placeholder pushes it
                to the bottom of the viewport, which made cards moving
                into empty columns animate to the wrong landing slot. */}
            <div
              ref={dropTargetRef}
              aria-hidden="true"
              style={{ height: 0, flexShrink: 0 }}
            />
            <div
              className="flex-1 flex items-center justify-center text-fg-muted text-xs select-none"
              aria-hidden="true"
            >
              —
            </div>
          </>
        ) : (
          <>
            {panes.map((pane) => (
              <div
                key={pane.id}
                ref={(el) => {
                  // Register in both the local FLIP map and the parent-shared
                  // map (used by useKanbanCardMoves to measure the source rect
                  // when a move starts). On unmount, drop from local; for the
                  // shared registry only drop if it still points at our node
                  // (a remount in another column may already have overwritten).
                  const prevLocal = localRefs.current.get(pane.id) ?? null
                  if (el) {
                    localRefs.current.set(pane.id, el)
                    if (cardRefs) cardRefs.current.set(pane.id, el)
                  } else {
                    localRefs.current.delete(pane.id)
                    if (cardRefs && prevLocal && cardRefs.current.get(pane.id) === prevLocal) {
                      cardRefs.current.delete(pane.id)
                    }
                  }
                }}
              >
                <KanbanCard
                  pane={pane}
                  statusColor={color}
                  isActive={pane.id === activePaneId}
                  onClick={() => onCardClick(pane.id)}
                  onClose={onCloseCard ? () => onCloseCard(pane.id) : undefined}
                  onResolveConflict={onResolveConflict ? () => onResolveConflict(pane.id) : undefined}
                />
              </div>
            ))}
            {/* Drop target sits below the cards = "next slot" position. */}
            <div
              ref={dropTargetRef}
              aria-hidden="true"
              style={{ height: 0, flexShrink: 0 }}
            />
          </>
        )}
      </div>
    </section>
  )
}
