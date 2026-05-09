import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, GitMerge } from 'lucide-react'
import type { PaneStatus, RailGroupBy, ReadyPaneEntry, RepoRollup } from '../../shared/types'
import { useInspector } from '../hooks/useInspector'
import { usePaneState } from '../hooks/usePaneState'
import { useAppConfig } from '../hooks/useAppConfig'
import { resolvePaneDisplayName } from '../../shared/pane-display'
import { bucketPaneStatus } from '../../shared/pane-status-bucket'
import { STATUS_COLORS } from '../lib/constants'
import { RailTerminalCard } from './RailTerminalCard'
import { RepoChangesModal } from './RepoChangesModal'
import { TurnsModal } from './TurnsModal'
import { Button } from './ui/Button'
import { SegmentedControl } from './ui/SegmentedControl'
import { useStrings } from '../lib/strings'
import type { Strings } from '../lib/strings'

interface KanbanRepoRailProps {
  workspaceId: string | undefined
  /** Currently active pane in Kanban view (highlights the matching session row). */
  activePaneId: string | null
  /** Callback when the user clicks a session row in any repo card. */
  onSelectSession: (paneId: string) => void
  /** Opens the AddTerminalsDialog to add one or more terminals to this workspace. */
  onSpawnClick: () => void
}

/**
 * Status order used by the "Group by status" mode. Action-priority first so
 * the most-attention-needing buckets sit at the top of the rail. Statuses
 * with zero panes in the workspace are hidden entirely.
 */
const STATUS_ORDER: PaneStatus[] = [
  'changes-ready',
  'needs-input',
  'working',
  'planning',
  'plan-ready',
  'awaiting-prompt'
]

/**
 * KanbanRepoRail — left rail in Kanban view.
 *
 * Top chrome:  [+ Terminal] button, then a Group By segmented control.
 * Body:        per-pane cards (`RailTerminalCard`), grouped either by repo
 *              (collapsible repo headers with a "changes" affordance) or by
 *              status (collapsible status headers in action-priority order).
 *
 * Subscribes to:
 *   - INSPECTOR_SUMMARY via `useInspector` for repo rollups + per-pane
 *     status/repo/lastActivityAt.
 *   - PaneState for the live `activeToolName` and `metrics.initialPrompt`
 *     (the inspector summary doesn't carry these).
 */
