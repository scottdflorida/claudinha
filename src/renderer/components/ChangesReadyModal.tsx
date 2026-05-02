import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileDiff, Trash2 } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { GhCliCheckResult } from '../../shared/ipc-channels'
import type { CompletionActionStatus, MergeStrategy, PaneCloseAction } from '../../shared/types'
import { ipcInvoke, ipcSend } from '../hooks/useIpc'
import { usePaneState } from '../hooks/usePaneState'
import { useStrings } from '../lib/strings'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { DiffViewerModal } from './DiffViewerModal'
import { PaneCloseConfirmModal } from './PaneCloseConfirmModal'
import { buildPaneCloseOptions, type PaneCloseDescriptor } from '../lib/pane-close-options'

// ---------------------------------------------------------------------------
// ChangesReadyModal
//
// Per-agent action surface that replaces the standalone diff viewer + bottom
// completion bar in the Kanban changes-ready flow. Layout:
//   - Header: repo · agent name (the Dialog chrome handles X / Esc).
//   - Commit list (skeleton — round grouping deferred until the main-process
//     git ancestor / PR-association probe lands).
//   - View diffs button → opens DiffViewerModal on top.
//   - Two-path action tree:
//        Commit ─┬─ Merge → Push to main
//                └─ Push to branch → Create PR
//   - Discard (red) → opens PaneCloseConfirmModal with merge-and-close
//     suppressed, since discarding work and merging it are contradictory.
//   - Error banner — surfaces transient action failures inline.
//
// Per-button verb states: idle / queued / in-progress / success / error /
// blocked. The completion executor's existing CompletionActionStatus is the
// source of truth — the modal mirrors it so closing/reopening always reflects
// the live state.
// ---------------------------------------------------------------------------

interface ChangesReadyModalProps {
  paneId: string
  paneName: string
  workspaceId: string | null
  onClose: () => void
}

type ButtonState = 'idle' | 'queued' | 'in-progress' | 'success' | 'error' | 'blocked'

interface ButtonSpec {
  state: ButtonState
  label: string
  /** Tooltip surfaced on hover when the button is disabled or hints at
   *  side effects (e.g., `Auto-commit before merge`). */
  tooltip?: string
}

