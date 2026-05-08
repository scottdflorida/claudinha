import React, { useCallback } from 'react'
import type { CompletionActionState, PaneStatus, RailGroupBy } from '../../shared/types'
import { STATUS_COLORS } from '../lib/constants'
import { formatAge } from '../lib/format-age'
import { formatStatusLabel } from './StatusOverlay'
import { formatToolActivity } from '../../shared/tool-activity'
import { useStrings } from '../lib/strings'

const ERROR_COLOR = '#DB4D3F'

interface RailTerminalCardProps {
  paneId: string
  /** Repo display name — only rendered when grouping by status. */
  repoName: string
  /** Resolved agent display name (sessionTitle | userName | worktreeName). */
  agentName: string
  status: PaneStatus
  /** True when the PTY has exited (renders red, "Lost" label override). */
  terminated: boolean
  /** Last completion-flow state — `'error'` paints red regardless of status. */
  completionState: CompletionActionState | null
  /** Live tool name when status === 'working'; populates the activity row. */
  activeToolName: string | null
  /** First user message in the session — fallback content for the second row. */
  initialPrompt: string | null
  /** Epoch ms of the pane's most recent status transition. */
  lastActivityAt: number
  /** Shared ticker so all cards age in lockstep without per-row intervals. */
  now: number
  /** Layout mode for the top row. */
  groupBy: RailGroupBy
  /** True for the workspace's currently active pane — applies the active wash. */
  isActive: boolean
  onClick: () => void
  /** Opens the per-pane TurnsModal. Wired only on changes-ready cards. */
  onViewTurns: () => void
}

/**
 * RailTerminalCard — one card per active pane in the new repo rail.
 *
 * Top row layout depends on `groupBy`:
 *   - 'repo'   → agent name (left) · colored status label (right)
 *   - 'status' → "repo › agent" (left) · 8px colored dot (right)
 *
 * Second-row content depends on status:
 *   - changes-ready → "View turns" link (opens TurnsModal for this pane)
 *   - working       → formatToolActivity(activeToolName) or "Working" fallback
 *   - everything else → initialPrompt, single line, fading to alpha 0 at the
 *     right edge so a long prompt feathers out instead of hard-clipping.
 *
 * The right edge of the second row is reserved for a compact mixed-unit age
 * label ("3h12m") so the user can see staleness at a glance.
 *
 * Errored / terminated panes paint their status color red (matches the
 * existing kanban convention) so a failed agent is visible in either layout.
 */
export function RailTerminalCard({
  repoName,
  agentName,
  status,
  terminated,
  completionState,
  activeToolName,
  initialPrompt,
  lastActivityAt,
  now,
  groupBy,
  isActive,
  onClick,
  onViewTurns
}: RailTerminalCardProps): React.JSX.Element {
  const t = useStrings()
  const errored = terminated || completionState === 'error'
  const accentColor = errored ? ERROR_COLOR : STATUS_COLORS[status]
  const statusLabel = formatStatusLabel(status, activeToolName, terminated, false, t)
  const ageLabel = formatAge(now - lastActivityAt, 'mixed')

  const handleViewTurns = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onViewTurns()
    },
    [onViewTurns]
  )

  const topRow =
    groupBy === 'repo' ? (
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex-1 text-xs font-[500] text-fg-primary truncate" title={agentName}>
          {agentName}
        </span>
        <span
          className="text-[11px] font-[500] shrink-0 truncate max-w-[55%]"
          style={{ color: accentColor }}
          title={statusLabel}
        >
          {statusLabel}
        </span>
      </div>
    ) : (
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="flex-1 text-xs text-fg-primary truncate"
          title={`${repoName} › ${agentName}`}
        >
          <span className="text-fg-muted">{repoName}</span>
          <span className="text-fg-muted"> › </span>
          <span className="font-[500]">{agentName}</span>
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 inline-block rounded-full"
          style={{ width: 8, height: 8, background: accentColor }}
        />
      </div>
    )

  let secondRowContent: React.ReactNode
  if (status === 'changes-ready' && !errored) {
    secondRowContent = (
      <button
        type="button"
        onClick={handleViewTurns}
        className="text-[11px] underline text-warning-fg hover:text-fg-primary transition-colors duration-[80ms]"
      >
        {t.rail.viewTurns}
      </button>
    )
  } else if (status === 'working' && !errored) {
    const verb = activeToolName ? formatToolActivity(activeToolName) : t.kanban.working
    secondRowContent = (
      <span className="text-[11px] text-fg-secondary truncate" title={verb}>
        {verb}
      </span>
    )
  } else {
    const prompt = initialPrompt?.trim() ?? ''
    secondRowContent = prompt ? (
      <span
        className="text-[11px] text-fg-muted truncate min-w-0"
        title={prompt}
        style={{
          maskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent)',
          WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent)'
        }}
      >
        {prompt}
      </span>
    ) : (
      <span className="text-[11px] text-fg-muted italic">—</span>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`
        block w-full text-left px-2 py-1.5 rounded-sm
        transition-colors duration-[80ms]
        focus:outline-none focus-visible:ring-1 focus-visible:ring-accent
        ${isActive
          ? 'bg-[var(--color-row-active)] hover:bg-[var(--color-row-active-hover)]'
          : 'hover:bg-[var(--color-row-hover)]'}
      `}
    >
      {topRow}
      <div className="mt-0.5 flex items-center gap-2 min-w-0">
        <span className="flex-1 min-w-0 flex items-center">
          {secondRowContent}
        </span>
        <span className="text-[11px] text-fg-muted tabular-nums shrink-0">
          {ageLabel}
        </span>
      </div>
    </button>
  )
}
