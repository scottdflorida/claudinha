import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { IPC } from '../../shared/ipc-channels'
import type {
  GitCommitDirtyMainPayload,
  GitCommitDirtyMainResult,
  GitStashDirtyMainPayload,
  GitStashDirtyMainResult,
  GitDiscardDirtyMainPayload,
  GitDiscardDirtyMainResult,
  CompletionMergePayload,
  WorkspaceRevealPathPayload
} from '../../shared/ipc-channels'
import type { MergeStrategy, CompletionActionState } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { usePaneState } from '../hooks/usePaneState'
import type { RendererPane } from '../hooks/usePaneState'
import { useStrings } from '../lib/strings'

interface DirtyMainModalProps {
  pane: RendererPane
  onClose: () => void
}

/**
 * Completion states that imply another pane in the same repo currently holds
 * (or is about to hold) the repo's index.lock via a merge. Disables commit /
 * stash / discard while any of these are in play for a sibling pane — prevents
 * the user from racing their cleanup into an in-flight merge (L-022).
 */
const BUSY_STATES: ReadonlySet<CompletionActionState> = new Set<CompletionActionState>([
  'queued',
  'rebasing',
  'merging',
  'pushing'
])

/**
 * DirtyMainModal — surfaces the dirty-main file list with in-app resolution
 * actions when a Kanban merge fails because main has uncommitted changes.
 *
 * The file list comes directly from `pane.completionStatus.dirtyMain.files`,
 * which the main process has already filtered for Claudinha infrastructure
 * (`.worktrees/`, `.claude/`). The modal forwards that same list to the
 * commit/stash/discard IPC handlers, which re-apply the filter server-side
 * as a defence-in-depth measure.
 */