export function ChangesReadyModal({
  paneId,
  paneName,
  workspaceId,
  onClose
}: ChangesReadyModalProps): React.JSX.Element {
  const t = useStrings()
  const { panes } = usePaneState()
  const pane = panes.find((p) => p.id === paneId) ?? null
  const completion = pane?.completionStatus ?? null
  const gitStatus = pane?.gitStatus ?? null

  // Sub-modal state — diff viewer + discard confirm overlay this dialog.
  const [showDiff, setShowDiff] = useState(false)
  const [showDiscard, setShowDiscard] = useState(false)
  const [discardError, setDiscardError] = useState<string | null>(null)

  // gh availability — only the Create PR button cares.
  const [ghAvailable, setGhAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    ipcInvoke(IPC.GH_CLI_CHECK)
      .then((result) => setGhAvailable((result as GhCliCheckResult).available))
      .catch(() => setGhAvailable(false))
  }, [])

  // ---------------------------------------------------------------------------
  // Per-button state derivation
  // ---------------------------------------------------------------------------

  const hasUncommitted = gitStatus?.hasUncommittedChanges === true
  const commitsAhead = gitStatus?.commitsAhead ?? 0
  const everythingCommitted = !hasUncommitted

  const commit: ButtonSpec = useMemo(() => {
    if (!completion) {
      if (everythingCommitted && commitsAhead === 0) return { state: 'idle', label: t.changesReadyModal.actionCommit }
      if (everythingCommitted) return { state: 'success', label: t.changesReadyModal.actionCommitted }
      return { state: 'idle', label: t.changesReadyModal.actionCommit }
    }
    return mapCompletionToCommitButton(completion, t)
  }, [completion, everythingCommitted, commitsAhead, t])

  const merge: ButtonSpec = useMemo(() => mapCompletionToMergeButton(completion, hasUncommitted, t), [completion, hasUncommitted, t])
  const pushToMain: ButtonSpec = useMemo(() => mapCompletionToPushMainButton(completion, t), [completion, t])
  const pushToBranch: ButtonSpec = useMemo(() => mapCompletionToPushBranchButton(completion, hasUncommitted, t), [completion, hasUncommitted, t])
  const createPr: ButtonSpec = useMemo(() => mapCompletionToCreatePrButton(completion, ghAvailable, t), [completion, ghAvailable, t])

  // ---------------------------------------------------------------------------
  // Click handlers
  // ---------------------------------------------------------------------------

  // Cascading rule: clicking a leaf runs every step on the path from Commit to
  // that leaf that isn't already in success state. The two paths are
  // independent. Since the existing completion executor's executeMerge /
  // executePr already auto-commit any pending edits internally, the cascade
  // for the merge path is "click Merge" and for the PR path is "click PR" —
  // commit is implicit in both. Push-to-main runs the composite
  // REPO_MERGE_AND_PUSH (merge + push base) so the chain matches the visual.
  const handleMerge = useCallback(() => {
    void ipcInvoke(IPC.COMPLETION_MERGE, { paneId, strategy: 'rebase-ff' as MergeStrategy })
  }, [paneId])

  const handlePushToMain = useCallback(() => {
    if (!workspaceId || !pane) return
    void ipcInvoke(IPC.REPO_MERGE_AND_PUSH, {
      workspaceId,
      // The existing IPC keys per-repo by inspector groupKey; we don't
      // surface that here, so REPO_MERGE_AND_PUSH falls back gracefully.
      // For a single-pane action the per-repo grouping doesn't matter.
      repoPath: pane.repoName,
      strategy: 'rebase-ff' as MergeStrategy
    }).catch((err) => console.warn('[ChangesReadyModal] push-to-main failed:', err))
  }, [paneId, workspaceId, pane])

  const handlePushToBranch = useCallback(() => {
    // No standalone branch-push IPC exists today — Push-to-branch is part of
    // the PR flow. v1 lights this up only when the user clicks Create PR.
    void ipcInvoke(IPC.COMPLETION_PR, { paneId, draft: true }).catch((err) =>
      console.warn('[ChangesReadyModal] push-to-branch (via draft PR) failed:', err)
    )
  }, [paneId])

  const handleCreatePr = useCallback(() => {
    void ipcInvoke(IPC.COMPLETION_PR, { paneId, draft: false })
  }, [paneId])

  const handleResolveConflict = useCallback(() => {
    void ipcInvoke(IPC.COMPLETION_RESOLVE, { paneId })
  }, [paneId])

  const handleAbort = useCallback(() => {
    void ipcInvoke(IPC.COMPLETION_ABORT, { paneId })
  }, [paneId])

  const handleClearError = useCallback(() => {
    ipcSend(IPC.COMPLETION_CLEAR_STATE, { paneId })
  }, [paneId])

  // ---------------------------------------------------------------------------
  // Discard flow
  // ---------------------------------------------------------------------------

  const closeDescriptor: PaneCloseDescriptor | null = pane
    ? {
        status: pane.status,
        isWorktree: pane.isWorktree,
        isUntouched: pane.status === 'awaiting-prompt' && pane.metrics.totalTokens === null,
        hasUncommittedChanges: pane.gitStatus?.hasUncommittedChanges ?? false,
        changedFileCount: pane.gitStatus?.changedFileCount ?? 0,
        commitsAhead: pane.gitStatus?.commitsAhead ?? 0
      }
    : null

  const handleDiscardConfirm = useCallback(
    (action: PaneCloseAction): void => {
      if (action === 'close-non-worktree') {
        ipcSend(IPC.PANE_CLOSE, { paneId })
        onClose()
        return
      }
      if (action === 'merge-close') {
        // Suppressed in this flow — modal filters it out, but defensive guard.
        setDiscardError('Merge & close is not available from the Discard flow.')
        return
      }
      ipcInvoke(IPC.PANE_CLOSE_WORKTREE, { paneId, action })
        .then(() => {
          setShowDiscard(false)
          onClose()
        })
        .catch((err) => setDiscardError(err instanceof Error ? err.message : String(err)))
    },
    [paneId, onClose]
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!pane) {
    // Pane closed out from under us — bail.
    return (
      <Dialog title={t.changesReadyModal.title} size="md" onClose={onClose}>
        <p className="text-sm text-fg-muted">Terminal closed.</p>
      </Dialog>
    )
  }

  const linesAdded = pane.metrics.linesAdded ?? 0
  const linesRemoved = pane.metrics.linesRemoved ?? 0
  const changedFiles = gitStatus?.changedFileCount ?? 0
  const hasError = completion?.state === 'error'
  const hasConflict = completion?.state === 'conflict'

  return (
    <>
      <Dialog
        title={t.changesReadyModal.title}
        subtitle={`${pane.repoName} · ${paneName}`}
        size="lg"
        onClose={onClose}
        footer={
          <div className="w-full flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowDiscard(true)}
              title={t.changesReadyModal.discardTooltip}
              className="inline-flex items-center gap-1.5 text-sm text-danger-fg hover:bg-danger-fg/10 rounded px-2 py-1 transition-colors"
            >
              <Trash2 size={14} />
              <span>{t.changesReadyModal.discard}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowDiff(true)}
              className="inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:bg-overlay rounded px-2 py-1 transition-colors"
            >
              <FileDiff size={14} />
              <span>{t.changesReadyModal.viewDiffs}</span>
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Error banner (transient action failures) */}
          {hasError && (
            <div className="flex items-start gap-2 text-sm text-danger-fg bg-[color-mix(in_oklch,var(--color-danger-fg)_8%,transparent)] border border-[color-mix(in_oklch,var(--color-danger-fg)_35%,transparent)] rounded px-3 py-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
              <div className="flex-1 min-w-0">
                <div className="font-[600]">{t.changesReadyModal.errorBannerTitle}</div>
                <div className="text-xs opacity-90 break-words">
                  {completion?.errorMessage ?? '—'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleClearError}
                className="text-xs underline shrink-0"
              >
                {t.changesReadyModal.errorBannerDismiss}
              </button>
            </div>
          )}

          {/* Conflict banner (sub-state of merge) */}
          {hasConflict && (
            <div className="flex items-center gap-3 text-sm text-warning-fg bg-[color-mix(in_oklch,var(--color-warning-fg)_8%,transparent)] border border-[color-mix(in_oklch,var(--color-warning-fg)_35%,transparent)] rounded px-3 py-2">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <span className="flex-1">{t.completionBar.conflictDetected}</span>
              <button
                type="button"
                onClick={handleResolveConflict}
                className="text-xs underline shrink-0"
              >
                {t.completionBar.resolveWithClaude}
              </button>
              <button
                type="button"
                onClick={handleAbort}
                className="text-xs underline shrink-0"
              >
                {t.completionBar.abort}
              </button>
            </div>
          )}

          {/* Commit list (skeleton — full round grouping deferred). */}
          <section>
            <h3 className="text-xs uppercase tracking-wider text-fg-muted mb-2">
              {t.changesReadyModal.commitsHeader}
            </h3>
            <ul className="text-sm text-fg-primary flex flex-col gap-1">
              {hasUncommitted && (
                <li className="flex items-center gap-2 px-2 py-1 rounded bg-raised">
                  <span className="text-warning-fg shrink-0">●</span>
                  <span className="flex-1 truncate">{t.changesReadyModal.pendingChanges}</span>
                  <span className="text-xs text-fg-muted tabular-nums shrink-0">
                    {t.changesReadyModal.pendingChangesFmt(linesAdded, linesRemoved, changedFiles)}
                  </span>
                </li>
              )}
              {commitsAhead === 0 && !hasUncommitted && (
                <li className="text-xs text-fg-muted italic px-2 py-1">
                  {t.changesReadyModal.noCommits}
                </li>
              )}
              {commitsAhead > 0 && (
                <li className="text-xs text-fg-muted px-2 py-1">
                  {t.kanban.nextStepMerge(commitsAhead)}
                </li>
              )}
            </ul>
          </section>

          {/* Action tree — two paths */}
          <section>
            <div className="flex flex-col gap-3">
              {/* Top path: Commit → Merge → Push to main */}
              <div className="flex items-center gap-2">
                <ActionButton spec={commit} disabled />
                <Connector />
                <ActionButton
                  spec={merge}
                  onClick={handleMerge}
                  disabled={merge.state === 'in-progress' || merge.state === 'queued'}
                />
                <Connector />
                <ActionButton
                  spec={pushToMain}
                  onClick={handlePushToMain}
                  disabled={
                    pushToMain.state === 'in-progress' ||
                    pushToMain.state === 'queued' ||
                    !workspaceId
                  }
                />
              </div>
              {/* Bottom path: Commit → Push to branch → Create PR */}
              <div className="flex items-center gap-2">
                <ActionButton spec={commit} disabled />
                <Connector />
                <ActionButton
                  spec={pushToBranch}
                  onClick={handlePushToBranch}
                  disabled={
                    pushToBranch.state === 'in-progress' ||
                    pushToBranch.state === 'queued' ||
                    ghAvailable === false
                  }
                />
                <Connector />
                <ActionButton
                  spec={createPr}
                  onClick={handleCreatePr}
                  disabled={
                    createPr.state === 'in-progress' ||
                    createPr.state === 'queued' ||
                    ghAvailable === false
                  }
                  tooltip={ghAvailable === false ? t.changesReadyModal.ghMissingTooltip : undefined}
                />
              </div>
            </div>
          </section>
        </div>
      </Dialog>

      {/* Sub-modals */}
      {showDiff && (
        <DiffViewerModal
          paneId={paneId}
          paneName={paneName}
          onClose={() => setShowDiff(false)}
        />
      )}
      {showDiscard && closeDescriptor && (
        <PaneCloseConfirmModal
          repoName={pane.repoName}
          agentName={paneName}
          descriptor={closeDescriptor}
          onCancel={() => { setShowDiscard(false); setDiscardError(null) }}
          onConfirm={handleDiscardConfirm}
          mergeError={discardError}
          suppressMergeClose
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

const STATE_CLASSES: Record<ButtonState, string> = {
  idle: 'border-[var(--color-border-strong)] text-fg-primary hover:bg-overlay',
  queued: 'border-[var(--color-border-strong)] text-fg-muted',
  'in-progress': 'border-[var(--color-status-needs-input)] text-[var(--color-status-needs-input)]',
  success: 'border-success-fg text-success-fg',
  error: 'border-danger-fg text-danger-fg',
  blocked: 'border-[var(--color-border-subtle)] text-fg-muted'
}

function ActionButton({
  spec,
  onClick,
  disabled,
  tooltip
}: {
  spec: ButtonSpec
  onClick?: () => void
  disabled?: boolean
  tooltip?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      title={tooltip ?? spec.tooltip}
      className={`
        inline-flex items-center px-3 py-1.5 rounded border text-sm font-[500]
        transition-colors duration-[80ms]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${STATE_CLASSES[spec.state]}
      `}
    >
      {spec.label}
    </button>
  )
}

function Connector(): React.JSX.Element {
  return <span aria-hidden="true" className="text-fg-subtle">→</span>
}

// ---------------------------------------------------------------------------
// Completion-status → ButtonSpec mapping
//
// Each path button maps the SAME CompletionActionStatus to a different button
// label set. The completion executor only tracks one in-flight action per
// pane, so at most one button per path is in a non-idle state at a time.
// ---------------------------------------------------------------------------

type T = ReturnType<typeof useStrings>

function mapCompletionToCommitButton(s: CompletionActionStatus | null, t: T): ButtonSpec {
  if (!s) return { state: 'idle', label: t.changesReadyModal.actionCommit }
  // Commit happens implicitly inside the executor's merge/PR flows. Once any
  // downstream action is reported, commit is effectively "success".
  if (s.state === 'merging' || s.state === 'rebasing' || s.state === 'pushing' ||
      s.state === 'merged' || s.state === 'pr-created') {
    return { state: 'success', label: t.changesReadyModal.actionCommitted }
  }
  if (s.state === 'queued') return { state: 'queued', label: t.changesReadyModal.actionQueued }
  if (s.state === 'error') return { state: 'error', label: t.changesReadyModal.actionCommitFailed }
  return { state: 'idle', label: t.changesReadyModal.actionCommit }
}

function mapCompletionToMergeButton(s: CompletionActionStatus | null, hasUncommitted: boolean, t: T): ButtonSpec {
  if (!s) return { state: 'idle', label: t.changesReadyModal.actionMergeToMain }
  switch (s.state) {
    case 'queued':
      return { state: 'queued', label: t.changesReadyModal.actionQueued }
    case 'rebasing':
    case 'merging':
      return { state: 'in-progress', label: t.changesReadyModal.actionMerging }
    case 'merged':
      return { state: 'success', label: t.changesReadyModal.actionMerged }
    case 'error':
      return { state: 'error', label: t.changesReadyModal.actionMergeFailed }
    case 'conflict':
    case 'dirty-main':
      return { state: 'error', label: t.changesReadyModal.actionMergeFailed }
    case 'pushing':
    case 'pr-created':
      // PR-side flow active — merge is blocked on the other path.
      return { state: 'blocked', label: hasUncommitted ? t.changesReadyModal.actionAwaitingCommit : t.changesReadyModal.actionMergeToMain }
    default:
      return { state: 'idle', label: t.changesReadyModal.actionMergeToMain }
  }
}

function mapCompletionToPushMainButton(s: CompletionActionStatus | null, t: T): ButtonSpec {
  if (!s) return { state: 'idle', label: t.changesReadyModal.actionPushToMain }
  switch (s.state) {
    case 'merged':
      // Local merge done; remote push not yet attempted.
      return { state: 'idle', label: t.changesReadyModal.actionPushToMain }
    case 'rebasing':
    case 'merging':
      return { state: 'blocked', label: t.changesReadyModal.actionAwaitingMerge }
    case 'pushing':
      return { state: 'in-progress', label: t.changesReadyModal.actionPushing }
    case 'error':
      return { state: 'error', label: t.changesReadyModal.actionPushFailed }
    default:
      return { state: 'idle', label: t.changesReadyModal.actionPushToMain }
  }
}

function mapCompletionToPushBranchButton(s: CompletionActionStatus | null, hasUncommitted: boolean, t: T): ButtonSpec {
  if (!s) return { state: 'idle', label: t.changesReadyModal.actionPushToBranch }
  switch (s.state) {
    case 'pushing':
      return { state: 'in-progress', label: t.changesReadyModal.actionPushing }
    case 'pr-created':
      return { state: 'success', label: t.changesReadyModal.actionPushed }
    case 'queued':
      return { state: 'queued', label: t.changesReadyModal.actionQueued }
    case 'error':
      return { state: 'error', label: t.changesReadyModal.actionPushFailed }
    case 'rebasing':
    case 'merging':
    case 'merged':
      return { state: 'blocked', label: hasUncommitted ? t.changesReadyModal.actionAwaitingCommit : t.changesReadyModal.actionPushToBranch }
    default:
      return { state: 'idle', label: t.changesReadyModal.actionPushToBranch }
  }
}

function mapCompletionToCreatePrButton(s: CompletionActionStatus | null, ghAvailable: boolean | null, t: T): ButtonSpec {
  if (ghAvailable === false) return { state: 'blocked', label: t.changesReadyModal.actionCreatePr }
  if (!s) return { state: 'idle', label: t.changesReadyModal.actionCreatePr }
  switch (s.state) {
    case 'pushing':
      return { state: 'in-progress', label: t.changesReadyModal.actionCreatingPr }
    case 'pr-created':
      return { state: 'success', label: t.changesReadyModal.actionPrOpened }
    case 'error':
      return { state: 'error', label: t.changesReadyModal.actionPrFailed }
    case 'queued':
      return { state: 'queued', label: t.changesReadyModal.actionQueued }
    case 'rebasing':
    case 'merging':
    case 'merged':
      // Merge path is active; create-PR is blocked.
      return { state: 'blocked', label: t.changesReadyModal.actionAwaitingPush }
    default:
      return { state: 'idle', label: t.changesReadyModal.actionCreatePr }
  }
}
