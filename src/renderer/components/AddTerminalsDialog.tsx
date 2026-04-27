import React from 'react'
import { Dialog } from './ui/Dialog'
import { AddTerminalsForm } from './AddTerminalsForm'
import { useStrings } from '../lib/strings'
import type { WorkspaceType, WorkspaceConstraint } from '../../shared/types'

interface AddTerminalsDialogProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  workspaceType?: WorkspaceType
  workspaceConstraint?: WorkspaceConstraint
  /** Repo of the most recently spawned pane in this workspace, used to seed
   *  the Repository field for "add another in the same repo" convenience. */
  lastSpawnedRepoPath?: string
}

/**
 * AddTerminalsDialog — dialog wrapper around AddTerminalsForm. Replaces the
 * single-terminal SpawnDialog at every "+ Terminal(s)" entry point (kanban
 * rail, wall view header, empty state, File menu, Cmd+Shift+N shortcut).
 */
export function AddTerminalsDialog({
  isOpen,
  onClose,
  workspaceId,
  workspaceType,
  workspaceConstraint,
  lastSpawnedRepoPath
}: AddTerminalsDialogProps): React.JSX.Element | null {
  const t = useStrings()
  if (!isOpen) return null
  return (
    <Dialog title={t.addTerminalsForm.title} size="md" onClose={onClose}>
      <AddTerminalsForm
        workspaceId={workspaceId}
        workspaceType={workspaceType}
        workspaceConstraint={workspaceConstraint}
        lastSpawnedRepoPath={lastSpawnedRepoPath}
        onSubmitted={onClose}
      />
    </Dialog>
  )
}
