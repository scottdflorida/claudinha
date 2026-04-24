import React from 'react'
import { Dialog, DialogCancel, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// PermissionRemoveConfirmModal — confirmation for removing a rule from the
// Permissions Manager view.
// ---------------------------------------------------------------------------

interface PermissionRemoveConfirmModalProps {
  ruleValue: string
  list: 'allow' | 'deny'
  source: 'default' | 'user'
  onConfirm: () => void
  onCancel: () => void
}

export function PermissionRemoveConfirmModal({
  ruleValue,
  list,
  source,
  onConfirm,
  onCancel
}: PermissionRemoveConfirmModalProps): React.JSX.Element {
  const t = useStrings()
  const listLabel = list === 'allow' ? t.permissionRemoveConfirm.listAllow : t.permissionRemoveConfirm.listDeny
  const subtext = source === 'default'
    ? t.permissionRemoveConfirm.subtextDefault
    : t.permissionRemoveConfirm.subtextUser

  return (
    <Dialog
      title={t.permissionRemoveConfirm.modalTitle}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <DialogCancel onClick={onCancel}>{t.permissionRemoveConfirm.cancel}</DialogCancel>
          <DialogActions>
            <Button variant="primary" destructive onClick={onConfirm}>{t.permissionRemoveConfirm.confirm}</Button>
          </DialogActions>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-primary">
          {t.permissionRemoveConfirm.bodyFmt(ruleValue, listLabel)}
        </p>
        <p className="text-sm text-fg-secondary">
          {subtext}
        </p>
      </div>
    </Dialog>
  )
}
