import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import type { PaneStatus, ReadyPaneEntry, RepoRollup } from '../../shared/types'
import { STATUS_COLORS } from '../lib/constants'
import { KanbanRepoSessionRow } from './KanbanRepoSessionRow'
import { useStrings } from '../lib/strings'

interface KanbanRepoCardProps {
  rollup: RepoRollup
  /** All workspace panes belonging to this repo (filtered upstream). */
  panes: ReadyPaneEntry[]
  /** Currently active pane in the workspace; used to highlight the matching row. */
  activePaneId: string | null
  /** Click handler for a session row → set active pane. */
  onSelectSession: (paneId: string) => void
  /** Phase 6 will wire these. Phase 5 leaves them all disabled. */
  onMerge?: () => void
  onPush?: () => void
  onMergeAndPush?: () => void
  /** Opens one regular (non-draft) PR per ready tree in this repo. */
  onCreatePr?: () => void
  /** Phase 7 will wire this. Phase 5 disables. */
  onEditClaudeMd?: () => void
  /**
   * Start the plan-approval sequencer for this repo. Shown only when ≥ 2
   * trees are sitting on Claude Code's plan-approval picker at once.
   */
  onApprovePlansInSequence?: () => void
  /** Cancel pending approvals mid-sequence. In-flight pane is left alone. */
  onStopPlanSequence?: () => void
  /**
   * Re-run the merge for every tree in this repo whose last attempt landed
   * in `completionActionStatus.state === 'error'`. Shown only when
   * `rollup.erroredCount > 0`.
   */
  onRetryFailedMerges?: () => void
}

/**
 * Group the repo's panes by status to render the small "status dot" row in
 * the card header.
 */
function statusBreakdown(panes: ReadyPaneEntry[]): Array<{ status: PaneStatus; count: number }> {
  const counts: Record<PaneStatus, number> = {
    'awaiting-prompt': 0,
    'working': 0,
    'needs-input': 0,
    'done': 0,
    'error': 0
  }
  for (const p of panes) counts[p.paneStatus] = (counts[p.paneStatus] ?? 0) + 1
  return (Object.entries(counts) as [PaneStatus, number][])
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }))
}

/**
 * One repo card in the Kanban repo rail.
 *
 * Header: repo name + base branch + line rollup + status dots.
 * Body: bulk-action button row (Merge / Push / Merge + push) + collapsible
 *       session list (default expanded — concept doc decision 2).
 *
 * Phase 5 stubs the bulk-action handlers. Phase 6 wires them with their
 * enable predicates and IPC plumbing.
 */
