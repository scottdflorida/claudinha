import React, { useCallback, useEffect, useState } from 'react'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { IPC } from '../../shared/ipc-channels'
import type {
  CompletionResolvePayload,
  CompletionResolveResult,
  CompletionAbortPayload,
  CompletionAbortResult
} from '../../shared/ipc-channels'
import { ipcInvoke } from '../hooks/useIpc'
import type { RendererPane } from '../hooks/usePaneState'
import { useStrings } from '../lib/strings'

interface ConflictResolveModalProps {
  pane: RendererPane
  onClose: () => void
}

/**
 * ConflictResolveModal — opens when a Kanban pane enters
 * `completionStatus.state === 'conflict'` and offers the same per-pane
 * recovery affordances CompletionActionBar exposes in Wall mode (Resolve
 * with Claude, Abort). Without this modal the Kanban view would dead-end on
 * conflict the same way it used to dead-end on dirty-main — per L-044 on
 * mode-gated components hiding their recovery affordances along with their
 * orchestration ones.
 */
export function ConflictResolveModal({ pane, onClose }: ConflictResolveModalProps): React.JSX.Element | null {
  const t = useStrings()

  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [abortArmed, setAbortArmed] = useState(false)

  // If the pane leaves the conflict state (e.g. Claude finished resolving
  // and the rebase continued to Merged), close the modal automatically so
  // the user doesn't have to dismiss a now-meaningless dialog.
  useEffect(() => {
    if (pane.completionStatus?.state !== 'conflict') {
      onClose()
    }
  }, [pane.completionStatus?.state, onClose])

  const handleResolve = useCallback(async () => {
    if (inFlight) return
    setInFlight(true)
    setError(null)
    try {
      const payload: CompletionResolvePayload = { paneId: pane.id }
      const res = await ipcInvoke(IPC.COMPLETION_RESOLVE, payload) as CompletionResolveResult
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
  }, [inFlight, pane.id, onClose])

  const handleAbort = useCallback(async () => {
    if (inFlight) return
    if (!abortArmed) {
      setAbortArmed(true)
      setError(null)
      return
    }
    setInFlight(true)
    setError(null)
    try {
      const payload: CompletionAbortPayload = { paneId: pane.id }
      const res = await ipcInvoke(IPC.COMPLETION_ABORT, payload) as CompletionAbortResult
      if (res.error) {
        setError(res.error)
        setInFlight(false)
        setAbortArmed(false)
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setInFlight(false)
      setAbortArmed(false)
    }
  }, [inFlight, abortArmed, pane.id, onClose])

  if (pane.completionStatus?.state !== 'conflict') return null

  return (
    <Dialog
      title={t.conflictModal.title}
      subtitle={t.conflictModal.subtitleFmt(pane.repoName, pane.worktreeName)}
      size="md"
      onClose={onClose}
      footer={
        <>
          <div />
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t.conflictModal.closeAction}
            </Button>
          </div>
        </>
      }
    >
      <p className="mb-4 text-sm text-fg-secondary">{t.conflictModal.body}</p>

      {error && (
        <div className="mb-3 text-xs text-danger-fg">
          <span className="font-[600]">{t.conflictModal.errorPrefix} </span>
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="primary"
          size="sm"
          disabled={inFlight}
          onClick={handleResolve}
        >
          {t.conflictModal.resolveAction}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          destructive
          disabled={inFlight}
          onClick={handleAbort}
          title={abortArmed ? t.conflictModal.abortConfirmHint : undefined}
        >
          {abortArmed ? t.conflictModal.abortConfirm : t.conflictModal.abortAction}
        </Button>
      </div>
    </Dialog>
  )
}
