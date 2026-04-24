import React from 'react'
import { PaneCloseConfirmModal } from './PaneCloseConfirmModal'
import { Button } from './ui/Button'
import type { PaneCloseAction } from '../../shared/types'
import type { CloseSequencePaneDescriptor, CloseWorkspaceSequenceStartPayload } from '../../shared/ipc-channels'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// WorkspaceCloseOverlay — chrome around the PaneCloseConfirmModal while a
// workspace close sequence is active. Builds the top banner (breadcrumb +
// override button) and feeds it through to PaneCloseConfirmModal via the
// dialog's banner slot.
// ---------------------------------------------------------------------------

export interface WorkspaceCloseOverlayProps {
  sequence: CloseWorkspaceSequenceStartPayload
  currentPane: CloseSequencePaneDescriptor
  currentIndex: number
  totalCount: number
  /** Called after the user confirms a close action for the current terminal.
   *  The caller executes the close IPC, then advances the hook to the next. */
  onConfirm: (action: PaneCloseAction) => void
  /** User cancelled the entire sequence. */
  onCancel: () => void
  /** User hit "close all remaining". */
  onOverrideAll: () => void
  /** True while the merge IPC is in flight for the current terminal. */
  pending?: boolean
  /** Merge error surfaced back into the body when merge-close fails. */
  mergeError?: string | null
}

export function WorkspaceCloseOverlay({
  sequence,
  currentPane,
  currentIndex,
  totalCount,
  onConfirm,
  onCancel,
  onOverrideAll,
  pending,
  mergeError
}: WorkspaceCloseOverlayProps): React.JSX.Element {
  const t = useStrings()
  const paneBreadcrumb = t.workspaceCloseOverlay.paneBreadcrumb(sequence.workspaceName, currentIndex + 1, totalCount)
  const managerBreadcrumb = sequence.isManagerInitiated && sequence.managerProgress
    ? t.workspaceCloseOverlay.managerBreadcrumb(sequence.managerProgress.current, sequence.managerProgress.total)
    : null

  const banner = (
    <>
      <div className="flex flex-col min-w-0 flex-1">
        {managerBreadcrumb && (
          <span className="text-[11px] uppercase tracking-[0.08em] text-fg-muted truncate">
            {managerBreadcrumb}
          </span>
        )}
        <span className="text-sm font-[500] text-fg-primary truncate">
          {paneBreadcrumb}
        </span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={onOverrideAll}
        disabled={pending}
        className="flex-shrink-0"
      >
        {t.workspaceCloseOverlay.overrideAll}
      </Button>
    </>
  )

  return (
    <PaneCloseConfirmModal
      repoName={currentPane.repoName}
      agentName={currentPane.agentName}
      descriptor={{
        status: currentPane.status,
        isWorktree: currentPane.isWorktree,
        isUntouched: currentPane.isUntouched,
        hasUncommittedChanges: currentPane.hasUncommittedChanges,
        changedFileCount: currentPane.changedFileCount,
        commitsAhead: currentPane.commitsAhead
      }}
      topBanner={banner}
      onCancel={onCancel}
      onConfirm={onConfirm}
      pending={pending}
      mergeError={mergeError}
      sequenceControls={{
        cancelLabel: t.workspaceCloseOverlay.cancelKeepOpen
      }}
    />
  )
}
