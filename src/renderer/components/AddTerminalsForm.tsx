import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type {
  GitInitResult,
  WorkspaceAddTerminalsPayload,
  WorkspaceAddTerminalsResult
} from '../../shared/ipc-channels'
import type { EffortLevel, Model, WorkspaceType, WorkspaceConstraint } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { useAppConfig } from '../hooks/useAppConfig'
import { TextInput } from './ui/TextInput'
import { Button } from './ui/Button'
import { SegmentedControl } from './ui/SegmentedControl'
import { useStrings } from '../lib/strings'
import {
  validateRepoPath,
  type RepoValidation,
  EMPTY_VALIDATION
} from '../lib/repo-path-validation'
import { stripWorktreesSuffix } from '../lib/spawn-validation'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
  { value: 'max', label: 'Max' },
  { value: 'xhigh', label: 'X High' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Med' },
  { value: 'low', label: 'Low' }
]

const MODEL_OPTIONS: { value: Model; label: string }[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' }
]

type WorktreeMode = 'each-own' | 'shared' | 'main'
type NamingMode = 'auto' | 'manual'
type RepoMode = 'single' | 'per-pane'

const PATH_PLACEHOLDER = navigator.platform.startsWith('Mac')
  ? '/Users/you/my-project'
  : navigator.platform.startsWith('Win')
    ? 'C:\\Users\\you\\my-project'
    : '/home/you/my-project'

// ---------------------------------------------------------------------------
// AddTerminalsForm
// ---------------------------------------------------------------------------

interface AddTerminalsFormProps {
  /** ID of the workspace to add terminals into. */
  workspaceId: string
  /** Workspace type — affects whether the simplified worktree-branch layout renders. */
  workspaceType?: WorkspaceType
  /** Workspace constraint — drives the worktree-branch banner copy. */
  workspaceConstraint?: WorkspaceConstraint
  /** Repo path of the most-recently-spawned pane in this workspace. Seeds the
   *  Repository field for the common 'add another in the same repo' case. */
  lastSpawnedRepoPath?: string
  /** Called after a successful submit. Closes the host dialog. */
  onSubmitted: () => void
}

/**
 * AddTerminalsForm — multi-terminal form for adding panes to an existing
 * workspace. Modeled on LaunchForm minus the workspace-name and view-mode
 * fields, with the Terminal Location selector promoted to the top of the
 * form and no advanced-setup toggle (every field is visible).
 *
 * Worktree-branch workspaces collapse to a simplified layout: terminals will
 * always run in the workspace's pinned worktree, so we hide the location/
 * branch fields and show a banner with the destination path.
 */