export function DirtyMainModal({ pane, onClose }: DirtyMainModalProps): React.JSX.Element | null {
  const t = useStrings()
  const paneStore = usePaneState()
  const dm = pane.completionStatus?.dirtyMain

  const [commitExpanded, setCommitExpanded] = useState(false)
  const [commitMessage, setCommitMessage] = useState(t.dirtyMainModal.commitMessageDefault)
  const [discardArmed, setDiscardArmed] = useState(false)
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Whether some *other* pane in the same repo currently holds a merge-related
  // state. We enumerate the pane list once per render — cheap (typically <10
  // panes per workspace) and avoids another IPC round-trip.
  const mergeBusy = useMemo(() => {
    if (!dm?.path) return false
    for (const other of paneStore.panes) {
      if (other.id === pane.id) continue
      // Approximate "same repo" by shared worktreePath prefix — the main
      // process owns the canonical repo-root derivation; here we just need a
      // conservative gate. A pane whose worktreePath sits under the dirty
      // repo root is, by construction, in the same repo group.
      if (!other.worktreePath.startsWith(dm.path)) continue
      const st = other.completionStatus?.state
      if (st && BUSY_STATES.has(st)) return true
    }
    return false
  }, [paneStore.panes, pane.id, dm?.path])

  // Clear the armed-discard state if the user interacts elsewhere.
  const cancelDiscardArm = useCallback(() => setDiscardArmed(false), [])

  // If the pane drops out of dirty-main (e.g. the user resolved it from the
  // Wall view in parallel), close the modal automatically.
  useEffect(() => {
    if (pane.completionStatus?.state !== 'dirty-main') {
      onClose()
    }
  }, [pane.completionStatus?.state, onClose])

  if (!dm) return null

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------

  const handleCommit = useCallback(async () => {
    if (inFlight || mergeBusy) return
    cancelDiscardArm()
    setInFlight(true)
    setError(null)
    try {
      const payload: GitCommitDirtyMainPayload = {
        repoPath: dm.path,
        message: commitMessage,
        files: dm.files
      }
      const res = await ipcInvoke(IPC.GIT_COMMIT_DIRTY_MAIN, payload) as GitCommitDirtyMainResult
      if (res.error) {
        setError(res.error)
        setInFlight(false)
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setInFlight(false)
    }
  }, [inFlight, mergeBusy, dm, commitMessage, onClose, cancelDiscardArm])

  const handleStash = useCallback(async () => {
    if (inFlight || mergeBusy) return
    cancelDiscardArm()
    setInFlight(true)
    setError(null)
    try {
      const payload: GitStashDirtyMainPayload = {
        repoPath: dm.path,
        message: t.dirtyMainModal.stashMessageDefault,
        files: dm.files
      }
      const res = await ipcInvoke(IPC.GIT_STASH_DIRTY_MAIN, payload) as GitStashDirtyMainResult
      if (res.error) {
        setError(res.error)
        setInFlight(false)
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setInFlight(false)
    }
  }, [inFlight, mergeBusy, dm, t.dirtyMainModal.stashMessageDefault, onClose, cancelDiscardArm])

  const handleDiscard = useCallback(async () => {
    if (inFlight || mergeBusy) return
    // Two-click guard: first click arms, second click fires.
    if (!discardArmed) {
      setDiscardArmed(true)
      setError(null)
      return
    }
    setInFlight(true)
    setError(null)
    try {
      const payload: GitDiscardDirtyMainPayload = {
        repoPath: dm.path,
        files: dm.files
      }
      const res = await ipcInvoke(IPC.GIT_DISCARD_DIRTY_MAIN, payload) as GitDiscardDirtyMainResult
      if (res.error) {
        setError(res.error)
        setInFlight(false)
        setDiscardArmed(false)
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setInFlight(false)
      setDiscardArmed(false)
    }
  }, [inFlight, mergeBusy, discardArmed, dm, onClose])

  const handleReveal = useCallback(() => {
    cancelDiscardArm()
    const payload: WorkspaceRevealPathPayload = { path: dm.path }
    void ipcInvoke(IPC.WORKSPACE_REVEAL_PATH, payload)
  }, [dm.path, cancelDiscardArm])

  const handleRetry = useCallback(() => {
    cancelDiscardArm()
    const payload: CompletionMergePayload = { paneId: pane.id, strategy: 'rebase-ff' as MergeStrategy }
    void ipcInvoke(IPC.COMPLETION_MERGE, payload)
    onClose()
  }, [pane.id, onClose, cancelDiscardArm])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const baseBranch = pane.gitStatus?.branchName ?? 'main'
  const subtitle = t.dirtyMainModal.subtitleFmt(pane.repoName, baseBranch)
  const visibleFiles = dm.files.slice(0, 10)
  const overflowCount = dm.totalCount - visibleFiles.length

  return (
    <Dialog
      title={t.dirtyMainModal.title}
      subtitle={subtitle}
      size="md"
      onClose={onClose}
      footer={
        <>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleReveal}>
              {t.dirtyMainModal.revealAction}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRetry}>
              {t.dirtyMainModal.retryAction}
            </Button>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t.dirtyMainModal.closeAction}
            </Button>
          </div>
        </>
      }
    >
      {/* File list */}
      <div className="mb-4">
        <div className="text-xs font-[600] text-fg-muted uppercase tracking-wider mb-2">
          {t.dirtyMainModal.fileListHeader}
        </div>
        <ul className="text-xs font-mono bg-raised rounded px-3 py-2 max-h-[30vh] overflow-auto">
          {visibleFiles.map((f) => (
            <li key={f} className="text-fg-primary truncate" title={f}>
              {f}
            </li>
          ))}
          {overflowCount > 0 && (
            <li className="text-fg-muted italic">
              {t.dirtyMainModal.moreFiles(overflowCount)}
            </li>
          )}
        </ul>
      </div>

      {/* Busy banner — main process would also reject these but the disable
          state keeps the user from hitting them in the first place. */}
      {mergeBusy && (
        <div className="mb-3 text-xs text-warning-fg">
          {t.dirtyMainModal.busyMessage}
        </div>
      )}

      {/* Error banner — latest action's error, if any. */}
      {error && (
        <div className="mb-3 text-xs text-danger-fg">
          <span className="font-[600]">{t.dirtyMainModal.errorPrefix} </span>
          {error}
        </div>
      )}

      {/* Commit message expander */}
      {commitExpanded && (
        <div className="mb-4 flex flex-col gap-2">
          <label className="text-xs font-[600] text-fg-muted uppercase tracking-wider">
            {t.dirtyMainModal.commitMessageLabel}
          </label>
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commitMessage.trim()) {
                e.preventDefault()
                void handleCommit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setCommitExpanded(false)
              }
            }}
            autoFocus
            className="bg-canvas border border-[var(--color-border-subtle)] rounded px-2 py-1 text-sm text-fg-primary outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={inFlight || mergeBusy || !commitMessage.trim()}
              onClick={handleCommit}
            >
              {t.dirtyMainModal.commitConfirm}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCommitExpanded(false)}
              disabled={inFlight}
            >
              {t.dirtyMainModal.commitCancel}
            </Button>
          </div>
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 flex-wrap">
        {!commitExpanded && (
          <Button
            variant="primary"
            size="sm"
            disabled={inFlight || mergeBusy}
            onClick={() => { cancelDiscardArm(); setCommitExpanded(true) }}
          >
            {t.dirtyMainModal.commitAction}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={inFlight || mergeBusy || commitExpanded}
          onClick={handleStash}
        >
          {t.dirtyMainModal.stashAction}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          destructive
          disabled={inFlight || mergeBusy || commitExpanded}
          onClick={handleDiscard}
          title={discardArmed ? t.dirtyMainModal.discardConfirmHint : undefined}
        >
          {discardArmed ? t.dirtyMainModal.discardConfirm : t.dirtyMainModal.discardAction}
        </Button>
      </div>
    </Dialog>
  )
}
