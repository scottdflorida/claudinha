/**
 * TurnsModal — per-terminal modal for the turn-as-commit completion-actions
 * flow (Option B). Replaces the legacy ChangesReadyModal.
 *
 * M1 scope:
 *   - List the turns on this pane's worktree branch (newest first display
 *     order; canonical projection order is oldest first).
 *   - Per-row checkbox selection. Contiguous selections enable the publish
 *     action; non-contiguous show a hint.
 *   - "Squash + push branch" publish action via PublishDropdown (the only
 *     option in M1; M4 adds direct-merge / PR variants).
 *   - Commit message field for the squashed publish-commit.
 *   - Auto-commit toggle in the header.
 *
 * Deferred:
 *   - Inline diff expansion per row (M2, paired with discard).
 *   - Hunk-level split (M3).
 *   - Direct-merge / PR publish paths (M4).
 *   - Section labels (Just landed / Pending / Already published) per U2 —
 *     M1 just shows a single chronological list; section grouping lands
 *     when more than one terminal state surfaces.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStrings } from '../lib/strings'
import { useTurns } from '../hooks/useTurns'
import { ipcInvoke } from '../hooks/useIpc'
import { IPC } from '../../shared/ipc-channels'
import type {
  TurnsGetResult,
  TurnPublishSquashPayload,
  TurnDiscardPayload,
  TurnAutoCommitTogglePayload,
  TurnActionResult
} from '../../shared/ipc-channels'
import type { Turn, TurnState, PublishPath } from '../../shared/types'
import { HunkPickerModal } from './HunkPickerModal'

interface TurnsModalProps {
  paneId: string
  paneName: string
  workspaceId: string | null
  onClose: () => void
}

export function TurnsModal({ paneId, paneName, workspaceId, onClose }: TurnsModalProps): React.JSX.Element {
  const t = useStrings()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { turns, pendingAction, autoCommitEnabled, loading, error, diagnostic, refresh } = useTurns(paneId)

  // Selection state — Set of turn ids. Defaults to "every publishable
  // turn" so the typical "publish everything" case is one click. The
  // user uncheck rows to peel off a subset. Cleared after a successful
  // publish.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Track whether we've seeded selection at least once for this set of
  // turns, so we don't re-seed every render after the user clears it.
  const seededTurnIdsRef = useRef<string>('')
  useEffect(() => {
    const key = turns.map((t) => t.id).join(',')
    if (key !== seededTurnIdsRef.current) {
      seededTurnIdsRef.current = key
      setSelectedIds(new Set(
        turns.filter((tu) => tu.state === 'open' || tu.state === 'pushed').map((tu) => tu.id)
      ))
    }
  }, [turns])
  const [commitMessage, setCommitMessage] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  // Discard confirmation modal state. `pending` carries the turn the user
  // clicked discard on; `cascadeIds` is populated AFTER the first attempt
  // returns a cascade-required error, so the prompt's second pass shows
  // the dependents that would have to drop too.
  const [discardPending, setDiscardPending] = useState<{
    turn: Turn
    cascadeIds: string[]
  } | null>(null)
  // HunkPickerModal — opened from PublishDropdown's "Split a turn…" entry.
  // Only valid when exactly one `open` turn is selected.
  const [splitTurnTarget, setSplitTurnTarget] = useState<Turn | null>(null)
  // Resolved publish-path for this pane's workspace. M4 shows the
  // workspace default in the per-pane modal; M5's repo modal sets per-
  // repo overrides which the bulk pipeline consumes. Defaults to 'both'
  // until the resolve fetch completes.
  const [publishPath, setPublishPath] = useState<PublishPath>('both')
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    void ipcInvoke(IPC.WORKSPACE_DEFAULT_PATH_GET, { workspaceId })
      .then((raw) => {
        if (cancelled) return
        const result = raw as { error: string | null; value: PublishPath }
        if (!result.error) setPublishPath(result.value)
      })
      .catch(() => { /* fall through to default */ })
    return () => { cancelled = true }
  }, [workspaceId])

  // Reference workspaceId so M4's publish-path resolution can pick it up
  // when those paths land. Silenced for now.
  void workspaceId

  // Mount the dialog once and listen for native close (Esc key).
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const handleNativeClose = (): void => onClose()
    dialog.addEventListener('close', handleNativeClose)
    return () => dialog.removeEventListener('close', handleNativeClose)
  }, [onClose])

  const handleClose = (): void => dialogRef.current?.close()

  // Display order: newest first. Projection is oldest first.
  const displayTurns = useMemo(() => [...turns].reverse(), [turns])

  // Default the commit message to the most recent selected turn's summary
  // when nothing's been typed. This keeps the field useful for the typical
  // "publish my latest one or two turns" case without overriding deliberate
  // typing.
  const lastSelectedSummary = useMemo(() => {
    if (selectedIds.size === 0) return ''
    // Pick the chronologically newest selected turn (highest index).
    const selectedTurns = turns.filter((tu) => selectedIds.has(tu.id))
    if (selectedTurns.length === 0) return ''
    return selectedTurns.reduce((acc, tu) => (tu.index > acc.index ? tu : acc), selectedTurns[0]!).summary
  }, [selectedIds, turns])

  useEffect(() => {
    if (commitMessage.trim() === '') {
      setCommitMessage(lastSelectedSummary)
    }
    // intentionally only when selection changes — don't override user typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelectedSummary])

  const toggleSelect = (id: string): void => {
    setActionError(null)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectionContiguous = useMemo(() => {
    if (selectedIds.size === 0) return false
    const indexes: number[] = []
    for (const tu of turns) if (selectedIds.has(tu.id)) indexes.push(tu.index)
    indexes.sort((a, b) => a - b)
    for (let i = 1; i < indexes.length; i++) {
      if (indexes[i]! !== indexes[i - 1]! + 1) return false
    }
    return true
  }, [selectedIds, turns])

  const isWorking =
    pendingAction !== null && (
      pendingAction.kind === 'publishing-squash' ||
      pendingAction.kind === 'publishing-individual' ||
      pendingAction.kind === 'splitting' ||
      pendingAction.kind === 'discarding' ||
      pendingAction.kind === 'merging' ||
      pendingAction.kind === 'opening-pr'
    )

  // All selected turns must be in a publishable state. Once a turn is
  // `merged` or `shipped`, the publish actions become invalid (the work
  // is already on base / origin/base). Trying to re-publish would
  // either no-op or rewrite shared history; refuse up front.
  const allSelectedPublishable = useMemo(() => {
    if (selectedIds.size === 0) return false
    for (const id of selectedIds) {
      const tu = turns.find((x) => x.id === id)
      if (!tu) return false
      if (tu.state !== 'open' && tu.state !== 'pushed') return false
    }
    return true
  }, [selectedIds, turns])

  // The selection must include every earlier unpublished turn. Whatever
  // path we publish via (push-branch, direct-merge, PR) pushes the
  // worktree branch, which carries earlier turns as ancestors. Skipping
  // them publishes work the user didn't select — refuse up front.
  const selectionStartsAtBase = useMemo(() => {
    if (selectedIds.size === 0) return false
    let oldestSelectedIndex = Number.POSITIVE_INFINITY
    for (const tu of turns) {
      if (selectedIds.has(tu.id) && tu.index < oldestSelectedIndex) {
        oldestSelectedIndex = tu.index
      }
    }
    for (const tu of turns) {
      if (tu.index >= oldestSelectedIndex) continue
      if (tu.state === 'open' || tu.state === 'pushed') return false
    }
    return true
  }, [selectedIds, turns])

  const canPublish =
    !isWorking &&
    selectedIds.size > 0 &&
    selectionContiguous &&
    selectionStartsAtBase &&
    allSelectedPublishable &&
    commitMessage.trim().length > 0

  const handlePublishSquash = async (path: 'push-branch' | 'direct-merge' | 'pr' | 'draft-pr'): Promise<void> => {
    if (!canPublish) return
    setActionError(null)
    const orderedIds = turns.filter((tu) => selectedIds.has(tu.id)).map((tu) => tu.id)
    const payload: TurnPublishSquashPayload = {
      paneId,
      turnIds: orderedIds,
      message: commitMessage.trim(),
      path
    }
    const raw = await ipcInvoke(IPC.TURN_PUBLISH_SQUASH, payload)
    const result = raw as TurnActionResult
    if (result.error) {
      setActionError(result.error)
      return
    }
    setSelectedIds(new Set())
    setCommitMessage('')
    refresh()
  }

  const handleStartDiscard = (turn: Turn): void => {
    setActionError(null)
    setDiscardPending({ turn, cascadeIds: [] })
  }

  const handleConfirmDiscard = async (): Promise<void> => {
    if (!discardPending) return
    const cascadeConfirmed = discardPending.cascadeIds.length > 0
    const payload: TurnDiscardPayload = {
      paneId,
      turnId: discardPending.turn.id,
      cascadeConfirmed
    }
    const raw = await ipcInvoke(IPC.TURN_DISCARD, payload)
    const result = raw as TurnActionResult
    if (result.error) {
      // Cascade required: re-prompt with the dependent list.
      if (result.dependentTurnIds && result.dependentTurnIds.length > 0 && !cascadeConfirmed) {
        setDiscardPending({
          turn: discardPending.turn,
          cascadeIds: result.dependentTurnIds
        })
        return
      }
      setActionError(result.error)
      setDiscardPending(null)
      return
    }
    // Success — clear UI state.
    setDiscardPending(null)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(discardPending.turn.id)
      for (const id of discardPending.cascadeIds) next.delete(id)
      return next
    })
    refresh()
  }

  const handleCancelDiscard = (): void => {
    setDiscardPending(null)
  }

  const handleToggleAutoCommit = async (): Promise<void> => {
    const payload: TurnAutoCommitTogglePayload = { paneId, enabled: !autoCommitEnabled }
    await ipcInvoke(IPC.TURN_AUTO_COMMIT_TOGGLE, payload)
    refresh()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="turns-modal-title"
      className="
        bg-surface text-fg-primary
        rounded-lg border border-[var(--color-border-strong)] shadow-2xl
        p-0 w-[720px] max-w-[92vw] max-h-[85vh]
        overflow-hidden flex flex-col
        backdrop:bg-black/40
      "
      data-testid={`turns-modal-${paneId}`}
    >
      {/* Header */}
      <header className="flex-shrink-0 px-5 py-4 border-b border-[var(--color-border-subtle)] flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="turns-modal-title" className="text-sm font-[600] text-fg-primary truncate" title={paneName}>
            {t.turnsModal.titleFmt(paneName)}
          </h2>
          <p className="text-[11px] text-fg-muted mt-0.5">
            {t.turnsModal.subtitle}
          </p>
          {/* Main-mode context strip — surfaces that publishing pushes
              directly to origin/<base>, not to a feature branch. */}
          {diagnostic && diagnostic.currentBranch && diagnostic.baseBranch &&
            diagnostic.currentBranch === diagnostic.baseBranch && (
            <p className="text-[11px] text-warning-fg mt-1">
              Working on <code className="font-mono">{diagnostic.currentBranch}</code> · publish pushes to <code className="font-mono">origin/{diagnostic.currentBranch}</code>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <AutoCommitPill
            enabled={autoCommitEnabled}
            disabled={isWorking}
            onToggle={() => void handleToggleAutoCommit()}
            label={t.turnsModal.autoCommitToggle}
            ariaLabel={t.turnsModal.autoCommitToggleAria}
            onLabel={t.turnsModal.autoCommitToggleEnabled}
            offLabel={t.turnsModal.autoCommitToggleDisabled}
          />
          <button
            type="button"
            onClick={handleClose}
            aria-label={t.turnsModal.closeAria}
            className="text-fg-muted hover:text-fg-primary text-lg leading-none px-1"
          >
            ×
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="px-5 py-8 text-center text-[12px] text-fg-muted">Loading turns…</div>
        ) : error ? (
          <div className="px-5 py-8 text-center text-[12px] text-danger-fg">{error}</div>
        ) : turns.length === 0 ? (
          <EmptyTurnsState diagnostic={diagnostic} fallback={t.turnsModal.emptyState} />
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {displayTurns.map((turn) => (
              <TurnRow
                key={turn.id}
                turn={turn}
                selected={selectedIds.has(turn.id)}
                onToggle={() => toggleSelect(turn.id)}
                onDiscard={() => handleStartDiscard(turn)}
                onSplit={() => setSplitTurnTarget(turn)}
                disabled={isWorking}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <footer className="flex-shrink-0 border-t border-[var(--color-border-subtle)] px-5 py-3 flex flex-col gap-2 bg-bg-elevated">
        {actionError && (
          <div className="text-[11px] text-danger-fg">{actionError}</div>
        )}
        {selectedIds.size > 0 && !selectionContiguous && (
          <div className="text-[11px] text-warning-fg">
            Selection must be contiguous on the branch.
          </div>
        )}
        {selectedIds.size > 0 && selectionContiguous && !selectionStartsAtBase && (
          <div className="text-[11px] text-warning-fg">
            Selection skips earlier unpublished turns. Include them or discard them first — publishing the tail would carry them along as ancestors.
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Publish commit message…"
            disabled={isWorking || selectedIds.size === 0}
            className="
              flex-1 text-[12px] px-2 py-1 rounded border border-[var(--color-border-subtle)]
              bg-canvas text-fg-primary placeholder:text-fg-muted
              focus:outline-none focus-visible:outline-accent
              disabled:opacity-50 disabled:cursor-not-allowed
            "
            aria-label="Publish commit message"
          />
          <PublishDropdown
            label={t.turnsModal.publishMenuLabel}
            options={buildPublishOptions({
              t, canPublish, publishPath,
              isMainMode: !!(diagnostic && diagnostic.currentBranch === diagnostic.baseBranch && diagnostic.baseBranch !== null),
              baseBranch: diagnostic?.baseBranch ?? null,
              selectedCount: selectedIds.size,
              onSquash: handlePublishSquash
            })}
            disabled={isWorking || (selectedIds.size === 0) || !allSelectedPublishable}
          />
          <button
            type="button"
            onClick={handleClose}
            className="
              text-[12px] px-3 py-1 rounded border border-[var(--color-border-subtle)]
              text-fg-secondary hover:text-fg-primary hover:bg-overlay
              transition-colors duration-[80ms]
            "
          >
            {t.turnsModal.closeButton}
          </button>
        </div>
        {isWorking && (
          <div className="text-[11px] text-fg-secondary">
            {pendingActionLabel(t, pendingAction!)}
          </div>
        )}
      </footer>

      {discardPending && (
        <DiscardConfirmDialog
          turn={discardPending.turn}
          cascadeIds={discardPending.cascadeIds}
          allTurns={turns}
          onConfirm={handleConfirmDiscard}
          onCancel={handleCancelDiscard}
          working={isWorking}
        />
      )}

      {splitTurnTarget && (
        <HunkPickerModal
          paneId={paneId}
          turn={splitTurnTarget}
          onClose={() => setSplitTurnTarget(null)}
          onSplit={() => {
            setSplitTurnTarget(null)
            setSelectedIds(new Set())
            refresh()
          }}
        />
      )}
    </dialog>
  )
}

// ----------------------------------------------------------------------------
// EmptyTurnsState — diagnostic-aware empty state.
// ----------------------------------------------------------------------------
//
// The recorder has several skip paths (non-worktree, on-base-branch,
// branch-detection-failed, auto-commit-off, only-infrastructure-changes,
// clean-tree). When the modal shows zero turns, this component reads the
// `diagnostic` field from TURNS_GET and tells the user the actual reason
// — otherwise the empty state is silent and the user is left guessing.

interface EmptyTurnsStateProps {
  diagnostic: import('../../shared/ipc-channels').TurnsBranchDiagnostic | null
  fallback: string
}

function EmptyTurnsState({ diagnostic, fallback }: EmptyTurnsStateProps): React.JSX.Element {
  // Specific reason from the recorder takes precedence; fall through to a
  // best-guess from the static branch context if no Stop has fired yet.
  let headline = fallback
  let detail: string | null = null

  if (diagnostic) {
    const skip = diagnostic.lastSkipReason
    const onBaseBranch = diagnostic.currentBranch === diagnostic.baseBranch
    if (skip === 'branch-detection-failed') {
      headline = 'Could not detect the base branch for this worktree.'
      detail = 'Claudinha looks for `main` or `master` (in that order). If your repo uses a different default, the recorder skips. Tell us what it should look for.'
    } else if (skip === 'auto-commit-off') {
      headline = 'Auto-commit is off.'
      detail = 'Toggle it back on (top-right) and the next Stop will record a turn.'
    } else if (skip === 'only-infrastructure-changes') {
      headline = 'Last Stop only modified Claudinha infrastructure paths.'
      detail = '.claude/ and .worktrees/ changes are excluded from turns. The next Stop with user-file changes will record a turn.'
    } else if (skip === 'clean-tree') {
      headline = 'No edits since the last Stop.'
      detail = 'Auto-commit fires only when the working tree is dirty. Make a change and let the agent stop.'
    } else if (typeof skip === 'string' && skip.startsWith('error:')) {
      headline = 'The last auto-commit attempt failed.'
      detail = skip
    } else {
      // No skip reason yet — recorder hasn't run for this pane.
      const where = onBaseBranch
        ? `on ${diagnostic.currentBranch ?? 'main'} (no commits ahead of origin)`
        : `on ${diagnostic.currentBranch ?? 'this branch'}`
      headline = `No turns yet ${where}.`
      detail = onBaseBranch
        ? 'Working directly on the base branch — turns are local commits ahead of origin. Auto-commit fires when the agent stops with file changes.'
        : 'Auto-commit fires when the agent stops with file changes.'
    }
  }

  return (
    <div className="px-5 py-8 text-center flex flex-col items-center gap-2">
      <p className="text-[12px] text-fg-secondary">{headline}</p>
      {detail && <p className="text-[11px] text-fg-muted max-w-[480px]">{detail}</p>}
    </div>
  )
}

// ----------------------------------------------------------------------------
// TurnRow — one row in the turn list.
// ----------------------------------------------------------------------------

interface TurnRowProps {
  turn: Turn
  selected: boolean
  onToggle: () => void
  onDiscard: () => void
  onSplit: () => void
  disabled: boolean
}

function TurnRow({ turn, selected, onToggle, onDiscard, onSplit, disabled }: TurnRowProps): React.JSX.Element {
  const t = useStrings()
  // Discard is only valid for `open` and `pushed` turns. Everything else
  // (merged/shipped/pr-open) is shared work; superseded/discarded are gone.
  const canDiscard = turn.state === 'open' || turn.state === 'pushed'
  // Split requires the turn to be `open` (the rebase rewrites local-only
  // history) AND to touch more than one file (a single-file turn most
  // likely has only one hunk; the picker would have nothing meaningful
  // to split). Single-file multi-hunk turns are rare; the user can fall
  // back to git from the terminal for those.
  const canSplit = turn.state === 'open' && turn.filesChanged > 1
  return (
    <li
      className={`
        group/row px-5 py-2 flex items-start gap-3
        ${selected ? 'bg-overlay' : ''}
        ${disabled ? 'opacity-60' : 'hover:bg-overlay'}
      `}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={disabled}
        onChange={onToggle}
        aria-label={`Select ${t.turnsModal.turnNumberFmt(turn.index)}`}
        className="mt-1 flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-fg-muted tabular-nums flex-shrink-0">
            {t.turnsModal.turnNumberFmt(turn.index)}
          </span>
          <span className="text-[12px] text-fg-primary truncate" title={turn.summary}>
            {turn.summary}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-fg-muted tabular-nums">
          <span>{t.turnsModal.turnFilesAndLinesFmt(turn.filesChanged, turn.additions, turn.deletions)}</span>
          <StateBadge state={turn.state} />
        </div>
      </div>
      {canSplit && (
        <button
          type="button"
          onClick={onSplit}
          disabled={disabled}
          aria-label={`Split ${t.turnsModal.turnNumberFmt(turn.index)}`}
          title={t.turnsModal.splitTooltip}
          className="
            flex-shrink-0 text-[11px] px-2 py-1 rounded border border-[var(--color-border-subtle)]
            text-fg-muted hover:text-fg-primary hover:border-[var(--color-border-strong)]
            opacity-0 group-hover/row:opacity-100 focus:opacity-100
            transition-[opacity,colors] duration-[80ms]
            disabled:opacity-30 disabled:cursor-not-allowed
          "
        >
          {t.turnsModal.splitAction}
        </button>
      )}
      {canDiscard && (
        <button
          type="button"
          onClick={onDiscard}
          disabled={disabled}
          aria-label={`${t.turnsModal.discardAction} ${t.turnsModal.turnNumberFmt(turn.index)}`}
          title={t.turnsModal.discardTooltip}
          className="
            flex-shrink-0 text-[11px] px-2 py-1 rounded border border-[var(--color-border-subtle)]
            text-fg-muted hover:text-danger-fg hover:border-danger-fg/60
            opacity-0 group-hover/row:opacity-100 focus:opacity-100
            transition-[opacity,colors] duration-[80ms]
            disabled:opacity-30 disabled:cursor-not-allowed
          "
        >
          {t.turnsModal.discardAction}
        </button>
      )}
    </li>
  )
}

// ----------------------------------------------------------------------------
// StateBadge — a tiny tone-coded badge for the turn state.
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
    <span
      className={`inline-flex items-center px-1.5 py-0 rounded-sm border text-[10px] uppercase ${STATE_TONE[state]}`}
    >
      {state}
    </span>
  )
}

// ----------------------------------------------------------------------------
// AutoCommitPill — header toggle for auto-commit on Stop.
// ----------------------------------------------------------------------------

interface AutoCommitPillProps {
  enabled: boolean
  disabled?: boolean
  onToggle: () => void
  label: string
  ariaLabel: string
  onLabel: string
  offLabel: string
}

function AutoCommitPill({ enabled, disabled, onToggle, label, ariaLabel, onLabel, offLabel }: AutoCommitPillProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={enabled}
      title={ariaLabel}
      className={`
        inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border
        transition-colors duration-[80ms]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${enabled
          ? 'border-success-fg/60 text-success-fg hover:bg-success-fg/10'
          : 'border-[var(--color-border-subtle)] text-fg-muted hover:bg-overlay'
        }
      `}
    >
      <span>{label}</span>
      <span className="font-[600]">{enabled ? onLabel : offLabel}</span>
    </button>
  )
}

// ----------------------------------------------------------------------------
// PublishDropdown — minimal dropdown menu. M4 expands the option set.
// ----------------------------------------------------------------------------

interface PublishOption {
  key: string
  label: string
  /** Long-form description shown via `title=` on the menu item, so the
   *  user understands exactly what each path does before clicking. */
  tooltip?: string
  disabled: boolean
  onSelect: () => Promise<void> | void
}

interface PublishDropdownProps {
  label: string
  options: PublishOption[]
  disabled: boolean
}

function PublishDropdown({ label, options, disabled }: PublishDropdownProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="
          text-[12px] px-3 py-1 rounded border border-success-fg/60
          text-success-fg hover:bg-success-fg/10
          transition-colors duration-[80ms]
          disabled:opacity-50 disabled:cursor-not-allowed
          inline-flex items-center gap-1
        "
      >
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {isOpen && (
        <div
          role="menu"
          className="
            absolute right-0 bottom-full mb-1
            bg-surface border border-[var(--color-border-strong)] rounded-md shadow-lg
            min-w-[200px] py-1
            z-10
          "
        >
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              role="menuitem"
              disabled={opt.disabled}
              title={opt.tooltip}
              onClick={() => {
                setIsOpen(false)
                void opt.onSelect()
              }}
              className="
                w-full text-left text-[12px] px-3 py-1.5
                text-fg-primary hover:bg-overlay
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// DiscardConfirmDialog — sub-dialog for the destructive discard verb.
// ----------------------------------------------------------------------------
//
// Two-phase prompt. First click on a row's "Discard" button opens this
// with `cascadeIds: []` — a simple "are you sure?" confirmation. If the
// backend's first attempt returns a cascade-required error, the parent
// re-renders this with `cascadeIds` populated, and the body now lists
// the dependent turns that would also drop. The user clicks Discard
// again to confirm cascade.

interface DiscardConfirmDialogProps {
  turn: Turn
  cascadeIds: string[]
  allTurns: Turn[]
  onConfirm: () => Promise<void> | void
  onCancel: () => void
  working: boolean
}

function DiscardConfirmDialog({
  turn,
  cascadeIds,
  allTurns,
  onConfirm,
  onCancel,
  working
}: DiscardConfirmDialogProps): React.JSX.Element {
  const t = useStrings()
  const dialogRef = useRef<HTMLDialogElement>(null)

  // jsdom doesn't implement showModal; tests stub it. In production this
  // composes correctly with the parent dialog because both use top-layer.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const handleNativeClose = (): void => onCancel()
    dialog.addEventListener('close', handleNativeClose)
    return () => dialog.removeEventListener('close', handleNativeClose)
  }, [onCancel])

  const cascadeTurns = allTurns.filter((tu) => cascadeIds.includes(tu.id))

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`discard-confirm-title-${turn.id}`}
      className="
        bg-surface text-fg-primary
        rounded-lg border border-[var(--color-border-strong)] shadow-2xl
        p-0 w-[480px] max-w-[90vw]
        backdrop:bg-black/40
      "
      data-testid={`discard-confirm-${turn.id}`}
    >
      <header className="px-5 py-4 border-b border-[var(--color-border-subtle)]">
        <h3 id={`discard-confirm-title-${turn.id}`} className="text-sm font-[600] text-fg-primary">
          {t.turnsModal.discardConfirmTitle}
        </h3>
      </header>
      <div className="px-5 py-4 flex flex-col gap-3 text-[12px] text-fg-secondary">
        <p>
          {t.turnsModal.discardConfirmBodyFmt(turn.index)}
        </p>
        {cascadeTurns.length > 0 && (
          <div className="rounded border border-warning-fg/40 bg-warning-fg/5 px-3 py-2 text-warning-fg text-[11px]">
            <p className="font-[600] mb-1">
              {t.turnsModal.discardCascadeWarningFmt(cascadeTurns.length)}
            </p>
            <ul className="list-disc pl-5 space-y-0.5">
              {cascadeTurns.map((tu) => (
                <li key={tu.id}>
                  {t.turnsModal.turnNumberFmt(tu.index)} — {tu.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <footer className="px-5 py-3 border-t border-[var(--color-border-subtle)] flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={working}
          className="
            text-[12px] px-3 py-1 rounded border border-[var(--color-border-subtle)]
            text-fg-secondary hover:text-fg-primary hover:bg-overlay
            transition-colors duration-[80ms]
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          {t.turnsModal.discardCancelButton}
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={working}
          className="
            text-[12px] px-3 py-1 rounded border border-danger-fg/60
            text-danger-fg hover:bg-danger-fg/10
            transition-colors duration-[80ms]
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          {t.turnsModal.discardConfirmButton}
        </button>
      </footer>
    </dialog>
  )
}

// ----------------------------------------------------------------------------
// buildPublishOptions — per-mode dropdown options for the PublishDropdown.
// ----------------------------------------------------------------------------
//
// Resolves the correct set of options for the current pane:
//
//   - Main-mode panes (currentBranch === baseBranch): only `push-branch`
//     applies. Direct-merge has no target (already on base); PR can't
//     open from base to base. The dropdown collapses to a single entry.
//
//   - Worktree panes with publishPath = 'direct-merge': just the merge
//     entry. Push-branch is suppressed because the user explicitly
//     chose merge as the path.
//
//   - Worktree + 'pr': PR entry + draft-PR entry.
//
//   - Worktree + 'both': all three publish entries surface; the user
//     picks per action.
//
//   - "Split a turn…" is always present, gated by single-`open`-turn
//     selection.

interface BuildPublishOptionsArgs {
  t: ReturnType<typeof useStrings>
  canPublish: boolean
  publishPath: PublishPath
  isMainMode: boolean
  /** Base branch the merge action targets — interpolated into the
   *  "Squash + merge to origin/<base>" label so the destination is
   *  obvious without reading the tooltip. */
  baseBranch: string | null
  /** When 1, drop the "Squash + " prefix — there's nothing to squash. */
  selectedCount: number
  onSquash: (path: 'push-branch' | 'direct-merge' | 'pr' | 'draft-pr') => Promise<void> | void
}

// Strip the "Squash + " prefix when only one turn is selected. The
// localized label happens to start with "Squash + " in en + pt-BR; if
// the prefix isn't present (future locales), the label is returned
// unchanged.
function stripSquashPrefix(label: string): string {
  const trimmed = label.replace(/^Squash\s*\+\s*/i, '')
  if (trimmed === label) return label
  // Re-capitalize the first letter so "push branch" → "Push branch".
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function buildPublishOptions(args: BuildPublishOptionsArgs): PublishOption[] {
  const { t, canPublish, publishPath, isMainMode, baseBranch, selectedCount, onSquash } = args
  const options: PublishOption[] = []
  const fmt = (label: string): string => (selectedCount === 1 ? stripSquashPrefix(label) : label)
  const mergeLabel = baseBranch
    ? t.turnsModal.publishSquashAndMergeFmt(baseBranch)
    : t.turnsModal.publishSquashAndMerge

  if (isMainMode) {
    // Main mode: push-branch only.
    options.push({
      key: 'squash-push-branch',
      label: fmt(t.turnsModal.publishSquashAndPush),
      tooltip: t.turnsModal.publishSquashAndPushTooltipMain,
      disabled: !canPublish,
      onSelect: () => onSquash('push-branch')
    })
    return options
  }

  // Worktree mode: shape by publishPath.
  if (publishPath === 'direct-merge' || publishPath === 'both') {
    options.push({
      key: 'squash-direct-merge',
      label: fmt(mergeLabel),
      tooltip: t.turnsModal.publishSquashAndMergeTooltip,
      disabled: !canPublish,
      onSelect: () => onSquash('direct-merge')
    })
  }
  if (publishPath === 'pr' || publishPath === 'both') {
    options.push({
      key: 'squash-pr',
      label: fmt(t.turnsModal.publishSquashAndPr),
      tooltip: t.turnsModal.publishSquashAndPrTooltip,
      disabled: !canPublish,
      onSelect: () => onSquash('pr')
    })
    options.push({
      key: 'squash-draft-pr',
      label: fmt(t.turnsModal.publishSquashAndDraftPr),
      tooltip: t.turnsModal.publishSquashAndDraftPrTooltip,
      disabled: !canPublish,
      onSelect: () => onSquash('draft-pr')
    })
  }
  // Push-branch is always available as a fallback — useful for handing
  // the branch off out-of-band without merging or PRing. The repo's
  // configured path drives the *primary* options above.
  options.push({
    key: 'squash-push-branch',
    label: fmt(t.turnsModal.publishSquashAndPush),
    tooltip: t.turnsModal.publishSquashAndPushTooltip,
    disabled: !canPublish,
    onSelect: () => onSquash('push-branch')
  })

  return options
}

// ----------------------------------------------------------------------------
// pendingActionLabel — turn the typed pending-action into a status string.
// ----------------------------------------------------------------------------

import type { TurnPendingAction } from '../../shared/types'

function pendingActionLabel(t: ReturnType<typeof useStrings>, action: TurnPendingAction): string {
  switch (action.kind) {
    case 'publishing-squash':
      return t.turnsModal.publishingSquashFmt(action.selectedTurnIds.length)
    case 'publishing-individual':
      return t.turnsModal.publishingIndividualFmt(action.selectedTurnIds.length)
    case 'splitting':
      return t.turnsModal.splitting
    case 'discarding':
      return t.turnsModal.discarding
    case 'merging':
      return t.turnsModal.merging
    case 'opening-pr':
      return t.turnsModal.openingPr
    default:
      return t.turnsModal.pendingActionLabel
  }
}