export function KanbanRepoCard({
  rollup,
  panes,
  activePaneId,
  onSelectSession,
  onMerge,
  onPush,
  onMergeAndPush,
  onCreatePr,
  onEditClaudeMd,
  onApprovePlansInSequence,
  onStopPlanSequence,
  onRetryFailedMerges
}: KanbanRepoCardProps): React.JSX.Element {
  const t = useStrings()
  const [expanded, setExpanded] = useState(true) // default expanded (decision 2)
  const breakdown = statusBreakdown(panes)
  const baseBranch =
    panes.find((p) => p.branchName === 'main' || p.branchName === 'master')?.branchName ?? null

  // Phase 5 leaves bulk actions disabled — Phase 6 supplies real predicates.
  const mergeDisabled = !onMerge
  const pushDisabled = !onPush
  const mergePushDisabled = !onMergeAndPush
  const createPrDisabled = !onCreatePr
  const editDisabled = !onEditClaudeMd

  // "Approve plans in sequence" row — only visible when either the sequencer
  // is actively running (so the user can stop it) or at least two trees are
  // waiting on the plan-approval picker simultaneously.
  const showApproveInSequenceRow =
    rollup.planSequencerRunning || rollup.awaitingPlanApprovalCount >= 2

  // "Retry failed merges" row — visible whenever any tree's last merge
  // attempt in this repo landed in `state === 'error'`. Conflict and
  // dirty-main have their own per-pane recovery flows and are excluded
  // upstream in the rollup count.
  const showRetryFailedRow = rollup.erroredCount > 0

  const handleToggle = useCallback(() => setExpanded((v) => !v), [])

  // Shared "now" that ticks every 30s so every row's last-activity label
  // ages in lockstep without spawning a per-row interval. Summary broadcasts
  // from the inspector already re-render on status transitions; this timer
  // is just the steady-state fallback for panes that haven't transitioned.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <section
      className="rounded-md bg-overlay border border-[var(--color-border-subtle)] overflow-hidden"
      aria-label={t.kanban.repoCardAriaFmt(rollup.repoLabel)}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={handleToggle}
            aria-label={expanded ? t.kanban.collapseSessionList : t.kanban.expandSessionList}
            aria-expanded={expanded}
            className="text-fg-muted hover:text-fg-primary shrink-0"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <span className="text-xs font-[600] text-fg-primary truncate" title={rollup.repoLabel}>
            {rollup.repoLabel}
          </span>
          {baseBranch && (
            <span className="text-[11px] text-fg-muted truncate" title={baseBranch}>
              · {baseBranch}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onEditClaudeMd}
          disabled={editDisabled}
          aria-label={t.kanban.editClaudeMdAria}
          title={editDisabled ? t.kanban.editClaudeMdDisabled : t.kanban.editClaudeMdEnabled}
          className="shrink-0 text-fg-muted hover:text-fg-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Pencil size={12} />
        </button>
      </header>

      {/* Rollup line: pane count · +N -M · status dots */}
      <div className="px-3 py-1.5 flex items-center gap-3 text-[11px] text-fg-muted tabular-nums border-b border-[var(--color-border-subtle)]">
        <span>{rollup.paneCount} {t.kanban.agentsPlural(rollup.paneCount)}</span>
        {(rollup.totalLinesAdded > 0 || rollup.totalLinesRemoved > 0) && (
          <span>
            <span className="text-success-fg">+{rollup.totalLinesAdded}</span>
            {' '}
            <span className="text-danger-fg">−{rollup.totalLinesRemoved}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {breakdown.map(({ status, count }) => (
            <span
              key={status}
              className="inline-flex items-center gap-1"
              title={`${count} ${status}`}
            >
              <span
                aria-hidden="true"
                className="inline-block rounded-full"
                style={{ width: 6, height: 6, background: STATUS_COLORS[status] }}
              />
              <span>{count}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Bulk-action buttons — two rows of two. Each button is enabled only
          when its action would have effect (concept doc — decision 4).
          Disabled tooltips explain why. Four text buttons don't fit cleanly
          on one row in the 280 px rail, so row 1 is Merge / Push and row 2
          is Merge + push / Create PR. Collapses with the repo chevron so a
          collapsed card shrinks to header + rollup only. */}
      {expanded && (
        <div className="px-3 py-2 flex flex-col gap-1.5 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-1.5">
            <ActionButton
              label={t.kanban.mergeAction}
              disabled={mergeDisabled}
              tooltip={mergeDisabled ? t.kanban.mergeNoneReady : t.kanban.mergeReady}
              onClick={onMerge}
            />
            <ActionButton
              label={t.kanban.pushAction}
              disabled={pushDisabled}
              tooltip={pushDisabled ? t.kanban.pushNothing : t.kanban.pushReady}
              onClick={onPush}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <ActionButton
              label={t.kanban.mergePushAction}
              disabled={mergePushDisabled}
              tooltip={mergePushDisabled ? t.kanban.mergePushNothing : t.kanban.mergePushReady}
              onClick={onMergeAndPush}
            />
            <ActionButton
              label={t.kanban.createPrAction}
              disabled={createPrDisabled}
              tooltip={createPrDisabled ? t.kanban.createPrNone : t.kanban.createPrReady}
              onClick={onCreatePr}
            />
          </div>
          {showApproveInSequenceRow && (
            <div className="flex items-center gap-1.5">
              {rollup.planSequencerRunning ? (
                <ActionButton
                  label={t.kanban.stopSequence}
                  tooltip={t.kanban.stopSequenceTooltip}
                  onClick={onStopPlanSequence}
                />
              ) : (
                <ActionButton
                  label={t.kanban.approveInSequence}
                  tooltip={t.kanban.approveInSequenceTooltip}
                  onClick={onApprovePlansInSequence}
                />
              )}
            </div>
          )}
          {showRetryFailedRow && (
            <div className="flex items-center gap-1.5">
              <ActionButton
                label={t.kanban.retryFailedMerges}
                tooltip={t.kanban.retryFailedMergesTooltip}
                onClick={onRetryFailedMerges}
              />
            </div>
          )}
        </div>
      )}

      {/* Sessions list (default expanded; collapsible at the repo level) */}
      {expanded && (
        <ul className="flex flex-col py-1.5 px-1.5 gap-0.5">
          {panes.length === 0 ? (
            <li className="text-[11px] text-fg-muted px-2 py-1">{t.kanban.noActiveAgents}</li>
          ) : (
            panes.map((p) => (
              <li key={p.paneId}>
                <KanbanRepoSessionRow
                  paneId={p.paneId}
                  name={p.paneName}
                  status={p.paneStatus}
                  completionState={p.completionState}
                  isActive={activePaneId === p.paneId}
                  linesAdded={p.linesAdded}
                  linesRemoved={p.linesRemoved}
                  lastActivityAt={p.lastActivityAt}
                  now={now}
                  onClick={() => onSelectSession(p.paneId)}
                />
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  )
}

interface ActionButtonProps {
  label: string
  disabled?: boolean
  tooltip?: string
  onClick?: () => void
}

function ActionButton({ label, disabled, tooltip, onClick }: ActionButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={`
        flex-1 text-[11px] px-2 py-1 rounded-sm border border-[var(--color-border-subtle)]
        transition-colors duration-[80ms]
        ${disabled
          ? 'opacity-40 cursor-not-allowed text-fg-muted'
          : 'text-fg-secondary hover:text-fg-primary hover:bg-overlay cursor-pointer'}
      `}
    >
      {label}
    </button>
  )
}
