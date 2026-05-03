import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, FileDiff, Pencil, Trash2, X } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { CommitInfo, GhCliCheckResult, GitCommitAllResult, GitPaneCommitLogResult, GitRewordCommitResult } from '../../shared/ipc-channels'
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
  /** When the modal is opened via Cmd+Shift+G or Cmd+Shift+R, pre-focus the
   *  matching action button so the keyboard user can hit Enter immediately.
   *  Cold opens (CTA / pill click) pass null. */
  initialFocus?: 'merge' | 'pr' | null
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
  initialFocus = null,
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
  // Commit list — fetched on open and refreshed on Commit / Reword / Merge.
  //
  // A commit list refresh follows: the modal reads gitStatus (pulse-driven by
  // the workspace poller) plus an explicit fetch each time a structural git
  // op succeeds inside the modal. Refetch is also triggered when the pane's
  // commitsAhead changes — that catches external commits made via PTY.
  // ---------------------------------------------------------------------------
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [commitsError, setCommitsError] = useState<string | null>(null)
  const refreshCommits = useCallback((): void => {
    ipcInvoke(IPC.GIT_PANE_COMMIT_LOG, { paneId })
      .then((res) => {
        const r = res as GitPaneCommitLogResult
        setCommitsError(r.error)
        setCommits(r.commits ?? [])
      })
      .catch((err) => {
        setCommitsError(err instanceof Error ? err.message : String(err))
        setCommits([])
      })
  }, [paneId])
  useEffect(() => { refreshCommits() }, [refreshCommits])
  const seenAhead = useRef<number | null>(null)
  useEffect(() => {
    const ahead = pane?.gitStatus?.commitsAhead ?? 0
    if (seenAhead.current !== null && seenAhead.current !== ahead) {
      refreshCommits()
    }
    seenAhead.current = ahead
  }, [pane?.gitStatus?.commitsAhead, refreshCommits])

  // ---------------------------------------------------------------------------
  // Pending commit message — the synthesized default is editable inline. The
  // value is held locally until the user clicks the Commit-now glyph; on
  // success, we refetch the commit list (the new commit appears at the top)
  // and reset the draft to a fresh default for the next round.
  // ---------------------------------------------------------------------------
  const linesAddedRaw = pane?.metrics.linesAdded ?? 0
  const linesRemovedRaw = pane?.metrics.linesRemoved ?? 0
  const changedFiles = pane?.gitStatus?.changedFileCount ?? 0
  const defaultPendingMessage = useMemo(() => {
    if (changedFiles === 0) return ''
    const fileWord = changedFiles === 1 ? 'file' : 'files'
    return `Update ${changedFiles} ${fileWord} (+${linesAddedRaw}/-${linesRemovedRaw})`
  }, [changedFiles, linesAddedRaw, linesRemovedRaw])
  const [pendingMessage, setPendingMessage] = useState(defaultPendingMessage)
  const userEditedPending = useRef(false)
  useEffect(() => {
    // Re-sync to a freshly synthesized default when the user hasn't typed
    // anything yet; otherwise preserve their draft across re-renders.
    if (!userEditedPending.current) setPendingMessage(defaultPendingMessage)
  }, [defaultPendingMessage])

  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const handleCommitNow = useCallback((): void => {
    const msg = pendingMessage.trim()
    if (!msg || committing) return
    setCommitting(true)
    setCommitError(null)
    ipcInvoke(IPC.GIT_COMMIT_ALL, { paneId, message: msg })
      .then((res) => {
        const r = res as GitCommitAllResult
        if (r.error) {
          setCommitError(r.error)
          return
        }
        userEditedPending.current = false
        setPendingMessage(defaultPendingMessage)
        refreshCommits()
      })
      .catch((err) => setCommitError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCommitting(false))
  }, [paneId, pendingMessage, committing, defaultPendingMessage, refreshCommits])

  // Reword state — exactly one row in edit mode at a time.
  const [editingSha, setEditingSha] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [rewording, setRewording] = useState(false)
  const [rewordError, setRewordError] = useState<string | null>(null)
  const startReword = useCallback((c: CommitInfo) => {
    setEditingSha(c.sha)
    setEditingDraft(c.body ? `${c.subject}\n\n${c.body}` : c.subject)
    setRewordError(null)
  }, [])
  const cancelReword = useCallback(() => {
    setEditingSha(null)
    setEditingDraft('')
    setRewordError(null)
  }, [])
  const saveReword = useCallback((): void => {
    if (!editingSha || rewording) return
    const msg = editingDraft.trim()
    if (!msg) {
      setRewordError('Commit message cannot be empty.')
      return
    }
    setRewording(true)
    setRewordError(null)
    ipcInvoke(IPC.GIT_REWORD_COMMIT, { paneId, sha: editingSha, message: msg })
      .then((res) => {
        const r = res as GitRewordCommitResult
        if (r.error) {
          setRewordError(r.error)
          return
        }
        setEditingSha(null)
        setEditingDraft('')
        refreshCommits()
      })
      .catch((err) => setRewordError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRewording(false))
  }, [editingSha, editingDraft, paneId, rewording, refreshCommits])

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

  // initialFocus: when set, focus the matching action button after first paint
  // so a Cmd+Shift+G / Cmd+Shift+R user can hit Enter immediately. The refs
  // resolve once the buttons mount; useEffect below runs after that.
  const mergeBtnRef = useRef<HTMLButtonElement | null>(null)
  const createPrBtnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (initialFocus === 'merge') mergeBtnRef.current?.focus()
    else if (initialFocus === 'pr') createPrBtnRef.current?.focus()
  }, [initialFocus])

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

  const handleRevealWorktree = useCallback(() => {
    if (!pane) return
    void ipcInvoke(IPC.WORKSPACE_REVEAL_PATH, { path: pane.worktreePath })
  }, [pane])

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
      // `merge-close` is filtered out of the close-options menu via the
      // `suppressMergeClose` prop, so it's unreachable here.
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

  const linesAdded = linesAddedRaw
  const linesRemoved = linesRemovedRaw
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
                onClick={handleRevealWorktree}
                className="text-xs underline shrink-0"
              >
                {t.changesReadyModal.revealWorktree}
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

          {/* Commit list. Pending row at top is editable; existing commits are
              read-only unless the row's pencil is clicked. Pencil is hidden
              on pushed rows (force-push territory) and disabled on all rows
              while the worktree is dirty (rebase requires a clean tree). */}
          <section>
            <h3 className="text-xs uppercase tracking-wider text-fg-muted mb-2">
              {t.changesReadyModal.commitsHeader}
            </h3>
            <ul className="text-sm text-fg-primary flex flex-col gap-1">
              {hasUncommitted && (
                <li className="flex items-start gap-2 px-2 py-1 rounded bg-raised">
                  <span className="text-warning-fg shrink-0 mt-1.5" aria-hidden="true">●</span>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="truncate text-xs text-fg-muted">
                        {t.changesReadyModal.pendingChanges}
                      </span>
                      <span className="text-xs text-fg-muted tabular-nums shrink-0 ml-auto">
                        {t.changesReadyModal.pendingChangesFmt(linesAdded, linesRemoved, changedFiles)}
                      </span>
                    </div>
                    <textarea
                      value={pendingMessage}
                      onChange={(e) => {
                        userEditedPending.current = true
                        setPendingMessage(e.target.value)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          handleCommitNow()
                        }
                      }}
                      placeholder={t.changesReadyModal.pendingMessagePlaceholder}
                      rows={1}
                      className="w-full text-sm bg-canvas border border-[var(--color-border-subtle)] rounded px-2 py-1 outline-none focus:ring-1 focus:ring-accent resize-y min-h-[28px]"
                    />
                    {commitError && (
                      <span className="text-xs text-danger-fg break-words">{commitError}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleCommitNow}
                    disabled={committing || !pendingMessage.trim()}
                    aria-label={t.changesReadyModal.commitNowAria}
                    title={t.changesReadyModal.actionCommit}
                    className="shrink-0 mt-1 text-fg-muted hover:text-success-fg disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check size={14} />
                  </button>
                </li>
              )}

              {commitsError && (
                <li className="text-xs text-danger-fg italic px-2 py-1">
                  {t.changesReadyModal.commitListLoadError}
                </li>
              )}

              {!commitsError && commits.length === 0 && !hasUncommitted && (
                <li className="text-xs text-fg-muted italic px-2 py-1">
                  {t.changesReadyModal.noCommits}
                </li>
              )}

              {commits.map((c, i) => {
                // Round boundary: emit a "Pushed to branch" header at the row
                // where pushed flips false → true. Commits arrive newest-first,
                // so this divides the implicit "current round" (above) from
                // the pushed round (below). Merged-to-main / PR # rounds are
                // deferred until the gh probe lands.
                const prev = i > 0 ? commits[i - 1] : null
                const showPushedHeader = c.pushed && (!prev || !prev.pushed)
                const isEditing = editingSha === c.sha
                const editBlocked = c.pushed
                  ? t.changesReadyModal.rewordPushedTooltip
                  : hasUncommitted
                    ? t.changesReadyModal.rewordDirtyTooltip
                    : null
                return (
                  <React.Fragment key={c.sha}>
                    {showPushedHeader && (
                      <li className="px-2 pt-2 pb-0.5 text-[11px] uppercase tracking-wider text-fg-muted select-none">
                        {t.changesReadyModal.roundPushed}
                      </li>
                    )}
                  <li
                    className="flex items-start gap-2 px-2 py-1 rounded hover:bg-overlay group/commit"
                  >
                    <span
                      className={`shrink-0 mt-1.5 text-xs tabular-nums font-mono ${c.pushed ? 'text-fg-subtle' : 'text-fg-muted'}`}
                      title={c.sha}
                    >
                      {c.shortSha}
                    </span>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex flex-col gap-1">
                          <textarea
                            autoFocus
                            value={editingDraft}
                            onChange={(e) => setEditingDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelReword()
                              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault()
                                saveReword()
                              }
                            }}
                            rows={Math.min(8, Math.max(2, editingDraft.split('\n').length))}
                            className="w-full text-sm bg-canvas border border-[var(--color-border-subtle)] rounded px-2 py-1 outline-none focus:ring-1 focus:ring-accent resize-y"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={saveReword}
                              disabled={rewording || !editingDraft.trim()}
                              className="text-xs text-success-fg hover:underline disabled:opacity-40"
                            >
                              {t.changesReadyModal.rewordSave}
                            </button>
                            <button
                              type="button"
                              onClick={cancelReword}
                              disabled={rewording}
                              className="text-xs text-fg-muted hover:underline disabled:opacity-40"
                            >
                              {t.changesReadyModal.rewordCancel}
                            </button>
                            <span className="text-xs text-fg-subtle">
                              {t.changesReadyModal.rewordSaveHint}
                            </span>
                            {rewordError && (
                              <span className="text-xs text-danger-fg ml-auto break-words">
                                {rewordError}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className={`truncate ${c.pushed ? 'text-fg-secondary' : 'text-fg-primary'}`} title={c.subject}>
                            {c.subject || <span className="italic text-fg-subtle">(no subject)</span>}
                          </div>
                          {c.body && (
                            <div className="text-xs text-fg-muted whitespace-pre-wrap mt-0.5 line-clamp-3">
                              {c.body}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {!isEditing && !editBlocked && (
                      <button
                        type="button"
                        onClick={() => startReword(c)}
                        aria-label={t.changesReadyModal.rewordTitle}
                        title={t.changesReadyModal.rewordTitle}
                        className="shrink-0 mt-1 text-fg-muted hover:text-fg-primary opacity-0 group-hover/commit:opacity-100 transition-opacity"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                    {!isEditing && editBlocked && (
                      <span
                        title={editBlocked}
                        aria-label={editBlocked}
                        className="shrink-0 mt-1 text-fg-subtle"
                      >
                        <Pencil size={12} />
                      </span>
                    )}
                    {isEditing && rewordError && !rewordError.length && (
                      <X size={12} className="shrink-0 mt-1 text-danger-fg" />
                    )}
                  </li>
                  </React.Fragment>
                )
              })}
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
                  ref={mergeBtnRef}
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
                  ref={createPrBtnRef}
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

const ActionButton = React.forwardRef<HTMLButtonElement, {
  spec: ButtonSpec
  onClick?: () => void
  disabled?: boolean
  tooltip?: string
}>(function ActionButton({ spec, onClick, disabled, tooltip }, ref) {
  return (
    <button
      ref={ref}
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
})

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
