import React, { useState } from 'react'
import { Dialog, DialogCancel, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { TextInput } from './ui/TextInput'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// PermanentDeleteWorkspaceConfirmModal — destructive confirmation for archive view
// ---------------------------------------------------------------------------

interface PermanentDeleteWorkspaceConfirmModalProps {
  workspaceName: string
  pausedTerminalCount: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * PermanentDeleteWorkspaceConfirmModal — typed-confirm gate for permanent deletion.
 *
 * Requires the user to type the workspace name exactly before Delete is enabled.
 * Cancel is always available.
 */
export function PermanentDeleteWorkspaceConfirmModal({
  workspaceName,
  pausedTerminalCount,
  onConfirm,
  onCancel
}: PermanentDeleteWorkspaceConfirmModalProps): React.JSX.Element {
  const t = useStrings()
  const [confirmText, setConfirmText] = useState('')
  const canDelete = confirmText === workspaceName

  return (
    <Dialog
      title={t.permanentDeleteModal.title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <DialogCancel onClick={onCancel}>{t.permanentDeleteModal.cancel}</DialogCancel>
          <DialogActions>
            <Button variant="primary" destructive onClick={onConfirm} disabled={!canDelete}>
              {t.permanentDeleteModal.confirm}
            </Button>
          </DialogActions>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-[500] text-fg-primary">{workspaceName}</p>
          <p className="text-sm text-danger-fg font-[500]">{t.permanentDeleteModal.cannotUndo}</p>
          {pausedTerminalCount > 0 && (
            <p className="text-sm text-fg-secondary">
              {t.permanentDeleteModal.snapshotLoss(pausedTerminalCount)}
            </p>
          )}
        </div>
        <TextInput
          label={t.permanentDeleteModal.typeToConfirm(workspaceName)}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={workspaceName}
          autoFocus
        />
      </div>
    </Dialog>
  )
}
