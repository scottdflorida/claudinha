import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, GitMerge } from 'lucide-react'
import type { ReadyPaneEntry, RepoRollup } from '../../shared/types'
import { KanbanRepoSessionRow } from './KanbanRepoSessionRow'
import { RepoChangesModal } from './RepoChangesModal'
import { useStrings } from '../lib/strings'

interface KanbanRepoCardProps {
  rollup: RepoRollup
  /** Workspace this repo card lives in — needed to open the per-repo
   *  RepoChangesModal which scopes its aggregation by (workspace, repo). */
  workspaceId: string
  /** All workspace panes belonging to this repo (filtered upstream). */
  panes: ReadyPaneEntry[]
  /** Currently active pane in the workspace; used to highlight the matching row. */
  activePaneId: string | null
  /** Click handler for a session row → set active pane. */
  onSelectSession: (paneId: string) => void
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
 * One repo card in the Kanban repo rail.
 *
 * Header: repo name + base branch + claude.md edit affordance.
 * Body: collapsible session list (default expanded — concept doc decision 2),
 *       plus narrow recovery affordances (approve-in-sequence, retry-failed-
 *       merges) that surface only when their conditions hold.
 */
export function KanbanRepoCard({
  rollup,
  workspaceId,
  panes,
  activePaneId,
  onSelectSession,
  onEditClaudeMd,
  onApprovePlansInSequence,
  onStopPlanSequence,
  onRetryFailedMerges
}: KanbanRepoCardProps): React.JSX.Element {
  const t = useStrings()
  const [expanded, setExpanded] = useState(true) // default expanded (decision 2)
  const [repoModalOpen, setRepoModalOpen] = useState(false)
  const baseBranch =
    panes.find((p) => p.branchName === 'main' || p.branchName === 'master')?.branchName ?? null

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
      className="rounded-md bg-overlay border border-[var(--color-border-subtle)] overflow-hidden flex flex-col min-h-0 max-h-full"
      aria-label={t.kanban.repoCardAriaFmt(rollup.repoLabel)}
    >
      <header className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)]">
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

        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRepoModalOpen(true)}
            aria-label={`Review changes for ${rollup.repoLabel}`}
            title="Review per-agent turns and bulk-publish across this repo"
            className="flex items-center gap-1 text-fg-muted hover:text-fg-primary"
          >
            <span className="text-[11px]">changes</span>
            <GitMerge size={12} />
          </button>
          <button
            type="button"
            onClick={onEditClaudeMd}
            disabled={editDisabled}
            aria-label={t.kanban.editClaudeMdAria}
            title={editDisabled ? t.kanban.editClaudeMdDisabled : t.kanban.editClaudeMdEnabled}
            className="flex items-center gap-1 text-fg-muted hover:text-fg-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-[11px]">claude.md</span>
            <FileText size={12} />
          </button>
        </div>
      </header>
      {repoModalOpen && (
        <RepoChangesModal
          workspaceId={workspaceId}
          repoPath={rollup.repoPath}
          onClose={() => setRepoModalOpen(false)}
        />
      )}

      {/* Recovery affordances — only render when their narrow conditions
          hold (a plan-approval pile-up, or one or more trees in a failed
          merge state). Collapses with the repo chevron. */}
      {expanded && (showApproveInSequenceRow || showRetryFailedRow) && (
        <div className="shrink-0 px-3 py-2 flex flex-col gap-1.5 border-b border-[var(--color-border-subtle)]">
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
                tooltip={`${t.kanban.retryFailedMergesTooltip} ${t.merge.autoCommitNote}`}
                onClick={onRetryFailedMerges}
              />
            </div>
          )}
        </div>
      )}

      {/* Sessions list (default expanded; collapsible at the repo level).
          flex-1 min-h-0 overflow-y-auto: the agent list is the only growing
          child, so the card's header / rollup / bulk-action buttons stay
          visible regardless of agent count, and the list scrolls inside the
          card once the agents would push it past the rail's available height
          (e.g. 20-agent workspace with one repo). */}
      {expanded && (
        <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col py-1.5 px-1.5 gap-0.5">
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
