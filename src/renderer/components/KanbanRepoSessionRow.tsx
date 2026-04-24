import React from 'react'
import type { CompletionActionState, PaneStatus } from '../../shared/types'
import { STATUS_COLORS } from '../lib/constants'
import { formatAge } from '../lib/format-age'

interface KanbanRepoSessionRowProps {
  paneId: string
  /** Display name for the agent (sessionTitle | worktreeName | userName fallback chain). */
  name: string
  status: PaneStatus
  /**
   * Completion-flow state if the pane has been acted on (merge/PR).
   * Used to overlay a failure colour on the status dot when the last merge
   * attempt landed in `'error'`, so the user can spot the failed tree in
   * the rail without opening its action bar.
   */
  completionState?: CompletionActionState | null
  isActive: boolean
  linesAdded: number
  linesRemoved: number
  /** Timestamp of the pane's most recent status transition. */
  lastActivityAt: number
  /**
   * Shared "now" passed from the parent so every row in the rail ticks in
   * lockstep and we don't spin a per-row interval. Millisecond epoch.
   */
  now: number
  onClick: () => void
}

/**
 * One session entry inside a KanbanRepoCard's collapsible list.
 *
 * Click → set the workspace's active pane (same effect as clicking a card on
 * the top board). Active row gets a faint outline so the user knows where
 * they are in the rail.
 *
 * The right-hand slot shows the diff size (`+A −B`) when the pane has any
 * changes vs base, and falls back to the time-since-last-activity otherwise.
 * Branch name used to live here but was almost always identical to the
 * worktree name shown on the left, so it's been removed.
 */
export function KanbanRepoSessionRow({
  name,
  status,
  completionState,
  isActive,
  linesAdded,
  linesRemoved,
  lastActivityAt,
  now,
  onClick
}: KanbanRepoSessionRowProps): React.JSX.Element {
  const dotColor =
    completionState === 'error' ? STATUS_COLORS.error : STATUS_COLORS[status]
  const showDiff = linesAdded > 0 || linesRemoved > 0
  const ageLabel = formatAge(now - lastActivityAt)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`
        w-full text-left flex items-center gap-2 px-2 py-1 rounded-sm
        transition-colors duration-[80ms]
        focus:outline-none focus-visible:ring-1 focus-visible:ring-accent
        ${isActive
          ? 'bg-[var(--color-row-active)] hover:bg-[var(--color-row-active-hover)]'
          : 'hover:bg-[var(--color-row-hover)]'}
      `}
    >
      <span
        aria-hidden="true"
        className="shrink-0 inline-block rounded-full"
        style={{ width: 8, height: 8, background: dotColor }}
      />
      <span className="text-xs text-fg-primary truncate flex-1" title={name}>
        {name}
      </span>
      {showDiff ? (
        <span className="text-[11px] tabular-nums shrink-0">
          <span className="text-success-fg">+{linesAdded}</span>
          <span className="text-fg-muted"> </span>
          <span className="text-danger-fg">−{linesRemoved}</span>
        </span>
      ) : (
        <span className="text-[11px] text-fg-muted tabular-nums shrink-0">
          {ageLabel}
        </span>
      )}
    </button>
  )
}
