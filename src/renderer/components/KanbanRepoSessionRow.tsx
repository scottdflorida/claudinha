import React from 'react'
import type { CompletionActionState, PaneStatus } from '../../shared/types'
import { STATUS_COLORS } from '../lib/constants'

interface KanbanRepoSessionRowProps {
  paneId: string
  /** Display name for the agent (sessionTitle | worktreeName | userName fallback chain). */
  name: string
  /** Branch name if known — small dim suffix. */
  branchName: string | null
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
  onClick: () => void
}

/**
 * One session entry inside a KanbanRepoCard's collapsible list.
 *
 * Click → set the workspace's active pane (same effect as clicking a card on
 * the top board). Active row gets a faint outline so the user knows where
 * they are in the rail.
 */
export function KanbanRepoSessionRow({
  name,
  branchName,
  status,
  completionState,
  isActive,
  linesAdded,
  linesRemoved,
  onClick
}: KanbanRepoSessionRowProps): React.JSX.Element {
  // Recolour the status dot red when the pane's last merge attempt failed
  // with a generic error (as opposed to a conflict or dirty-main situation,
  // both of which need manual recovery on the CompletionActionBar and stay
  // on the regular done-dot so they don't look like "retry me").
  const dotColor =
    completionState === 'error' ? STATUS_COLORS.error : STATUS_COLORS[status]
  const showDiff = linesAdded > 0 || linesRemoved > 0
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`
        w-full text-left flex items-center gap-2 px-2 py-1 rounded-sm
        transition-colors duration-[80ms]
        hover:bg-overlay focus:outline-none focus-visible:ring-1 focus-visible:ring-accent
        ${isActive ? 'bg-overlay' : ''}
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
      {branchName && (
        <span className="text-[11px] text-fg-muted truncate max-w-[35%]" title={branchName}>
          {branchName}
        </span>
      )}
      {showDiff && (
        <span className="text-[11px] tabular-nums shrink-0">
          <span className="text-success-fg">+{linesAdded}</span>
          <span className="text-fg-muted"> </span>
          <span className="text-danger-fg">−{linesRemoved}</span>
        </span>
      )}
    </button>
  )
}