export function AddTerminalsForm({
  workspaceId,
  workspaceType,
  workspaceConstraint,
  lastSpawnedRepoPath,
  onSubmitted
}: AddTerminalsFormProps): React.JSX.Element {
  const t = useStrings()
  const isWorktreeBranchWorkspace = workspaceType === 'worktree-branch'

  // Default the repo field to the most-recently-spawned repo in this workspace
  // if known. Strip a trailing `.worktrees` so a stale inspector value doesn't
  // re-seed the bogus subdir as the repo (matches SpawnDialog's behavior).
  const initialRepoPath = stripWorktreesSuffix(lastSpawnedRepoPath ?? '')

  const [repoMode, setRepoMode] = useState<RepoMode>('single')
  const [repoPath, setRepoPath] = useState(initialRepoPath)
  const [repoPaths, setRepoPaths] = useState<string[]>([])
  const [terminalCount, setTerminalCount] = useState(4)
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>('each-own')
  const [namingMode, setNamingMode] = useState<NamingMode>('auto')
  const [manualNames, setManualNames] = useState<string[]>([])
  const [namePlaceholders, setNamePlaceholders] = useState<string[]>([])
  const [effort, setEffort] = useState<EffortLevel>('high')
  const [model, setModelRaw] = useState<Model>(
    () => (localStorage.getItem('claudinha:lastModel') as Model | null) ?? 'opus'
  )

  const userTouchedModel = useRef(false)
  const { config: appConfig, loaded: appConfigLoaded } = useAppConfig()
  useEffect(() => {
    if (!appConfigLoaded) return
    if (userTouchedModel.current) return
    if (!appConfig.defaultModel) return
    setModelRaw(appConfig.defaultModel)
    if (appConfig.defaultModel !== 'opus') {
      setEffort((cur) => (cur === 'max' || cur === 'xhigh') ? 'high' : cur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfigLoaded])

  const setModel = useCallback((next: Model) => {
    userTouchedModel.current = true
    setModelRaw(next)
    if (next !== 'opus') setEffort((cur) => (cur === 'max' || cur === 'xhigh') ? 'high' : cur)
  }, [])

  const maxEffortAllowed = model === 'opus'

  // Single-repo validation state
  const [repoValid, setRepoValid] = useState<boolean | null>(null)
  const [repoIsGit, setRepoIsGit] = useState<boolean | null>(null)
  const [validating, setValidating] = useState(false)

  // Per-pane repo validation state
  const [repoValidStates, setRepoValidStates] = useState<RepoValidation[]>([])

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const repoInputRef = useRef<HTMLInputElement>(null)
  const singleValidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const perTreeValidateTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const manualNameRefs = useRef<(HTMLInputElement | null)[]>([])
  const repoPathRefs = useRef<(HTMLInputElement | null)[]>([])

  const validateSingleRepoPath = useCallback((p: string) => {
    if (singleValidateTimerRef.current) clearTimeout(singleValidateTimerRef.current)
    if (!p.trim()) { setRepoValid(null); setRepoIsGit(null); return }
    setValidating(true)
    singleValidateTimerRef.current = setTimeout(async () => {
      const result = await validateRepoPath(p)
      setRepoValid(result.valid)
      setRepoIsGit(result.isGit)
      setValidating(false)
    }, 400)
  }, [])

  const validatePerTreeRepoPath = useCallback((index: number, p: string) => {
    const timers = perTreeValidateTimersRef.current
    const existing = timers.get(index)
    if (existing) clearTimeout(existing)
    if (!p.trim()) {
      setRepoValidStates((prev) => {
        const arr = [...prev]
        arr[index] = { ...EMPTY_VALIDATION }
        return arr
      })
      return
    }
    setRepoValidStates((prev) => {
      const arr = [...prev]
      arr[index] = { valid: null, isGit: null, validating: true }
      return arr
    })
    const timer = setTimeout(async () => {
      const result = await validateRepoPath(p)
      setRepoValidStates((prev) => {
        const arr = [...prev]
        arr[index] = result
        return arr
      })
    }, 400)
    timers.set(index, timer)
  }, [])

  // Validate the seeded repo path on mount.
  useEffect(() => {
    if (initialRepoPath.trim()) validateSingleRepoPath(initialRepoPath)
    // Auto-focus the repo field when the form opens. Use a tiny delay so the
    // <dialog> element finishes the showModal() open transition before we
    // try to focus inside it.
    setTimeout(() => repoInputRef.current?.focus(), 100)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync manual names + placeholders with terminal count.
  useEffect(() => {
    const sharedCollapses = worktreeMode === 'shared' && repoMode !== 'per-pane'
    const target = sharedCollapses ? 1 : terminalCount
    setManualNames((prev) => {
      if (prev.length === target) return prev
      const arr = [...prev]
      while (arr.length < target) arr.push('')
      return arr.slice(0, target)
    })
    setNamePlaceholders((prev) => {
      if (prev.length === target) return prev
      const arr = [...prev]
      const make = (): string => `claudinha-${Math.random().toString(16).slice(2, 6)}`
      while (arr.length < target) arr.push(make())
      return arr.slice(0, target)
    })
  }, [terminalCount, worktreeMode, repoMode])

  // Sync per-pane repo paths + validation with terminal count
  useEffect(() => {
    if (repoMode !== 'per-pane') return
    setRepoPaths((prev) => {
      if (prev.length === terminalCount) return prev
      const arr = [...prev]
      while (arr.length < terminalCount) arr.push('')
      return arr.slice(0, terminalCount)
    })
    setRepoValidStates((prev) => {
      if (prev.length === terminalCount) return prev
      const arr = [...prev]
      while (arr.length < terminalCount) arr.push({ ...EMPTY_VALIDATION })
      return arr.slice(0, terminalCount)
    })
  }, [terminalCount, repoMode])

  const handleRepoChange = useCallback((value: string) => {
    setRepoPath(value)
    setError(null)
    validateSingleRepoPath(value)
  }, [validateSingleRepoPath])

  const handlePerTreeRepoChange = useCallback((index: number, value: string) => {
    setRepoPaths((prev) => { const arr = [...prev]; arr[index] = value; return arr })
    setError(null)
    validatePerTreeRepoPath(index, value)
  }, [validatePerTreeRepoPath])

  const handleBrowse = useCallback(async () => {
    try {
      const result = await ipcInvoke(IPC.FOLDER_BROWSE)
      if (result) {
        const p = result as string
        setRepoPath(p)
        setError(null)
        validateSingleRepoPath(p)
      }
    } catch {
      setError(t.launchFormUI.failedFolderPicker)
    }
  }, [validateSingleRepoPath, t])

  const handlePerTreeBrowse = useCallback(async (index: number) => {
    try {
      const result = await ipcInvoke(IPC.FOLDER_BROWSE)
      if (result) {
        const p = result as string
        handlePerTreeRepoChange(index, p)
      }
    } catch {
      setError(t.launchFormUI.failedFolderPicker)
    }
  }, [handlePerTreeRepoChange, t])

  const handleGitInit = useCallback(async () => {
    const repo = repoPath.trim()
    if (!repo) return
    setError(null)
    try {
      const result = await ipcInvoke(IPC.PATH_GIT_INIT, { path: repo }) as GitInitResult
      if (!result.ok) { setError(result.error ?? t.launchFormUI.failedToInitGit); return }
      setRepoIsGit(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(t.launchFormUI.initGitFailedFmt(msg))
    }
  }, [repoPath, t])

  const handlePerTreeGitInit = useCallback(async (index: number) => {
    const repo = repoPaths[index]?.trim()
    if (!repo) return
    setError(null)
    try {
      const result = await ipcInvoke(IPC.PATH_GIT_INIT, { path: repo }) as GitInitResult
      if (!result.ok) { setError(result.error ?? t.launchFormUI.failedToInitGit); return }
      setRepoValidStates((prev) => {
        const arr = [...prev]
        arr[index] = { ...arr[index], isGit: true }
        return arr
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(t.launchFormUI.initGitFailedFmt(msg))
    }
  }, [repoPaths, t])

  const handleTerminalCountChange = useCallback((delta: number) => {
    setTerminalCount((prev) => Math.max(1, Math.min(32, prev + delta)))
  }, [])

  const handleManualNameChange = useCallback((index: number, value: string) => {
    setManualNames((prev) => { const arr = [...prev]; arr[index] = value; return arr })
  }, [])

  const perTreeAllValid = repoMode === 'per-pane'
    && repoPaths.length === terminalCount
    && repoPaths.every((p, i) => p.trim() !== '' && repoValidStates[i]?.valid === true && repoValidStates[i]?.isGit === true)

  // For worktree-branch workspaces, no repo path is required (we use the
  // workspace's pinned worktreePath). Otherwise either single-repo or
  // per-pane mode must validate.
  const canSubmit = isWorktreeBranchWorkspace
    ? true
    : (repoMode === 'per-pane' ? perTreeAllValid : (repoValid === true && repoIsGit === true))

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    setSubmitting(true)
    try {
      // Worktree-branch workspaces bypass the helper's worktree-creation logic:
      // every terminal must run in the workspace's pinned worktreePath. We
      // achieve that by spawning each terminal individually via IPC.PANE_SPAWN
      // in 'manual-path' mode — the existing PANE_SPAWN handler enforces the
      // workspace's worktreePath constraint and validates the path.
      if (isWorktreeBranchWorkspace) {
        const worktreePath = workspaceConstraint?.worktreePath
        if (!worktreePath) { setError(t.addTerminalsForm.failedToAdd); setSubmitting(false); return }
        const errors: string[] = []
        for (let i = 0; i < terminalCount; i++) {
          try {
            const result = await ipcInvoke(IPC.PANE_SPAWN, {
              mode: 'manual-path',
              worktreePath,
              effort,
              model,
              workspaceId
            }) as { error: string | null }
            if (result.error) errors.push(`Terminal ${i + 1}: ${result.error}`)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            errors.push(`Terminal ${i + 1}: ${msg}`)
          }
        }
        if (errors.length === terminalCount) {
          setError(errors[0])
          setSubmitting(false)
          return
        }
        localStorage.setItem('claudinha:lastModel', model)
        onSubmitted()
        return
      }

      // Standard repo / general workspace flow.
      if (repoMode === 'per-pane') {
        const trimmed = repoPaths.map((p) => p.trim())
        for (let i = 0; i < trimmed.length; i++) {
          if (!trimmed[i]) { setError(t.launchFormUI.perTerminalRepoRequired(i)); setSubmitting(false); return }
          if (repoValidStates[i]?.isGit !== true) {
            setError(t.launchFormUI.perTerminalMustBeGit(i))
            setSubmitting(false)
            return
          }
        }
      } else {
        const repo = repoPath.trim()
        if (!repo) { setError(t.launchFormUI.repoPathRequired); setSubmitting(false); return }
        if (repoIsGit !== true) { setError(t.launchFormUI.pathMustBeGit); setSubmitting(false); return }
      }

      const payload: WorkspaceAddTerminalsPayload = {
        workspaceId,
        repoPath: repoMode === 'single' ? repoPath.trim() : '',
        repoPaths: repoMode === 'per-pane' ? repoPaths.map((p) => p.trim()) : undefined,
        terminalCount,
        worktreeMode,
        namingMode,
        manualNames: namingMode === 'manual' ? manualNames : undefined,
        effort,
        model
      }

      const result = await ipcInvoke(IPC.WORKSPACE_ADD_TERMINALS, payload) as WorkspaceAddTerminalsResult
      if (result.error) { setError(result.error); setSubmitting(false); return }

      if (repoMode === 'single' && payload.repoPath) {
        localStorage.setItem('claudinha:lastRepoPath', payload.repoPath)
      }
      localStorage.setItem('claudinha:lastModel', model)

      onSubmitted()
    } catch {
      setError(t.addTerminalsForm.failedToAdd)
    } finally {
      setSubmitting(false)
    }
  }, [
    isWorktreeBranchWorkspace, workspaceConstraint, workspaceId, terminalCount, effort, model,
    repoMode, repoPath, repoPaths, repoValidStates, repoIsGit,
    worktreeMode, namingMode, manualNames, onSubmitted, t
  ])

  // -----------------------------------------------------------------
  // Status text helpers (mirror LaunchForm)
  // -----------------------------------------------------------------

  const repoStatusText = (): string | null => {
    if (!repoPath.trim()) return null
    if (validating) return t.launchFormUI.statusChecking
    if (repoValid === false) return t.launchFormUI.statusPathNotFound
    if (repoValid === true && repoIsGit === false) return t.launchFormUI.statusValidNonGit
    if (repoValid === true && repoIsGit === true) return t.launchFormUI.statusValidGit
    return null
  }

  const repoStatusColor = (): 'error' | 'help' | undefined => {
    if (repoValid === false) return 'error'
    return undefined
  }

  const perTreeStatusText = (i: number): string | null => {
    const p = repoPaths[i]
    if (!p || !p.trim()) return null
    const v = repoValidStates[i]
    if (!v) return null
    if (v.validating) return t.launchFormUI.statusChecking
    if (v.valid === false) return t.launchFormUI.statusPathNotFound
    if (v.valid === true && v.isGit === false) return t.launchFormUI.statusValidNonGit
    if (v.valid === true && v.isGit === true) return t.launchFormUI.statusValidGit
    return null
  }

  // -----------------------------------------------------------------
  // Conditional Advanced fields — one render function per matrix row
  // -----------------------------------------------------------------

  const isPerRepo = repoMode === 'per-pane'
  const isShared = worktreeMode === 'shared'
  const isMain = worktreeMode === 'main'
  // 'On main' = no branches created; treat naming as effectively Auto for the
  // conditional-fields matrix so manual-name inputs don't render.
  const isCustom = namingMode === 'manual' && !isMain

  const renderRepoRow = (i: number): React.JSX.Element => {
    const v = repoValidStates[i] ?? EMPTY_VALIDATION
    const statusText = perTreeStatusText(i)
    const isError = v.valid === false
    const p = repoPaths[i] ?? ''
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <TextInput
            inputRef={(el) => { repoPathRefs.current[i] = el }}
            value={p}
            onChange={(e) => handlePerTreeRepoChange(i, e.target.value)}
            onKeyDown={(e) => {
              const len = repoPaths.length
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                repoPathRefs.current[(i - 1 + len) % len]?.focus()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                repoPathRefs.current[(i + 1) % len]?.focus()
              }
            }}
            placeholder={PATH_PLACEHOLDER}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            error={isError ? t.launchFormUI.statusPathNotFound : undefined}
            className="flex-1"
          />
          <Button variant="secondary" size="md" type="button" onClick={() => handlePerTreeBrowse(i)} className="mt-0 shrink-0">
            {t.launchFormUI.browse}
          </Button>
        </div>
        {statusText && (
          <p className={`text-xs ${isError ? 'text-danger-fg' : 'text-fg-muted'}`}>
            {statusText}
          </p>
        )}
        {v.valid === true && v.isGit === false && (
          <Button variant="ghost" size="sm" type="button" onClick={() => handlePerTreeGitInit(i)} className="self-start">
            {t.launchFormUI.initGit}
          </Button>
        )}
      </div>
    )
  }

  const renderNameRow = (i: number, opts?: { fullWidth?: boolean }): React.JSX.Element => (
    <TextInput
      inputRef={(el) => { manualNameRefs.current[i] = el }}
      value={manualNames[i] ?? ''}
      onChange={(e) => handleManualNameChange(i, e.target.value)}
      onKeyDown={(e) => {
        const len = manualNames.length
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          manualNameRefs.current[(i - 1 + len) % len]?.focus()
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          manualNameRefs.current[(i + 1) % len]?.focus()
        }
      }}
      placeholder={namePlaceholders[i] ?? ''}
      className={opts?.fullWidth ? 'w-full' : 'flex-1'}
    />
  )

  const renderSharedNameField = (): React.JSX.Element => (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-[500] text-fg-primary">{t.launchFormUI.sharedBranchNameLabelExisting}</label>
      <TextInput
        inputRef={(el) => { manualNameRefs.current[0] = el }}
        value={manualNames[0] ?? ''}
        onChange={(e) => handleManualNameChange(0, e.target.value)}
        placeholder={namePlaceholders[0] ?? ''}
      />
    </div>
  )

  const renderCombinedList = (): React.JSX.Element => (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-[500] text-fg-primary">{t.launchFormUI.perTerminalRepoAndName}</label>
      <div className="flex flex-col gap-3">
        {Array.from({ length: terminalCount }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-md border border-[var(--color-border-subtle)] bg-surface p-3"
          >
            <div className="text-xs text-fg-muted font-[500]">{t.launchFormUI.terminalLabel(i)}</div>
            {renderRepoRow(i)}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-fg-muted">{t.launchFormUI.sharedBranchNameLabelExisting}</label>
              {renderNameRow(i, { fullWidth: true })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderRepoList = (opts: { title: string }): React.JSX.Element => (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-[500] text-fg-primary">{opts.title}</label>
      {Array.from({ length: terminalCount }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-muted w-20 flex-shrink-0">{t.launchFormUI.terminalLabel(i)}</span>
            <div className="flex-1">{renderRepoRow(i)}</div>
          </div>
        </div>
      ))}
    </div>
  )

  const renderNameList = (): React.JSX.Element => (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-[500] text-fg-primary">{t.launchFormUI.worktreeBranchNamesLabel}</label>
      {Array.from({ length: manualNames.length }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-fg-muted w-20 flex-shrink-0">{t.launchFormUI.terminalLabel(i)}</span>
          {renderNameRow(i)}
        </div>
      ))}
    </div>
  )

  const renderConditionalFields = (): React.JSX.Element | null => {
    if (isPerRepo && isShared && isCustom) {
      return (
        <>
          {renderSharedNameField()}
          {renderRepoList({ title: t.launchFormUI.perTerminalRepos })}
        </>
      )
    }
    if (isPerRepo && !isShared && isCustom) {
      return renderCombinedList()
    }
    if (isPerRepo) {
      return renderRepoList({ title: t.launchFormUI.perTerminalRepos })
    }
    if (isShared && isCustom) {
      return renderSharedNameField()
    }
    if (!isShared && isCustom) {
      return renderNameList()
    }
    return null
  }

  // -----------------------------------------------------------------
  // Stepper rendered by both regular + worktree-branch layouts
  // -----------------------------------------------------------------

  const renderTerminalCountStepper = (): React.JSX.Element => (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-[500] text-fg-primary">{t.launchFormUI.terminalsToSpawnLabel}</label>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => handleTerminalCountChange(-1)}
          disabled={terminalCount <= 1}
        >
          −
        </Button>
        <span className="text-sm font-[500] text-fg-primary w-6 text-center tabular-nums">
          {terminalCount}
        </span>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => handleTerminalCountChange(1)}
          disabled={terminalCount >= 32}
        >
          +
        </Button>
      </div>
    </div>
  )

  const renderModelAndEffort = (): React.JSX.Element => (
    <>
      <SegmentedControl
        label={t.launchFormUI.modelLabel}
        options={MODEL_OPTIONS}
        value={model}
        onChange={(v) => setModel(v as Model)}
      />
      <SegmentedControl
        label={t.launchFormUI.effortLabel}
        options={EFFORT_OPTIONS.map((o) => ({
          ...o,
          disabled: (o.value === 'max' || o.value === 'xhigh') && !maxEffortAllowed
        }))}
        value={effort}
        onChange={(v) => setEffort(v as EffortLevel)}
      />
    </>
  )

  // -----------------------------------------------------------------
  // Render — worktree-branch variant first (simplified), then default
  // -----------------------------------------------------------------

  if (isWorktreeBranchWorkspace) {
    const branchName = workspaceConstraint?.branchName ?? '?'
    const worktreePath = workspaceConstraint?.worktreePath ?? '?'
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-lg w-full">
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-surface p-3 flex flex-col gap-1">
          <div className="text-xs font-[600] uppercase tracking-wider text-fg-muted">
            {t.addTerminalsForm.worktreeBranchBannerTitle}
          </div>
          <div className="text-sm text-fg-secondary break-all">
            {t.addTerminalsForm.worktreeBranchBannerBody(branchName, worktreePath)}
          </div>
        </div>

        {renderTerminalCountStepper()}
        {renderModelAndEffort()}

        {error && <p className="text-sm text-danger-fg">{error}</p>}

        <Button type="submit" variant="primary" size="lg" disabled={!canSubmit || submitting}>
          {submitting ? t.addTerminalsForm.submitOpening : t.addTerminalsForm.submitLabel(terminalCount)}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-lg w-full">
      {/* Terminal location toggle — promoted to the top per the new form spec. */}
      <SegmentedControl
        label={t.launchFormUI.terminalLocationLabel}
        options={[
          { value: 'single', label: t.launchFormUI.locationSingleRepo },
          { value: 'per-pane', label: t.launchFormUI.locationPerPane }
        ]}
        value={repoMode}
        onChange={(v) => {
          setRepoMode(v as RepoMode)
          setError(null)
        }}
      />

      {/* Single-repo path — only when the user has NOT split per-pane. */}
      {!isPerRepo && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-[500] text-fg-primary">{t.launchFormUI.repoPathLabel}</label>
          <div className="flex items-start gap-2">
            <TextInput
              inputRef={repoInputRef}
              value={repoPath}
              onChange={(e) => handleRepoChange(e.target.value)}
              placeholder={PATH_PLACEHOLDER}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              error={repoValid === false ? t.launchFormUI.statusPathNotFound : undefined}
              className="flex-1"
            />
            <Button variant="secondary" size="md" type="button" onClick={handleBrowse} className="mt-0 shrink-0">
              {t.launchFormUI.browse}
            </Button>
          </div>
          {repoStatusText() && (
            <p className={`text-xs ${repoStatusColor() === 'error' ? 'text-danger-fg' : 'text-fg-muted'}`}>
              {repoStatusText()}
            </p>
          )}
          {repoValid === true && repoIsGit === false && (
            <Button variant="ghost" size="sm" type="button" onClick={handleGitInit} className="self-start">
              {t.launchFormUI.initGit}
            </Button>
          )}
        </div>
      )}

      {/* Terminals to spawn — directly below the location section per spec. */}
      {renderTerminalCountStepper()}

      {/* Branch layout */}
      <div className="flex flex-col gap-1.5">
        <SegmentedControl
          label={t.launchFormUI.branchLayoutLabel}
          options={[
            { value: 'each-own', label: t.launchFormUI.layoutSeparate },
            { value: 'shared', label: t.launchFormUI.layoutShared },
            { value: 'main', label: t.launchFormUI.layoutMain }
          ]}
          value={worktreeMode}
          onChange={(v) => setWorktreeMode(v as WorktreeMode)}
        />
        {worktreeMode === 'shared' && (
          <p className="text-xs text-warning-fg">{t.launchFormUI.sharedConflictsWarning}</p>
        )}
        {worktreeMode === 'main' && (
          <p className="text-xs text-warning-fg">{t.launchFormUI.mainConflictsWarning}</p>
        )}
      </div>

      {/* Branch naming — disabled in 'On main' mode (no branch is created) */}
      <div className="flex flex-col gap-1.5">
        <SegmentedControl
          label={t.launchFormUI.branchNamingLabel}
          options={[
            { value: 'auto', label: t.launchFormUI.namingAuto, disabled: isMain },
            { value: 'manual', label: t.launchFormUI.namingCustom, disabled: isMain }
          ]}
          value={namingMode}
          onChange={(v) => setNamingMode(v as NamingMode)}
        />
        {isMain && (
          <p className="text-xs text-fg-muted">{t.launchFormUI.namingDisabledOnMain}</p>
        )}
      </div>

      {/* Conditional fields driven by (Location × Layout × Naming) */}
      {renderConditionalFields()}

      {renderModelAndEffort()}

      {error && <p className="text-sm text-danger-fg">{error}</p>}

      <Button type="submit" variant="primary" size="lg" disabled={!canSubmit || submitting}>
        {submitting ? t.addTerminalsForm.submitOpening : t.addTerminalsForm.submitLabel(terminalCount)}
      </Button>
    </form>
  )
}
