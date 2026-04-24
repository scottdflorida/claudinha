import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { PaneSpawnPayload, PaneSpawnResult, WorktreeListResult, WorktreeEntry, PathValidateResult } from '../../shared/ipc-channels'
import type { SessionHistoryEntry, WorkspaceType, WorkspaceConstraint } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { usePaneState } from '../hooks/usePaneState'
import { MIN_PANE_COLS, MIN_PANE_ROWS } from '../lib/constants'
import { wouldExceedMinPaneSize, validateSpawnPayload } from '../lib/spawn-validation'
import { Dialog, DialogCancel, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { TextInput } from './ui/TextInput'
import { SegmentedControl } from './ui/SegmentedControl'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpawnMode = 'new-worktree' | 'existing-worktree' | 'manual-path' | 'resume-session'

const MODE_VALUES: SpawnMode[] = ['new-worktree', 'existing-worktree', 'manual-path']

interface SpawnDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Workspace type constraint — affects available modes and field locking */
  workspaceType?: WorkspaceType
  /** Workspace constraint data — pre-fills repo path, locks worktree, etc. */
  workspaceConstraint?: WorkspaceConstraint
  /** Workspace ID to pass in spawn payload */
  workspaceId?: string
  /**
   * Repo path of the most recently spawned pane in this workspace. When set,
   * takes precedence over the workspace's constraint.repoPath as the default
   * in the dialog's repo field so subsequent terminals land next to the last.
   */
  lastSpawnedRepoPath?: string
}

const LAST_REPO_PATH_KEY = 'claudinha:lastRepoPath'

const PATH_PLACEHOLDER = navigator.platform.startsWith('Mac')
  ? '/Users/you/my-project'
  : navigator.platform.startsWith('Win')
    ? 'C:\\Users\\you\\my-project'
    : '/home/you/my-project'

// ---------------------------------------------------------------------------
// SpawnDialog
// ---------------------------------------------------------------------------

/**
 * SpawnDialog — modal dialog for spawning a new Claude Code pane (PRD F1).
 *
 * Supports three modes: New worktree, Existing worktree, Manual path.
 * Workspace constraints lock the repo path and/or pre-select the worktree path.
 */
