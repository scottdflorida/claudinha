import React from 'react'
import { Dialog, DialogCancel, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// ArchiveWorkspaceConfirmModal
// ---------------------------------------------------------------------------

interface ArchiveWorkspaceConfirmModalProps {
  workspaceName: string
  pausedTerminalCount: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * ArchiveWorkspaceConfirmModal — confirmation dialog for archiving a dormant workspace.
 *
 * Archiving is reversible, so this uses a standard (non-destructive) confirm.
 * Cancel is the safe default.
 */
export function ArchiveWorkspaceConfirmModal({
  workspaceName,
  pausedTerminalCount,
  onConfirm,
  onCancel
}: ArchiveWorkspaceConfirmModalProps): React.JSX.Element {
  const t = useStrings()
  return (
    <Dialog
      title={t.archiveModal.title}
      size="xs"
      onClose={onCancel}
      footer={
        <>
          <DialogCancel onClick={onCancel}>{t.archiveModal.cancel}</DialogCancel>
          <DialogActions>
            <Button variant="primary" onClick={onConfirm}>{t.archiveModal.confirm}</Button>
          </DialogActions>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm font-[500] text-fg-primary">{workspaceName}</p>
        <p className="text-sm text-fg-secondary">
          {t.archiveModal.bodyIntro}
        </p>
        {pausedTerminalCount > 0 && (
          <p className="text-sm text-fg-secondary">
            {t.archiveModal.bodySnapshotCount(pausedTerminalCount)}
          </p>
        )}
      </div>
    </Dialog>
  )
}