export function KanbanRepoRail({
  workspaceId,
  activePaneId,
  onSelectSession,
  onSpawnClick
}: KanbanRepoRailProps): React.JSX.Element {
  const t = useStrings()
  const { summary } = useInspector(workspaceId ?? null)
  const { panes: livePanes } = usePaneState()
  const { config: appConfig, setConfig: setAppConfig } = useAppConfig()
  const groupBy: RailGroupBy = appConfig.rail?.groupBy ?? 'repo'

  // Modal state — TurnsModal launcher (changes-ready cards) and the per-repo
  // RepoChangesModal (changes button on a repo group header).
  const [turnsModalPane, setTurnsModalPane] = useState<{ paneId: string; paneName: string } | null>(null)
  const [repoModalPath, setRepoModalPath] = useState<string | null>(null)

  // Shared "now" that ticks every 30s so every card's age label ages in
  // lockstep without spawning a per-card interval.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // Animated "Working." → "Working.." → "Working..." cycle for Planning /
  // Working status labels in repo-grouped mode. Hoisted here so every card
  // ticks in lockstep against one interval.
  const [animatedDots, setAnimatedDots] = useState<1 | 2 | 3>(1)
  useEffect(() => {
    const timer = setInterval(() => {
      setAnimatedDots((d) => ((d % 3) + 1) as 1 | 2 | 3)
    }, 500)
    return () => clearInterval(timer)
  }, [])

  // Lookup map for live RendererPane data (activeToolName, initialPrompt).
  // The inspector summary's ReadyPaneEntry doesn't carry these fields.
  const liveByPaneId = useMemo(() => {
    const map = new Map<string, (typeof livePanes)[number]>()
    for (const p of livePanes) map.set(p.id, p)
    return map
  }, [livePanes])

  const handleGroupByChange = (next: RailGroupBy): void => {
    if (next === groupBy) return
    setAppConfig({ rail: { ...(appConfig.rail ?? { widthPx: 280, groupBy: 'repo' }), groupBy: next } })
      .catch((err) => console.warn('[KanbanRepoRail] persist groupBy failed', err))
  }

  // Top chrome — rendered above whatever body the rail is showing so
  // structure is stable across empty / loading / no-workspace states.
  const railHeader = (
    <div className="shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2 border-b border-[var(--color-border-subtle)]">
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={onSpawnClick}
        aria-label={t.kanban.newTerminalAria}
        className="w-full"
        disabled={!workspaceId}
      >
        {t.kanban.railNewTerminalButton}
      </Button>
      <SegmentedControl<RailGroupBy>
        size="sm"
        value={groupBy}
        onChange={handleGroupByChange}
        options={[
          { value: 'repo', label: t.rail.groupByRepo },
          { value: 'status', label: t.rail.groupByStatus }
        ]}
      />
    </div>
  )

  if (!workspaceId) {
    return (
      <div className="h-full flex flex-col">
        {railHeader}
        <div className="p-4 text-xs text-fg-muted">{t.kanban.railNoWorkspace}</div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="h-full flex flex-col">
        {railHeader}
        <div className="p-4 text-xs text-fg-muted">{t.kanban.railLoading}</div>
      </div>
    )
  }

  if (summary.repos.length === 0 || summary.panes.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {railHeader}
        <div className="p-4 text-xs text-fg-muted">{t.rail.emptyRail}</div>
      </div>
    )
  }

  // Resolve the bucketed status the rail should display + group by. Mirrors
  // the kanban board's bucketFor: a pane in plan mode runs `working` tools
  // but belongs in the Planning bucket. Falls back to `entry.paneStatus`
  // when the live pane hasn't been seeded yet (e.g. mid-spawn race).
  const bucketedStatusFor = (entry: ReadyPaneEntry): PaneStatus => {
    const live = liveByPaneId.get(entry.paneId)
    const mode = live?.permissionMode ?? 'normal'
    return bucketPaneStatus(entry.paneStatus, mode)
  }

  // Card factory shared between both grouping modes.
  const renderCard = (entry: ReadyPaneEntry): React.JSX.Element => {
    const live = liveByPaneId.get(entry.paneId)
    const agentName = live
      ? resolvePaneDisplayName({
          worktreeName: live.worktreeName,
          userName: live.userName,
          metrics: { sessionTitle: live.metrics.sessionTitle }
        })
      : entry.paneName
    return (
      <RailTerminalCard
        key={entry.paneId}
        paneId={entry.paneId}
        repoName={entry.repoName}
        agentName={agentName}
        status={bucketedStatusFor(entry)}
        terminated={live?.terminated ?? false}
        completionState={entry.completionState}
        activeToolName={live?.activeToolName ?? null}
        initialPrompt={live?.metrics.initialPrompt ?? null}
        lastMessage={live?.metrics.lastMessage ?? null}
        lastActivityAt={entry.lastActivityAt}
        now={now}
        groupBy={groupBy}
        isActive={activePaneId === entry.paneId}
        onClick={() => onSelectSession(entry.paneId)}
        onViewTurns={() => setTurnsModalPane({ paneId: entry.paneId, paneName: agentName })}
        animatedDots={animatedDots}
      />
    )
  }

  return (
    <>
      <div className="h-full flex flex-col">
        {railHeader}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
          {groupBy === 'repo'
            ? summary.repos.map((rollup) => {
                const repoPanes = summary.panes.filter((p) => p.repoPath === rollup.repoPath)
                return (
                  <RepoGroup
                    key={rollup.repoPath}
                    rollup={rollup}
                    repoPanes={repoPanes}
                    onOpenRepoChanges={() => setRepoModalPath(rollup.repoPath)}
                    renderCard={renderCard}
                  />
                )
              })
            : STATUS_ORDER.map((status) => {
                const statusPanes = summary.panes.filter(
                  (p) => bucketedStatusFor(p) === status
                )
                if (statusPanes.length === 0) return null
                statusPanes.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
                return (
                  <StatusGroup
                    key={status}
                    status={status}
                    label={STATUS_GROUP_LABEL[status](t)}
                    color={STATUS_COLORS[status]}
                    panes={statusPanes}
                    renderCard={renderCard}
                  />
                )
              })}
        </div>
      </div>
      {repoModalPath && workspaceId && (
        <RepoChangesModal
          workspaceId={workspaceId}
          repoPath={repoModalPath}
          onClose={() => setRepoModalPath(null)}
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

// ---------------------------------------------------------------------------
// Repo group (Group by Repo)
// ---------------------------------------------------------------------------

interface RepoGroupProps {
  rollup: RepoRollup
  repoPanes: ReadyPaneEntry[]
  onOpenRepoChanges: () => void
  renderCard: (entry: ReadyPaneEntry) => React.JSX.Element
}

function RepoGroup({ rollup, repoPanes, onOpenRepoChanges, renderCard }: RepoGroupProps): React.JSX.Element {
  const t = useStrings()
  const [expanded, setExpanded] = useState(true)
  const baseBranch =
    repoPanes.find((p) => p.branchName === 'main' || p.branchName === 'master')?.branchName ?? null

  return (
    <section
      className="rounded-md bg-overlay border border-[var(--color-border-subtle)] overflow-hidden flex flex-col"
      aria-label={t.kanban.repoCardAriaFmt(rollup.repoLabel)}
    >
      <header className="shrink-0 flex items-center justify-between gap-2 px-2 py-1.5 border-b border-[var(--color-border-subtle)]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t.kanban.collapseSessionList : t.kanban.expandSessionList}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 min-w-0 text-fg-muted hover:text-fg-primary"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="text-xs font-[600] text-fg-primary truncate" title={rollup.repoLabel}>
            {rollup.repoLabel}
          </span>
          {baseBranch && (
            <span className="text-[11px] text-fg-muted truncate" title={baseBranch}>
              · {baseBranch}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenRepoChanges}
          aria-label={`Bulk Change for ${rollup.repoLabel}`}
          title="Review per-agent turns and bulk-publish across this repo"
          className="flex items-center gap-1 text-fg-muted hover:text-fg-primary shrink-0"
        >
          <span className="text-[11px]">Bulk Change</span>
          <GitMerge size={12} />
        </button>
      </header>
      {expanded && (
        <ul className="flex flex-col py-1 px-1 gap-0.5">
          {repoPanes.length === 0 ? (
            <li className="text-[11px] text-fg-muted px-2 py-1">{t.kanban.noActiveAgents}</li>
          ) : (
            repoPanes.map((entry) => <li key={entry.paneId}>{renderCard(entry)}</li>)
          )}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Status group (Group by Status)
// ---------------------------------------------------------------------------

interface StatusGroupProps {
  status: PaneStatus
  label: string
  /** Status color — applied to the section header label so each status reads
   *  in its own hue (the same hue used by the kanban column titles). */
  color: string
  panes: ReadyPaneEntry[]
  renderCard: (entry: ReadyPaneEntry) => React.JSX.Element
}

function StatusGroup({ label, color, panes, renderCard }: StatusGroupProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  return (
    <section className="rounded-md bg-overlay border border-[var(--color-border-subtle)] overflow-hidden flex flex-col">
      <header className="shrink-0 flex items-center justify-between gap-2 px-2 py-1.5 border-b border-[var(--color-border-subtle)]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 min-w-0 text-fg-muted hover:text-fg-primary"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span
            className="text-xs font-[600] uppercase tracking-wide truncate"
            style={{ color }}
          >
            {label}
          </span>
          <span className="text-[11px] text-fg-muted tabular-nums">{panes.length}</span>
        </button>
      </header>
      {expanded && (
        <ul className="flex flex-col py-1 px-1 gap-0.5">
          {panes.map((entry) => <li key={entry.paneId}>{renderCard(entry)}</li>)}
        </ul>
      )}
    </section>
  )
}

// Reuses the existing kanban column strings so the rail and the (still-
// present) kanban board agree on every status's display name.
const STATUS_GROUP_LABEL: Record<PaneStatus, (t: Strings) => string> = {
  'awaiting-prompt': (t) => t.kanban.columnAwaitingOrders,
  planning: (t) => t.kanban.columnPlanning,
  'plan-ready': (t) => t.kanban.columnPlanReady,
  'needs-input': (t) => t.kanban.columnNeedsInput,
  working: (t) => t.kanban.columnWorking,
  'changes-ready': (t) => t.kanban.columnChangesReady
}