export function SpawnDialog({ isOpen, onClose, workspaceType, workspaceConstraint, workspaceId, lastSpawnedRepoPath }: SpawnDialogProps): React.JSX.Element | null {
  const t = useStrings()
  const MODES = MODE_VALUES.map((value) => ({
    value,
    label:
      value === 'new-worktree'
        ? t.spawnDialog.modeNewWorktree
        : value === 'existing-worktree'
          ? t.spawnDialog.modeExistingWorktree
          : t.spawnDialog.modeManualPath
  }))
  const { panes } = usePaneState()
  const [mode, setMode] = useState<SpawnMode>('new-worktree')
  const [repoPath, setRepoPath] = useState('')
  const [manualPath, setManualPath] = useState('')
  const [worktreeName, setWorktreeName] = useState('')
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([])
  const [selectedWorktreeIndex, setSelectedWorktreeIndex] = useState(0)
  const [worktreeLoading, setWorktreeLoading] = useState(false)
  const [sessions, setSessions] = useState<SessionHistoryEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [worktreeNamePlaceholder] = useState(() => `claudinha-${Math.random().toString(16).slice(2, 6)}`)
  const formRef = useRef<HTMLFormElement>(null)

  // Only worktree-branch workspaces hard-lock the repo field — their constraint
  // is inherent to the chosen worktree. 'repo'-type workspaces treat the
  // constraint as a default only: users can browse to any repo when adding
  // terminals to an existing workspace.
  const isRepoLocked = workspaceType === 'worktree-branch' && !!workspaceConstraint?.repoPath
  const isWorktreeBranchHive = workspaceType === 'worktree-branch'

  // Map worktree path → most recent session title
  const sessionTitleByPath = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sessions) {
      if (s.sessionTitle && !map.has(s.worktreePath)) {
        map.set(s.worktreePath, s.sessionTitle)
      }
    }
    return map
  }, [sessions])

  // Reset state on open
  useEffect(() => {
    if (!isOpen) return
    if (workspaceType === 'worktree-branch') {
      setMode('manual-path')
    } else if (workspaceType === 'repo') {
      setMode('new-worktree')
    } else {
      setMode('new-worktree')
    }
    // Default chain: repo of the most recently launched pane in this workspace
    // → workspace constraint → the globally remembered last repo → empty.
    setRepoPath(
      lastSpawnedRepoPath ||
        workspaceConstraint?.repoPath ||
        localStorage.getItem(LAST_REPO_PATH_KEY) ||
        ''
    )
    setManualPath(workspaceConstraint?.worktreePath || '')
    setWorktreeName('')
    setWorktrees([])
    setSelectedWorktreeIndex(0)
    setError(null)
    setSubmitting(false)

    setSessions([])
    ipcInvoke(IPC.SESSION_HISTORY_LIST)
      .then((result) => setSessions(result as SessionHistoryEntry[]))
      .catch(() => setSessions([]))
  }, [isOpen])

  // Load worktree list when in existing-worktree mode and repoPath changes
  useEffect(() => {
    if (mode !== 'existing-worktree' || !repoPath.trim()) {
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
  }, [mode, repoPath])

  const handleBrowse = useCallback(async (setter: (p: string) => void) => {
    try {
      const result = await ipcInvoke(IPC.FOLDER_BROWSE)
      if (result) setter(result as string)
    } catch {
      setError(t.spawnDialog.failedFolderPicker)
    }
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (wouldExceedMinPaneSize(panes.length, window.innerWidth, window.innerHeight)) {
      setError(t.spawnDialog.windowTooSmall(MIN_PANE_COLS, MIN_PANE_ROWS))
      return
    }

    const selectedWorktreePath = worktrees[selectedWorktreeIndex]?.path ?? ''
    const validationError = validateSpawnPayload(mode, repoPath, manualPath, selectedWorktreePath || null)
    if (validationError) { setError(validationError); return }

    setSubmitting(true)
    let payload: PaneSpawnPayload

    try {
      if (mode === 'new-worktree') {
        payload = {
          mode: 'new-worktree',
          repoPath: repoPath.trim(),
          worktreeName: worktreeName.trim() || undefined
        }
      } else if (mode === 'existing-worktree') {
        payload = { mode: 'existing-worktree', repoPath: repoPath.trim(), worktreePath: selectedWorktreePath }
      } else {
        const p = manualPath.trim()
        const result = (await ipcInvoke(IPC.PATH_VALIDATE, { path: p })) as PathValidateResult
        if (!result.valid) {
          setError(result.error ?? t.spawnDialog.invalidPath)
          setSubmitting(false)
          return
        }
        payload = { mode: 'manual-path', worktreePath: p }
      }

      if (workspaceId) payload.workspaceId = workspaceId

      const spawnResult = (await ipcInvoke(IPC.PANE_SPAWN, payload)) as PaneSpawnResult
      if (spawnResult.error) { setError(spawnResult.error); setSubmitting(false); return }
    } catch {
      setError(t.spawnDialog.failedToSpawn)
      setSubmitting(false)
      return
    }

    if (mode !== 'manual-path' && repoPath.trim()) {
      localStorage.setItem(LAST_REPO_PATH_KEY, repoPath.trim())
    }

    onClose()
  }, [mode, repoPath, manualPath, worktreeName, worktrees, selectedWorktreeIndex, onClose, panes.length, workspaceId])

  if (!isOpen) return null

  const modeOptions = isWorktreeBranchHive
    ? MODES.map((m) => ({ ...m, disabled: m.value !== 'manual-path' }))
    : MODES

  return (
    <Dialog
      title={t.spawnDialog.title}
      size="md"
      onClose={onClose}
      footer={
        <>
          <DialogCancel onClick={onClose}>{t.spawnDialog.cancel}</DialogCancel>
          <DialogActions>
            <Button
              variant="primary"
              onClick={() => formRef.current?.requestSubmit()}
              disabled={submitting}
            >
              {submitting ? t.spawnDialog.submitting : t.spawnDialog.submit}
            </Button>
          </DialogActions>
        </>
      }
    >
      <form ref={formRef} onSubmit={handleSubmit}>
        <div className="flex flex-col gap-5">
          <SegmentedControl
            label={t.spawnDialog.launchModeLabel}
            options={modeOptions}
            value={mode}
            onChange={(v) => { setMode(v); setError(null) }}
          />

          {/* New worktree */}
          {mode === 'new-worktree' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-[500] text-fg-primary">
                  {t.spawnDialog.repoPathLabel}{isRepoLocked && <span className="text-fg-muted font-normal">{t.spawnDialog.setByWorkspace}</span>}
                </label>
                <div className="flex items-center gap-2">
                  <TextInput
                    value={repoPath}
                    onChange={(e) => !isRepoLocked && setRepoPath(e.target.value)}
                    placeholder={PATH_PLACEHOLDER}
                    readOnly={isRepoLocked}
                    className="flex-1"
                  />
                  {!isRepoLocked && (
                    <Button variant="secondary" size="md" type="button" onClick={() => handleBrowse(setRepoPath)}>
                      {t.spawnDialog.browse}
                    </Button>
                  )}
                </div>
              </div>
              <TextInput
                label={t.spawnDialog.worktreeNameLabel}
                helperText={t.spawnDialog.worktreeNameHelper}
                value={worktreeName}
                onChange={(e) => setWorktreeName(e.target.value)}
                placeholder={worktreeNamePlaceholder}
              />
            </div>
          )}

          {/* Existing worktree */}
          {mode === 'existing-worktree' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-[500] text-fg-primary">
                  {t.spawnDialog.repoPathLabel}{isRepoLocked && <span className="text-fg-muted font-normal">{t.spawnDialog.setByWorkspace}</span>}
                </label>
                <div className="flex items-center gap-2">
                  <TextInput
                    value={repoPath}
                    onChange={(e) => !isRepoLocked && setRepoPath(e.target.value)}
                    placeholder={PATH_PLACEHOLDER}
                    readOnly={isRepoLocked}
                    className="flex-1"
                  />
                  {!isRepoLocked && (
                    <Button variant="secondary" size="md" type="button" onClick={() => handleBrowse(setRepoPath)}>
                      {t.spawnDialog.browse}
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-[500] text-fg-primary">{t.spawnDialog.selectWorktree}</label>
                {worktreeLoading && (
                  <p className="text-sm text-fg-muted">{t.spawnDialog.loadingWorktrees}</p>
                )}
                {!worktreeLoading && worktrees.length > 0 && (
                  <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto rounded border border-subtle bg-sunken p-1">
                    {worktrees.map((wt, i) => {
                      const displayName = wt.branch ?? wt.path
                      const title = sessionTitleByPath.get(wt.path)
                      const label = title
                        ? t.spawnDialog.titleWithSession(displayName, title)
                        : `${displayName}${wt.isMain ? t.spawnDialog.mainSuffix : ''}`
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
                          {label}
                        </button>
                      )
                    })}
                  </div>
                )}
                {!worktreeLoading && repoPath.trim() && worktrees.length === 0 && !error && (
                  <p className="text-sm text-fg-muted">{t.spawnDialog.noAdditionalWorktrees}</p>
                )}
              </div>
            </div>
          )}

          {/* Manual path */}
          {mode === 'manual-path' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-[500] text-fg-primary">
                {t.spawnDialog.directoryPathLabel}{isWorktreeBranchHive && <span className="text-fg-muted font-normal">{t.spawnDialog.setByWorkspace}</span>}
              </label>
              <div className="flex items-center gap-2">
                <TextInput
                  value={manualPath}
                  onChange={(e) => !isWorktreeBranchHive && setManualPath(e.target.value)}
                  placeholder={PATH_PLACEHOLDER}
                  readOnly={isWorktreeBranchHive}
                  className="flex-1"
                />
                {!isWorktreeBranchHive && (
                  <Button variant="secondary" size="md" type="button" onClick={() => handleBrowse(setManualPath)}>
                    {t.spawnDialog.browse}
                  </Button>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-danger-fg">{error}</p>
          )}
        </div>
        <button type="submit" className="sr-only" />
      </form>
    </Dialog>
  )
}
