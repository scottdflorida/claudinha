import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogCancel, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import type { PaneCloseAction } from '../../shared/types'
import { buildPaneCloseOptions, type PaneCloseDescriptor, type PaneCloseOption } from '../lib/pane-close-options'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// PaneCloseConfirmModal — unified status-aware close confirmation.
// Bypass decisions are made by the caller (see buildPaneCloseOptions); this
// component only renders when the caller has decided a modal is required.
// ---------------------------------------------------------------------------

export interface PaneCloseConfirmModalProps {
  /** Display name of the repo (e.g., "claudinha"). */
  repoName: string
  /** Preferred display name — sessionTitle, falling back to worktreeName. */
  agentName: string
  /** Everything needed to pick the option set. Driven directly by pane state. */
  descriptor: PaneCloseDescriptor
  /** Called when the user dismisses the modal (Cancel / Esc / backdrop).
   *  When sequenceControls is set, this is wired to onCancelSequence. */
  onCancel: () => void
  /** Called with the chosen close action. */
  onConfirm: (action: PaneCloseAction) => void
  /** When set, renders a red error banner inside the modal body. Used to
   *  surface merge conflicts / dirty-main errors coming back from the
   *  Merge & close action. */
  mergeError?: string | null
  /** When true, all action buttons are disabled (e.g., merge request in flight). */
  pending?: boolean
  /** Optional banner rendered as a top strip above the header — used for the
   *  workspace close sequence chrome (breadcrumb + override button). */
  topBanner?: React.ReactNode
  /** When present, the modal is part of a workspace close sequence: renders
   *  the close (X) button off, blocks Esc, and switches Cancel copy to the
   *  sequence wording. The override button lives in the banner, not here. */
  sequenceControls?: {
    cancelLabel: string
  }
}

export function PaneCloseConfirmModal({
  repoName,
  agentName,
  descriptor,
  onCancel,
  onConfirm,
  mergeError,
  pending,
  topBanner,
  sequenceControls
}: PaneCloseConfirmModalProps): React.JSX.Element {
  const t = useStrings()
  const resolution = buildPaneCloseOptions(descriptor)

  // Split buttons — primary goes to the right, everything else left-adjacent to Cancel.
  const primary = resolution.buttons.find((b) => b.variant === 'primary')
  const others = resolution.buttons.filter((b) => b.variant !== 'primary')

  const cancelLabel = sequenceControls?.cancelLabel ?? t.paneCloseConfirm.cancelKeepOpen
  // Widen the dialog when a close sequence is active so the banner has room
  // for both the breadcrumb and the override button, and the footer has room
  // for the four-button done-unmerged case.
  const dialogSize: 'md' | 'lg' = sequenceControls ? 'lg' : 'md'

  return (
    <Dialog
      title={t.paneCloseConfirm.title}
      subtitle={`${repoName} · ${agentName}`}
      size={dialogSize}
      onClose={onCancel}
      blocking={Boolean(sequenceControls)}
      showClose={!sequenceControls}
      banner={topBanner}
      footer={
        <>
          <DialogCancel onClick={onCancel}>{cancelLabel}</DialogCancel>
          <DialogActions>
            {others.map((opt) => (
              <ActionButton key={opt.action} opt={opt} disabled={pending} onClick={() => onConfirm(opt.action)} />
            ))}
            {primary && (
              <ActionButton opt={primary} disabled={pending} onClick={() => onConfirm(primary.action)} />
            )}
          </DialogActions>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex gap-3">
            <span className="text-fg-muted w-16 flex-shrink-0">{t.paneCloseConfirm.statusLabel}</span>
            <span className="text-fg-primary">{resolution.statusLine}</span>
          </div>
          {descriptor.isWorktree && (
            <div className="flex gap-3">
              <span className="text-fg-muted w-16 flex-shrink-0">{t.paneCloseConfirm.gitLabel}</span>
              <span className={resolution.unmergedCallout ? 'text-warning-fg' : 'text-fg-secondary'}>
                {resolution.unmergedCallout ?? t.paneCloseConfirm.clean}
              </span>
            </div>
          )}
        </div>

        {/* Busy / error warning — the user is interrupting in-flight work. */}
        {isBusyState(descriptor.status) && (
          <div className="flex items-start gap-2 text-sm text-warning-fg">
            <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
            <span>
              {descriptor.status === 'working'
                ? t.paneCloseConfirm.warnWorking
                : descriptor.status === 'needs-input'
                  ? t.paneCloseConfirm.warnNeedsInput
                  : t.paneCloseConfirm.warnError}
            </span>
          </div>
        )}

        {/* Prune-with-uncommitted warning — inline destructive notice. */}
        {resolution.buttons.some((b) => b.action === 'prune-close' && b.warning) && (
          <div className="flex items-start gap-2 text-sm text-danger-fg">
            <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
            <span>
              {resolution.buttons.find((b) => b.action === 'prune-close')?.warning}
            </span>
          </div>
        )}

        {/* Resume-from-Management hint — shown for non-merge close paths on
            worktree panes so the user knows the session isn't lost. */}
        {descriptor.isWorktree && resolution.buttons.some((b) => b.action === 'keep-close') && (
          <p className="text-xs text-fg-muted">
            {t.paneCloseConfirm.resumableHint}
          </p>
        )}

        {/* Merge error banner — shown only after a Merge & close attempt fails. */}
        {mergeError && (
          <div className="flex items-start gap-2 text-sm text-danger-fg bg-[color-mix(in_oklch,var(--color-danger-fg)_8%,transparent)] border border-[color-mix(in_oklch,var(--color-danger-fg)_35%,transparent)] rounded px-3 py-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-px" />
            <span>{mergeError}</span>
          </div>
        )}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ActionButton({ opt, onClick, disabled }: { opt: PaneCloseOption; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  if (opt.variant === 'primary') {
    return (
      <Button variant="primary" onClick={onClick} disabled={disabled}>
        {opt.label}
      </Button>
    )
  }
  if (opt.variant === 'destructive') {
    return (
      <Button variant="secondary" destructive onClick={onClick} disabled={disabled}>
        {opt.label}
      </Button>
    )
  }
  return (
    <Button variant="secondary" onClick={onClick} disabled={disabled}>
      {opt.label}
    </Button>
  )
}

function isBusyState(status: PaneCloseDescriptor['status']): boolean {
  return status === 'working' || status === 'needs-input' || status === 'error'
}

function busyWarningCopy(status: PaneCloseDescriptor['status']): string {
  if (status === 'working') return 'The agent is still running. Closing will interrupt it.'
  if (status === 'needs-input') return 'The agent is waiting for your input. Closing will discard the prompt.'
  return 'The terminal is in an error state. Closing will not attempt recovery.'
}
