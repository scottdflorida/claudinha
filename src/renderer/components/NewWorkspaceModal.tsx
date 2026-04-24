import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { WorktreeListResult, WorktreeEntry, WorkspaceCreateResult } from '../../shared/ipc-channels'
import type { WorkspaceType } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { validateWorkspacePayload } from '../lib/workspace-validation'
import { Dialog, DialogCancel, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { TextInput } from './ui/TextInput'
import { SegmentedControl } from './ui/SegmentedControl'
import { LanguageFlagToggle } from './LanguageFlagToggle'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// NewWorkspaceModal
// ---------------------------------------------------------------------------

const PATH_PLACEHOLDER = navigator.platform.startsWith('Mac')
  ? '/Users/you/my-project'
  : navigator.platform.startsWith('Win')
    ? 'C:\\Users\\you\\my-project'
    : '/home/you/my-project'

// Option labels are localized via useStrings inside the component below; the
// values here are stable IPC identifiers, never translated.
const WORKSPACE_TYPE_VALUES: WorkspaceType[] = ['general', 'repo', 'worktree-branch']

interface NewWorkspaceModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * NewWorkspaceModal — create a new workspace of a given type.
 *
 * Uses SegmentedControl for type selection. Repo/worktree types show a repo
 * path field and, for worktree type, a branch selector.
 */
export function NewWorkspaceModal({ isOpen, onClose }: NewWorkspaceModalProps): React.JSX.Element | null {
  const t = useStrings()
  const WORKSPACE_TYPE_OPTIONS = WORKSPACE_TYPE_VALUES.map((value) => ({
    value,
    label:
      value === 'general'
        ? t.newWorkspaceModal.typeGeneral
        : value === 'repo'
          ? t.newWorkspaceModal.typeRepo
          : t.newWorkspaceModal.typeWorktree
  }))
  const [workspaceType, setHiveType] = useState<WorkspaceType>('general')
  const [repoPath, setRepoPath] = useState('')
  const [workspaceName, setHiveName] = useState('')
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([])
  const [selectedWorktreeIndex, setSelectedWorktreeIndex] = useState(0)
  const [worktreeLoading, setWorktreeLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const pathInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const selectedWorktree = worktrees[selectedWorktreeIndex]

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setHiveType('general')
      setRepoPath(localStorage.getItem('claudinha:lastRepoPath') ?? '')
      setHiveName('')
      setWorktrees([])
      setSelectedWorktreeIndex(0)
      setError(null)
      setSubmitting(false)
    }
  }, [isOpen])

  // Load worktree list when in worktree-branch mode and repoPath changes
  useEffect(() => {
    if (workspaceType !== 'worktree-branch' || !repoPath.trim()) {
      setWorktrees([])
      setSelectedWorktreeIndex(0)
      return
    }

    let cancelled = false
    setWorktreeLoading(true)
    setWorktrees([])
    setSelectedWorktreeIndex(0)
    setError(null)

    ipcInvoke(IPC.WORKTREE_LIST, { repoPath: repoPath.trim() })
      .then((result) => {
        if (cancelled) return
        const { entries, error: listError } = result as WorktreeListResult
        setWorktrees(entries)
        setSelectedWorktreeIndex(0)
        if (listError) setError(listError)
      })
      .catch(() => {
        if (!cancelled) setWorktrees([])
      })
      .finally(() => {
        if (!cancelled) setWorktreeLoading(false)
      })

    return () => { cancelled = true }
  }, [workspaceType, repoPath])

  const handleBrowse = useCallback(async () => {
    try {
      const result = await ipcInvoke(IPC.FOLDER_BROWSE)
      if (result) setRepoPath(result as string)
    } catch {
      setError(t.newWorkspaceModal.failedFolderPicker)
    }
  }, [t])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const validationError = validateWorkspacePayload(workspaceType, repoPath, selectedWorktree ?? null)
    if (validationError) { setError(validationError); return }

    const constraint: Record<string, string> = {}
    if (workspaceType === 'repo') {
      constraint.repoPath = repoPath.trim()
      localStorage.setItem('claudinha:lastRepoPath', repoPath.trim())
    } else if (workspaceType === 'worktree-branch') {
      constraint.repoPath = repoPath.trim()
      constraint.branchName = selectedWorktree!.branch || selectedWorktree!.path
      constraint.worktreePath = selectedWorktree!.path
      localStorage.setItem('claudinha:lastRepoPath', repoPath.trim())
    }

    setSubmitting(true)
    try {
      const result = await ipcInvoke(IPC.WORKSPACE_CREATE, {
        type: workspaceType,
        name: workspaceName.trim() || undefined,
        constraint
      }) as WorkspaceCreateResult
      if (result.error) { setError(result.error); setSubmitting(false); return }
    } catch {
      setError(t.newWorkspaceModal.failedToCreate)
      setSubmitting(false)
      return
    }

    onClose()
  }, [workspaceType, repoPath, workspaceName, selectedWorktree, onClose])

  if (!isOpen) return null

  return (
    <Dialog
      title={t.newWorkspaceModal.title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <DialogCancel onClick={onClose}>{t.newWorkspaceModal.cancel}</DialogCancel>
          <DialogActions>
            <Button
              variant="primary"
              onClick={() => formRef.current?.requestSubmit()}
              disabled={submitting}
            >
              {submitting ? t.newWorkspaceModal.creating : t.newWorkspaceModal.create}
            </Button>
          </DialogActions>
        </>
      }
    >
      <form ref={formRef} onSubmit={handleSubmit}>
        <div className="flex flex-col gap-5">
          <SegmentedControl
            label={t.newWorkspaceModal.typeLabel}
            options={WORKSPACE_TYPE_OPTIONS}
            value={workspaceType}
            onChange={(v) => { setHiveType(v); setError(null) }}
          />

          {(workspaceType === 'repo' || workspaceType === 'worktree-branch') && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-[500] text-fg-primary">{t.newWorkspaceModal.repoPathLabel}</label>
              <div className="flex items-center gap-2">
                <TextInput
                  inputRef={pathInputRef}
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder={PATH_PLACEHOLDER}
                  className="flex-1"
                />
                <Button variant="secondary" size="md" type="button" onClick={handleBrowse}>
                  {t.newWorkspaceModal.browse}
                </Button>
              </div>
            </div>
          )}

          {workspaceType === 'worktree-branch' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-[500] text-fg-primary">{t.newWorkspaceModal.worktreeLabel}</label>
              {worktreeLoading && (
                <p className="text-sm text-fg-muted">{t.newWorkspaceModal.worktreesLoading}</p>
              )}
              {!worktreeLoading && worktrees.length > 0 && (
                <>
                  <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto rounded border border-subtle bg-sunken p-1">
                    {worktrees.map((wt, i) => {
                      const displayName = wt.branch ?? wt.path
                      return (
                        <button
                          key={wt.path}
                          type="button"
                          onClick={() => setSelectedWorktreeIndex(i)}
                          className={`ui-btn w-full text-left px-2.5 py-1.5 text-sm rounded transition-colors duration-[80ms]
                            ${i === selectedWorktreeIndex
                              ? 'bg-raised text-fg-primary font-[500]'
                              : 'text-fg-secondary hover:bg-raised hover:text-fg-primary'
                            }`}
                        >
                          {displayName}{wt.isMain ? t.newWorkspaceModal.mainTag : ''}
                        </button>
                      )
                    })}
                  </div>
                  {selectedWorktree && (
                    <p className="text-xs text-warning-fg">
                      {t.newWorkspaceModal.sharedDirWarning}
                    </p>
                  )}
                </>
              )}
              {!worktreeLoading && repoPath.trim() && worktrees.length === 0 && !error && (
                <p className="text-sm text-fg-muted">{t.newWorkspaceModal.worktreesEmpty}</p>
              )}
            </div>
          )}

          <TextInput
            label={t.newWorkspaceModal.nameLabel}
            helperText={t.newWorkspaceModal.nameHelper}
            value={workspaceName}
            onChange={(e) => setHiveName(e.target.value)}
            placeholder={t.newWorkspaceModal.namePlaceholder}
          />

          {error && (
            <p className="text-sm text-danger-fg">{error}</p>
          )}

          <div className="flex justify-end pt-1">
            <LanguageFlagToggle />
          </div>
        </div>
        <button type="submit" className="sr-only" />
      </form>
    </Dialog>
  )
}
