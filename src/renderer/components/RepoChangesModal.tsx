/**
 * RepoChangesModal — repo-level rollup of pending turns across every
 * pane in the workspace that resolves to the same repo root.
 *
 * One section per pane. The user selects panes (whole-pane checkbox);
 * the BulkActionsBar at the footer offers Merge / PR / Discard for the
 * selected panes. The pipeline drains all selected panes and surfaces
 * mixed outcomes in a `MultiConflictModal` after the run completes.
 *
 * MVP scope (M5):
 *   - Filter chips: All / Has changes / Has conflicts.
 *   - Whole-pane selection (no per-turn selection here — that's the
 *     per-terminal TurnsModal's job).
 *   - Bulk actions: discard-all, push-branch, merge, open-pr, open-draft-pr.
 *     The set surfaced depends on the repo's resolved publish path.
 *   - Progress: the bar shows a simple "X of Y done" counter while the
 *     run is in flight; results are surfaced in MultiConflictModal at
 *     the end.
 *
 * Deferred to M6: keyboard nav (J/K), filter chip extras, per-pane
 * publish-path override config (the dropdown lives in the header but
 * is read-only in MVP).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ipcInvoke, useIpcListener } from '../hooks/useIpc'
import { IPC } from '../../shared/ipc-channels'
import type {
  RepoTurnsGetPayload,
  RepoTurnsGetResult,
  RepoPaneTurns,
  BulkRunPayload,
  BulkRunResult,
  BulkProgressPayload,
  BulkCompletedPayload,
  BulkActionKind,
  BulkActionResult
} from '../../shared/ipc-channels'
import type { Turn, TurnState, PublishPath } from '../../shared/types'
import { MultiConflictModal } from './MultiConflictModal'

interface RepoChangesModalProps {
  workspaceId: string
  repoPath: string
  onClose: () => void
}

type FilterChip = 'all' | 'has-changes' | 'has-conflicts'

export function RepoChangesModal({ workspaceId, repoPath, onClose }: RepoChangesModalProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [data, setData] = useState<RepoTurnsGetResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterChip>('all')
  const [selectedPaneIds, setSelectedPaneIds] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState<{ runId: string; total: number; completed: number } | null>(null)
  const [conflictResults, setConflictResults] = useState<BulkActionResult[] | null>(null)
  // After a bulk run, any per-pane results that produced a URL (PRs)
  // get parked here so the user can click through. Cleared when they
  // dismiss the toast or trigger another run.
  const [resultUrls, setResultUrls] = useState<BulkActionResult[]>([])

  // Mount + native close.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const handleNativeClose = (): void => onClose()
    dialog.addEventListener('close', handleNativeClose)
    return () => dialog.removeEventListener('close', handleNativeClose)
  }, [onClose])

  const refresh = useCallback(async (): Promise<void> => {
    const payload: RepoTurnsGetPayload = { workspaceId, repoPath }
    const raw = await ipcInvoke(IPC.REPO_TURNS_GET, payload)
    const result = raw as RepoTurnsGetResult
    if (result.error) {
      setLoadError(result.error)
      return
    }
    setData(result)
    // Prune the selection to only panes that are still actionable
    // after the refresh. Stops a pane that just landed in `shipped`
    // (because someone else merged it, or we did via direct-merge from
    // the per-terminal modal) from staying in the selection set and
    // getting bundled into the next bulk dispatch.
    setSelectedPaneIds((prev) => {
      if (prev.size === 0) return prev
      const stillActionable = new Set<string>()
      for (const pane of result.panes) {
        if (prev.has(pane.paneId) && paneIsActionable(pane)) {
          stillActionable.add(pane.paneId)
        }
      }
      return stillActionable
    })
  }, [workspaceId, repoPath])

  useEffect(() => { void refresh() }, [refresh])

  // Live updates: a per-pane TURNS_UPDATED event means our aggregate
  // changed too. Cheap to refetch — main reads in-memory state.
  useIpcListener(IPC.TURNS_UPDATED, () => { void refresh() })
  useIpcListener(IPC.TURN_RECORDED, () => { void refresh() })

  // Bulk progress / completion stream.
  useIpcListener(IPC.BULK_PROGRESS, (payload) => {
    const p = payload as BulkProgressPayload
    setRunning((curr) => curr && curr.runId === p.runId
      ? { ...curr, completed: p.completed, total: p.total }
      : curr)
  })
  useIpcListener(IPC.BULK_COMPLETED, (payload) => {
    const p = payload as BulkCompletedPayload
    setRunning((curr) => {
      if (!curr || curr.runId !== p.runId) return curr
      const failures = p.results.filter((r) => !r.ok)
      if (failures.length > 0) {
        setConflictResults(p.results)
      }
      const withUrls = p.results.filter((r) => r.ok && r.resultUrl)
      if (withUrls.length > 0) {
        setResultUrls(withUrls)
      }
      return null
    })
    void refresh()
    setSelectedPaneIds(new Set())
  })

  const filteredPanes = useMemo<RepoPaneTurns[]>(() => {
    if (!data) return []
    if (filter === 'all') return data.panes
    if (filter === 'has-changes') {
      return data.panes.filter((p) => p.turns.some((t) => t.state === 'open' || t.state === 'pushed'))
    }
    if (filter === 'has-conflicts') {
      // M5 MVP: we don't currently mark turns "in-conflict" in the
      // projection. Approximate as panes whose pendingAction.kind ===
      // 'merging' had previously failed — for MVP this filter is a
      // placeholder until M6 adds a 'conflict' state on turns.
      return []
    }
    return data.panes
  }, [data, filter])

  const togglePane = (paneId: string): void => {
    setSelectedPaneIds((prev) => {
      const next = new Set(prev)
      if (next.has(paneId)) next.delete(paneId)
      else next.add(paneId)
      return next
    })
  }

  const selectAllVisible = (): void => {
    setSelectedPaneIds(new Set(filteredPanes.filter((p) => paneIsActionable(p)).map((p) => p.paneId)))
  }
  const clearSelection = (): void => setSelectedPaneIds(new Set())

  const handleBulk = async (action: BulkActionKind): Promise<void> => {
    if (selectedPaneIds.size === 0 || running !== null || !data) return
    // Belt-and-braces: only forward panes that are still actionable.
    // The refresh-prune above keeps `selectedPaneIds` tidy; this
    // filter defends against a stale selection captured between a
    // refresh tick and the click.
    const paneIds = data.panes
      .filter((p) => selectedPaneIds.has(p.paneId) && paneIsActionable(p))
      .map((p) => p.paneId)
    if (paneIds.length === 0) {
      setLoadError('Selected agents have no publishable turns. Refresh and pick agents with open work.')
      return
    }
    const payload: BulkRunPayload = { repoPath, workspaceId, paneIds, action }
    const raw = await ipcInvoke(IPC.BULK_RUN, payload)
    const result = raw as BulkRunResult
    if (result.error || !result.runId) {
      setLoadError(result.error ?? 'failed to start bulk run')
      return
    }
    setRunning({ runId: result.runId, total: paneIds.length, completed: 0 })
  }

  const handleCancel = async (): Promise<void> => {
    if (!running) return
    await ipcInvoke(IPC.BULK_CANCEL, { runId: running.runId })
    // Don't clear `running` here — wait for BULK_COMPLETED so the
    // results array (with `cancelled` markers) flows back through the
    // multi-conflict modal. If the in-flight pane never returns the
    // user can close the modal and re-open later.
  }

  const handleClose = (): void => dialogRef.current?.close()

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="repo-changes-modal-title"
      className="
        bg-surface text-fg-primary
        rounded-lg border border-[var(--color-border-strong)] shadow-2xl
        p-0 w-[820px] max-w-[95vw] max-h-[90vh]
        flex flex-col overflow-hidden
        backdrop:bg-black/40
      "
      data-testid={`repo-changes-modal-${repoPath}`}
    >
      <header className="flex-shrink-0 px-5 py-4 border-b border-[var(--color-border-subtle)] flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="repo-changes-modal-title" className="text-sm font-[600] text-fg-primary truncate">
            {data ? `Changes in Repo: ${data.repoLabel}` : 'Changes'}
          </h2>
          <p className="text-[11px] text-fg-muted mt-0.5">
            {data ? `${data.panes.length} agent${data.panes.length === 1 ? '' : 's'} · publish-path: ${data.publishPath}` : 'Loading…'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="text-fg-muted hover:text-fg-primary text-lg leading-none px-1"
        >
          ×
        </button>
      </header>

      {/* Filter chips */}
      <div className="flex-shrink-0 px-5 py-2 flex items-center gap-2 border-b border-[var(--color-border-subtle)]">
        <FilterChipButton active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChipButton>
        <FilterChipButton active={filter === 'has-changes'} onClick={() => setFilter('has-changes')}>Has changes</FilterChipButton>
        <FilterChipButton active={filter === 'has-conflicts'} onClick={() => setFilter('has-conflicts')}>Has conflicts</FilterChipButton>
        <span className="ml-auto text-[11px] text-fg-muted">
          {selectedPaneIds.size > 0
            ? `${selectedPaneIds.size} selected`
            : ''}
        </span>
        {selectedPaneIds.size > 0 && (
          <button
            type="button"
            onClick={clearSelection}
            className="text-[11px] text-fg-muted hover:text-fg-primary"
          >
            clear
          </button>
        )}
        <button
          type="button"
          onClick={selectAllVisible}
          className="text-[11px] text-fg-muted hover:text-fg-primary"
        >
          select all
        </button>
      </div>

      {/* Result-URL strip — shows PR / merge URLs after a successful
          bulk run. One row per result; the agent's display name is the
          link text and `data-url` carries the actual URL the click
          opens externally via window.api.openExternal (no in-app
          navigation). Dismissable. */}
      {resultUrls.length > 0 && (
        <div className="flex-shrink-0 px-5 py-2 border-b border-[var(--color-border-subtle)] bg-info-fg/5">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <p className="text-[11px] text-info-fg font-[600]">
                {resultUrls.length === 1 ? 'PR opened' : `${resultUrls.length} PRs opened`}
              </p>
              {resultUrls.map((r) => {
                const pane = data?.panes.find((p) => p.paneId === r.paneId)
                const label = pane?.paneName ?? r.paneId
                return (
                  <a
                    key={r.paneId}
                    href={r.resultUrl}
                    onClick={(e) => {
                      e.preventDefault()
                      if (r.resultUrl) {
                        void ipcInvoke(IPC.OPEN_EXTERNAL, { url: r.resultUrl })
                      }
                    }}
                    className="text-[11px] text-info-fg hover:underline truncate"
                    title={r.resultUrl}
                  >
                    {label}: {r.resultUrl}
                  </a>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => setResultUrls([])}
              aria-label="Dismiss PR list"
              className="text-fg-muted hover:text-fg-primary text-sm leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loadError ? (
          <div className="px-5 py-8 text-center text-[12px] text-danger-fg">{loadError}</div>
        ) : data === null ? (
          <div className="px-5 py-8 text-center text-[12px] text-fg-muted">Loading…</div>
        ) : filteredPanes.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-fg-muted">
            {filter === 'all'
              ? 'No agents in this repo yet.'
              : 'No agents match the current filter.'}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {filteredPanes.map((pane) => (
              <PaneSection
                key={pane.paneId}
                pane={pane}
                selected={selectedPaneIds.has(pane.paneId)}
                onToggle={() => togglePane(pane.paneId)}
                disabled={running !== null}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Bulk actions bar */}
      <BulkActionsBar
        publishPath={data?.publishPath ?? 'both'}
        baseBranch={data?.panes.find((p) => p.baseBranch)?.baseBranch ?? null}
        selectedCount={selectedPaneIds.size}
        running={running}
        onAction={handleBulk}
        onCancel={handleCancel}
        onClose={handleClose}
      />

      {conflictResults && data && (
        <MultiConflictModal
          panes={data.panes}
          results={conflictResults}
          onClose={() => { setConflictResults(null); void refresh() }}
        />
      )}
    </dialog>
  )
}

// ----------------------------------------------------------------------------
// PaneSection — one pane's row in the repo modal.
// ----------------------------------------------------------------------------

function paneIsActionable(p: RepoPaneTurns): boolean {
  return p.turns.some((t) => t.state === 'open' || t.state === 'pushed')
}

interface PaneSectionProps {
  pane: RepoPaneTurns
  selected: boolean
  onToggle: () => void
  disabled: boolean
}

function PaneSection({ pane, selected, onToggle, disabled }: PaneSectionProps): React.JSX.Element {
  const actionable = paneIsActionable(pane)
  const totals = useMemo(() => {
    let additions = 0
    let deletions = 0
    let files = 0
    for (const t of pane.turns) {
      additions += t.additions
      deletions += t.deletions
      files += t.filesChanged
    }
    return { additions, deletions, files }
  }, [pane.turns])

  return (
    <li className={`px-5 py-3 ${selected ? 'bg-overlay' : ''} ${disabled ? 'opacity-60' : ''}`}>
      <header className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={disabled || !actionable}
          aria-label={`Select ${pane.paneName}`}
          className="mt-1 flex-shrink-0 disabled:opacity-25 disabled:cursor-not-allowed"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] font-[600] text-fg-primary truncate" title={pane.paneName}>
              {pane.paneName}
            </span>
            {pane.currentBranch && (
              <span className="text-[11px] font-mono text-fg-muted truncate" title={pane.currentBranch}>
                {pane.currentBranch}
              </span>
            )}
            {pane.pendingAction && (
              <span className="text-[11px] text-warning-fg">working…</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-fg-muted tabular-nums">
            {pane.turns.length === 0 ? (
              <span>No turns</span>
            ) : (
              <>
                <span>{pane.turns.length} turn{pane.turns.length === 1 ? '' : 's'}</span>
                <span>{totals.files} file{totals.files === 1 ? '' : 's'}</span>
                <span>
                  <span className="text-success-fg">+{totals.additions}</span>
                  {' '}
                  <span className="text-danger-fg">−{totals.deletions}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </header>
      {pane.turns.length > 0 && (
        <ul className="mt-2 ml-7 flex flex-col gap-1">
          {pane.turns.map((turn) => (
            <li key={turn.id} className="flex items-baseline gap-2 text-[11px]">
              <span className="text-fg-muted tabular-nums">T{turn.index}</span>
              <StateBadge state={turn.state} />
              <span className="flex-1 text-fg-primary truncate" title={turn.summary}>{turn.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

// ----------------------------------------------------------------------------
// FilterChipButton
// ----------------------------------------------------------------------------

function FilterChipButton({
  active, onClick, children
}: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        text-[11px] px-2 py-0.5 rounded-full border
        transition-colors duration-[80ms]
        ${active
          ? 'border-accent text-accent-fg bg-accent/10'
          : 'border-[var(--color-border-subtle)] text-fg-muted hover:text-fg-primary'}
      `}
    >
      {children}
    </button>
  )
}

// ----------------------------------------------------------------------------
// BulkActionsBar
// ----------------------------------------------------------------------------

interface BulkActionsBarProps {
  publishPath: PublishPath
  /** Resolved base branch for the repo — interpolated into the
   *  Merge button label so the destination ("origin/<base>") is
   *  visible without reading the tooltip. Null if no pane in the
   *  repo has reported a base branch yet (rare; falls back to a
   *  generic label). */
  baseBranch: string | null
  selectedCount: number
  running: { runId: string; total: number; completed: number } | null
  onAction: (action: BulkActionKind) => Promise<void> | void
  onCancel: () => Promise<void> | void
  onClose: () => void
}

function BulkActionsBar({
  publishPath, baseBranch, selectedCount, running, onAction, onCancel, onClose
}: BulkActionsBarProps): React.JSX.Element {
  const disabled = selectedCount === 0 || running !== null
  // While running, swap the action buttons for a Cancel + Close so the
  // user is never trapped in a "Running… 0/N" state with no recourse.
  if (running) {
    return (
      <footer className="flex-shrink-0 border-t border-[var(--color-border-subtle)] px-5 py-3 flex flex-col gap-2 bg-bg-elevated">
        <div className="text-[11px] text-fg-secondary tabular-nums">
          Running… {running.completed}/{running.total} done
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => void onCancel()}
            className="text-[12px] px-3 py-1 rounded border border-warning-fg/60 text-warning-fg hover:bg-warning-fg/10"
            title="Stop the bulk pipeline. The pane currently mid-action finishes; remaining panes are skipped."
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] px-3 py-1 rounded border border-[var(--color-border-subtle)] text-fg-secondary hover:text-fg-primary hover:bg-overlay"
          >
            Close
          </button>
        </div>
      </footer>
    )
  }
  return (
    <footer className="flex-shrink-0 border-t border-[var(--color-border-subtle)] px-5 py-3 flex flex-col gap-2 bg-bg-elevated">
      <div className="text-[11px] text-fg-muted">
        {selectedCount === 0
          ? 'Select agents above to act on them in bulk.'
          : `${selectedCount} agent${selectedCount === 1 ? '' : 's'} selected.`}
      </div>
      <div className="flex items-center flex-wrap gap-2 justify-end">
        {(publishPath === 'direct-merge' || publishPath === 'both') && (
          <BulkActionButton
            onClick={() => void onAction('merge')}
            disabled={disabled}
            tone="success"
            title={`For each selected agent: squash its turns, merge the result into ${baseBranch ?? 'the base branch'} via the side-clone, and push origin/${baseBranch ?? '<base>'}.`}
          >
            {baseBranch ? `Merge to origin/${baseBranch}` : 'Merge'}
          </BulkActionButton>
        )}
        {(publishPath === 'pr' || publishPath === 'both') && (
          <>
            <BulkActionButton
              onClick={() => void onAction('open-pr')}
              disabled={disabled}
              tone="info"
              title="Open a PR for each selected agent (one per agent)"
            >
              Open PRs
            </BulkActionButton>
            <BulkActionButton
              onClick={() => void onAction('open-draft-pr')}
              disabled={disabled}
              tone="info"
              title="Open draft PRs for each selected agent"
            >
              Draft PRs
            </BulkActionButton>
          </>
        )}
        <BulkActionButton
          onClick={() => void onAction('push-branch')}
          disabled={disabled}
          tone="muted"
          title="Squash + push each agent's branch to origin (no merge / PR)"
        >
          Push branches
        </BulkActionButton>
        <BulkActionButton
          onClick={() => void onAction('discard-all')}
          disabled={disabled}
          tone="danger"
          title="Drop every publishable turn on every selected agent — irreversible"
        >
          Discard
        </BulkActionButton>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] px-3 py-1 rounded border border-[var(--color-border-subtle)] text-fg-secondary hover:text-fg-primary hover:bg-overlay"
        >
          Close
        </button>
      </div>
    </footer>
  )
}

interface BulkActionButtonProps {
  onClick: () => void
  disabled: boolean
  tone: 'success' | 'info' | 'danger' | 'muted'
  title?: string
  children: React.ReactNode
}

function BulkActionButton({ onClick, disabled, tone, title, children }: BulkActionButtonProps): React.JSX.Element {
  const toneClass =
    tone === 'success' ? 'border-success-fg/60 text-success-fg hover:bg-success-fg/10' :
    tone === 'info' ? 'border-info-fg/60 text-info-fg hover:bg-info-fg/10' :
    tone === 'danger' ? 'border-danger-fg/60 text-danger-fg hover:bg-danger-fg/10' :
    'border-[var(--color-border-subtle)] text-fg-secondary hover:text-fg-primary hover:bg-overlay'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        text-[12px] px-3 py-1 rounded border
        transition-colors duration-[80ms]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${toneClass}
      `}
    >
      {children}
    </button>
  )
}

// ----------------------------------------------------------------------------
// StateBadge — duplicated here to avoid TurnsModal cross-import; same
// styling as the per-terminal modal.
// ----------------------------------------------------------------------------

const STATE_TONE: Record<TurnState, string> = {
  open: 'text-fg-secondary border-[var(--color-border-subtle)]',
  pushed: 'text-info-fg border-info-fg/60',
  'pr-open': 'text-info-fg border-info-fg/60',
  merged: 'text-success-fg border-success-fg/60',
  shipped: 'text-success-fg border-success-fg/60',
  superseded: 'text-fg-muted border-[var(--color-border-subtle)]',
  discarded: 'text-fg-muted border-[var(--color-border-subtle)]'
}

function StateBadge({ state }: { state: TurnState }): React.JSX.Element {
  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded-sm border text-[10px] uppercase ${STATE_TONE[state]}`}>
      {state}
    </span>
  )
}

// Suppress unused-import warning on Turn — it appears via the type
// alias in RepoPaneTurns.
void (null as unknown as Turn)
