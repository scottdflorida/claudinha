import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type {
  GitInitResult,
  WorkspaceCreateWithTerminalsPayload,
  WorkspaceCreateWithTerminalsResult
} from '../../shared/ipc-channels'
import type { EffortLevel, Model } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { useAppConfig } from '../hooks/useAppConfig'
import { TextInput } from './ui/TextInput'
import { Button } from './ui/Button'
import { SegmentedControl } from './ui/SegmentedControl'
import { ViewModePreview } from './ui/ViewModePreview'
import { useStrings } from '../lib/strings'
import {
  validateRepoPath,
  type RepoValidation,
  EMPTY_VALIDATION
} from '../lib/repo-path-validation'

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

const PUBLISH_PATH_VALUES = ['direct-merge', 'pr', 'both'] as const
const REPO_MODE_VALUES = ['single', 'per-pane'] as const
const WORKTREE_MODE_VALUES = ['each-own', 'shared', 'main'] as const
const NAMING_MODE_VALUES = ['auto', 'manual'] as const
const EFFORT_VALUES = ['max', 'xhigh', 'high', 'medium', 'low'] as const
const MODEL_VALUES = ['opus', 'sonnet', 'haiku'] as const

// localStorage keys for "remember last choice" persistence on Advanced fields
// that don't have their own settings entry. Read in useState initializers and
// in the post-submit cleanup; written on a successful create.
const LS_KEY_LAST_PUBLISH_PATH = 'claudinha:lastPublishPath'
const LS_KEY_LAST_REPO_MODE = 'claudinha:lastRepoMode'
const LS_KEY_LAST_WORKTREE_MODE = 'claudinha:lastWorktreeMode'
const LS_KEY_LAST_NAMING_MODE = 'claudinha:lastNamingMode'
const LS_KEY_LAST_EFFORT = 'claudinha:lastEffort'

// Defensive read: returns the stored value only if it parses to one of the
// allowed enum members. Falls back to `fallback` for missing keys, junk
// values, or storage-disabled contexts (private browsing, etc.).
function readLastChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null && (allowed as readonly string[]).includes(stored)) {
      return stored as T
    }
  } catch {
    // localStorage may throw in private-browsing / storage-disabled contexts.
  }
  return fallback
}

const PATH_PLACEHOLDER = navigator.platform.startsWith('Mac')
  ? '/Users/you/my-project'
  : navigator.platform.startsWith('Win')
    ? 'C:\\Users\\you\\my-project'
    : '/home/you/my-project'

// ---------------------------------------------------------------------------
// Module-level state cache — survives LaunchForm unmount/remount so users
// don't lose their in-progress form state when they navigate to Permissions /
// Configuration and back. Cleared on successful submit and on full reload.
// ---------------------------------------------------------------------------

interface CachedLaunchState {
  workspaceName?: string
  repoMode?: RepoMode
  repoPath?: string
  repoPaths?: string[]
  terminalCount?: number
  advanced?: boolean
  viewMode?: 'wall' | 'kanban'
  worktreeMode?: WorktreeMode
  namingMode?: NamingMode
  manualNames?: string[]
  effort?: EffortLevel
  model?: Model
  defaultPublishPath?: import('../../shared/types').PublishPath
}

let cachedLaunchState: CachedLaunchState = {}

/** Test-only — wipe the module-level form cache so tests that share this
 *  module can each mount LaunchForm with a clean slate. The cache exists
 *  to preserve in-progress form state across navigation away/back; test
 *  isolation requires an explicit reset between renders. */
export function __resetCachedLaunchStateForTests(): void {
  cachedLaunchState = {}
}

// ---------------------------------------------------------------------------
// LaunchForm
// ---------------------------------------------------------------------------

interface LaunchFormProps {
  onLaunched?: () => void
  /** Next workspace ordinal, used to prefill the Workspace Name field as "Workspace N". */
  nextWorkspaceNumber?: number
}

export function LaunchForm({ onLaunched, nextWorkspaceNumber }: LaunchFormProps): React.JSX.Element {
  const t = useStrings()
  // Seed workspace name from cache → nextWorkspaceNumber → fallback "Workspace 1"
  const [workspaceName, setWorkspaceName] = useState(
    () => cachedLaunchState.workspaceName ?? `Workspace ${nextWorkspaceNumber ?? 1}`
  )

  const [repoMode, setRepoMode] = useState<RepoMode>(
    () => cachedLaunchState.repoMode
      ?? readLastChoice(LS_KEY_LAST_REPO_MODE, REPO_MODE_VALUES, 'single')
  )
  const [repoPath, setRepoPath] = useState(
    () => cachedLaunchState.repoPath ?? localStorage.getItem('claudinha:lastRepoPath') ?? ''
  )
  const [repoPaths, setRepoPaths] = useState<string[]>(() => cachedLaunchState.repoPaths ?? [])
  const [terminalCount, setTerminalCount] = useState(() => cachedLaunchState.terminalCount ?? 4)
  const [advanced, setAdvanced] = useState(() => cachedLaunchState.advanced ?? false)
  const [viewMode, setViewMode] = useState<'wall' | 'kanban'>(
    () => cachedLaunchState.viewMode ?? 'kanban'
  )
  // Per U5 (required field, defaults visible). The user MUST see this
  // before launching — initial value defaults to whatever they picked
  // last (or 'both' on first launch / junk storage) so the form is
  // valid out of the box and consistent with the rest of the form.
  const [defaultPublishPath, setDefaultPublishPath] =
    useState<import('../../shared/types').PublishPath>(
      () => cachedLaunchState.defaultPublishPath
        ?? readLastChoice(LS_KEY_LAST_PUBLISH_PATH, PUBLISH_PATH_VALUES, 'both')
    )

  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>(
    () => cachedLaunchState.worktreeMode
      ?? readLastChoice(LS_KEY_LAST_WORKTREE_MODE, WORKTREE_MODE_VALUES, 'each-own')
  )
  const [namingMode, setNamingMode] = useState<NamingMode>(
    () => cachedLaunchState.namingMode
      ?? readLastChoice(LS_KEY_LAST_NAMING_MODE, NAMING_MODE_VALUES, 'auto')
  )
  const [manualNames, setManualNames] = useState<string[]>(
    () => cachedLaunchState.manualNames ?? []
  )
  const [namePlaceholders, setNamePlaceholders] = useState<string[]>([])
  const [effort, setEffort] = useState<EffortLevel>(() => {
    if (cachedLaunchState.effort) return cachedLaunchState.effort
    const lastEffort = readLastChoice(LS_KEY_LAST_EFFORT, EFFORT_VALUES, 'high')
    // Effort is constrained to <= 'high' for non-Opus models. Clamp on init
    // when the persisted last-model is something else, mirroring the
    // existing constraint applied by setModel and the appConfig effect.
    const lastModel = readLastChoice('claudinha:lastModel', MODEL_VALUES, 'opus')
    if (lastModel !== 'opus' && (lastEffort === 'max' || lastEffort === 'xhigh')) {
      return 'high'
    }
    return lastEffort
  })
  const [model, setModelRaw] = useState<Model>(
    () => cachedLaunchState.model
        ?? (localStorage.getItem('claudinha:lastModel') as Model | null)
        ?? 'opus'
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

  // Re-seed the workspace-name default when the nextWorkspaceNumber arrives
  // AFTER mount (the MANAGER_STATE_UPDATE seed races with initial render).
  // Only overwrite if the user hasn't cached a custom value and the current
  // value matches the placeholder for the (possibly stale) first render.
  useEffect(() => {
    if (cachedLaunchState.workspaceName) return
    if (nextWorkspaceNumber == null) return
    setWorkspaceName((cur) => {
      if (/^Workspace \d+$/.test(cur)) return `Workspace ${nextWorkspaceNumber}`
      return cur
    })
  }, [nextWorkspaceNumber])

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

  // Per-pane repo validation state (parallel to repoPaths)
  const [repoValidStates, setRepoValidStates] = useState<RepoValidation[]>([])

  const [error, setError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)

  const repoInputRef = useRef<HTMLInputElement>(null)
  const singleValidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const perTreeValidateTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const manualNameRefs = useRef<(HTMLInputElement | null)[]>([])
  const repoPathRefs = useRef<(HTMLInputElement | null)[]>([])

  // Auto-focus repo field on first mount (skip if cache already has values),
  // and validate any prefilled path on mount or restore.
  useEffect(() => {
    if (!cachedLaunchState.workspaceName) {
      setTimeout(() => repoInputRef.current?.focus(), 100)
    }
    if (repoPath.trim()) validateSingleRepoPath(repoPath)
    // If restoring a per-pane set from cache, re-validate each entry too
    if (repoMode === 'per-pane') {
      repoPaths.forEach((p, i) => { if (p.trim()) validatePerTreeRepoPath(i, p) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist every field change into the module-level cache so navigation doesn't lose state.
  useEffect(() => {
    cachedLaunchState = {
      workspaceName,
      repoMode,
      repoPath,
      repoPaths,
      terminalCount,
      advanced,
      viewMode,
      worktreeMode,
      namingMode,
      manualNames,
      effort,
      model,
      defaultPublishPath
    }
  }, [workspaceName, repoMode, repoPath, repoPaths, terminalCount, advanced, viewMode, worktreeMode, namingMode, manualNames, effort, model, defaultPublishPath])

  // Sync manual names + placeholders with terminal count. Only collapses
  // to 1 name when (Custom + Shared + same-repo) — in that case the single
  // name is the shared branch name. In per-repo + Shared mode we also show
  // a single name, but still size the array to terminalCount for safety.
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
  }, [validateSingleRepoPath])

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
  }, [handlePerTreeRepoChange])

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
  }, [repoPath])

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
  }, [repoPaths])

  const handleTerminalCountChange = useCallback((delta: number) => {
    setTerminalCount((prev) => Math.max(1, Math.min(32, prev + delta)))
  }, [])

  const handleManualNameChange = useCallback((index: number, value: string) => {
    setManualNames((prev) => { const arr = [...prev]; arr[index] = value; return arr })
  }, [])

  const perTreeAllValid = repoMode === 'per-pane'
    && repoPaths.length === terminalCount
    && repoPaths.every((p, i) => p.trim() !== '' && repoValidStates[i]?.valid === true && repoValidStates[i]?.isGit === true)

  const canLaunch = repoMode === 'per-pane'
    ? perTreeAllValid
    : (advanced
        ? repoPath.trim() === '' || (repoValid === true && repoIsGit === true)
        : repoValid === true && repoIsGit === true)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (repoMode === 'per-pane') {
      const trimmed = repoPaths.map((p) => p.trim())
      for (let i = 0; i < trimmed.length; i++) {
        if (!trimmed[i]) { setError(t.launchFormUI.perTerminalRepoRequired(i)); return }
        if (repoValidStates[i]?.isGit !== true) {
          setError(t.launchFormUI.perTerminalMustBeGit(i))
          return
        }
      }
    } else {
      const repo = repoPath.trim()
      if (!advanced && !repo) { setError(t.launchFormUI.repoPathRequired); return }
      if (repo && repoIsGit !== true) { setError(t.launchFormUI.pathMustBeGit); return }
    }

    setLaunching(true)
    try {
      const payload: WorkspaceCreateWithTerminalsPayload = {
        name: workspaceName.trim() || undefined,
        repoPath: repoMode === 'single' ? repoPath.trim() : '',
        repoPaths: repoMode === 'per-pane' ? repoPaths.map((p) => p.trim()) : undefined,
        terminalCount,
        worktreeMode,
        namingMode,
        manualNames: namingMode === 'manual' ? manualNames : undefined,
        effort,
        model,
        viewMode,
        defaultPublishPath
      }

      const result = await ipcInvoke(IPC.WORKSPACE_CREATE_WITH_TERMINALS, payload) as WorkspaceCreateWithTerminalsResult
      if (result.error) { setError(result.error); return }

      if (repoMode === 'single' && payload.repoPath) {
        localStorage.setItem('claudinha:lastRepoPath', payload.repoPath)
      }
      localStorage.setItem('claudinha:lastModel', model)
      // Persist the user's choices for fields that have no Settings entry,
      // so the next new-workspace seeds from these (instead of from
      // hardcoded factory defaults). Read back below to re-seed the form.
      try {
        localStorage.setItem(LS_KEY_LAST_PUBLISH_PATH, defaultPublishPath)
        localStorage.setItem(LS_KEY_LAST_REPO_MODE, repoMode)
        localStorage.setItem(LS_KEY_LAST_WORKTREE_MODE, worktreeMode)
        localStorage.setItem(LS_KEY_LAST_NAMING_MODE, namingMode)
        localStorage.setItem(LS_KEY_LAST_EFFORT, effort)
      } catch {
        // localStorage may throw in private-browsing / storage-disabled contexts.
      }

      // Clear the cache so the next new-workspace starts fresh.
      cachedLaunchState = {}

      // Re-seed the repo field from the just-persisted last-used path so the
      // next workspace defaults to the same repo instead of a blank field.
      const nextRepo = localStorage.getItem('claudinha:lastRepoPath') ?? ''
      setRepoPath(nextRepo)
      setRepoPaths([])
      setRepoValidStates([])
      setRepoValid(null)
      setRepoIsGit(null)
      // Re-run validation for the re-seeded path so the submit button doesn't
      // stay stuck disabled when the form stays mounted after a successful
      // create (the workspace opens in its own window — LaunchForm doesn't
      // unmount, so the mount-time validation effect won't re-fire).
      if (nextRepo.trim()) validateSingleRepoPath(nextRepo)
      setTerminalCount(4)
      setAdvanced(false)
      // Re-seed each persisted field from the values we just wrote to
      // localStorage so the form reflects the user's last choice instead of
      // factory defaults. Effort clamps to 'high' when the active model
      // doesn't allow higher tiers (mirrors the existing constraint).
      setRepoMode(readLastChoice(LS_KEY_LAST_REPO_MODE, REPO_MODE_VALUES, 'single'))
      setWorktreeMode(readLastChoice(LS_KEY_LAST_WORKTREE_MODE, WORKTREE_MODE_VALUES, 'each-own'))
      setNamingMode(readLastChoice(LS_KEY_LAST_NAMING_MODE, NAMING_MODE_VALUES, 'auto'))
      setDefaultPublishPath(readLastChoice(LS_KEY_LAST_PUBLISH_PATH, PUBLISH_PATH_VALUES, 'both'))
      setManualNames([])
      const nextEffort = readLastChoice(LS_KEY_LAST_EFFORT, EFFORT_VALUES, 'high')
      setEffort(
        model !== 'opus' && (nextEffort === 'max' || nextEffort === 'xhigh')
          ? 'high'
          : nextEffort
      )
      // Workspace name re-seeds next time the form renders (new nextWorkspaceNumber will arrive via MANAGER_STATE_UPDATE)

      onLaunched?.()
    } catch {
      setError(t.launchFormUI.failedToLaunch)
    } finally {
      setLaunching(false)
    }
  }, [workspaceName, repoMode, repoPath, repoPaths, repoValidStates, terminalCount, worktreeMode, namingMode, manualNames, effort, model, repoIsGit, viewMode, advanced, onLaunched, validateSingleRepoPath])

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
  // When 'On main' is selected, no branches are created and naming is moot —
  // collapse the matrix as if the user picked Auto so the manual-name inputs
  // don't render even if `namingMode` was left on 'manual' from a prior run.
  const isCustom = namingMode === 'manual' && !isMain

  // "Terminal N: [repo input + Browse]" row
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

  // "Terminal N: [name input]" row
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

  // Single shared "Worktree branch name" input
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

  // List where each row is a separately-bordered card containing repo + name inputs
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

  // Simple list of per-terminal repo fields (no name pairing)
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

  // Simple list of per-terminal worktree name fields (same repo, separate branches)
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

  // Dispatch the right combination of fields per the matrix in the plan
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
      // Auto naming, either layout — just the repo list
      return renderRepoList({ title: t.launchFormUI.perTerminalRepos })
    }
    // Same-repo from here down
    if (isShared && isCustom) {
      return renderSharedNameField()
    }
    if (!isShared && isCustom) {
      return renderNameList()
    }
    return null
  }

  // ------------------------------------------------------------------

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 max-w-lg w-full"
    >
      {/* Workspace name */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-[500] text-fg-primary">{t.launchFormUI.workspaceNameLabel}</label>
        <TextInput
          value={workspaceName}
          onChange={(e) => setWorkspaceName(e.target.value)}
          maxLength={64}
          spellCheck={false}
          placeholder={t.launchFormUI.workspaceNamePlaceholder(nextWorkspaceNumber ?? 1)}
        />
      </div>

      {/* Repository path (basic) — greyed out when per-repo is selected in Advanced */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-[500] text-fg-primary">{t.launchFormUI.repoPathLabel}</label>
        <div className="flex items-start gap-2">
          <TextInput
            inputRef={repoInputRef}
            value={isPerRepo ? '' : repoPath}
            onChange={(e) => handleRepoChange(e.target.value)}
            placeholder={isPerRepo ? t.launchFormUI.repoPathPlaceholderPerTerminal : PATH_PLACEHOLDER}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            error={!isPerRepo && repoValid === false ? t.launchFormUI.statusPathNotFound : undefined}
            disabled={isPerRepo}
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={handleBrowse}
            disabled={isPerRepo}
            className="mt-0 shrink-0"
          >
            {t.launchFormUI.browse}
          </Button>
        </div>
        {!isPerRepo && repoStatusText() && (
          <p className={`text-xs ${repoStatusColor() === 'error' ? 'text-danger-fg' : 'text-fg-muted'}`}>
            {repoStatusText()}
          </p>
        )}
        {!isPerRepo && repoValid === true && repoIsGit === false && (
          <Button variant="ghost" size="sm" type="button" onClick={handleGitInit} className="self-start">
            {t.launchFormUI.initGit}
          </Button>
        )}
      </div>

      {/* Terminals to spawn */}
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

      {/* View mode */}
      <div className="flex flex-col gap-2">
        <SegmentedControl<'wall' | 'kanban'>
          label={t.launchFormUI.viewModeLabel}
          options={[
            { value: 'kanban', label: t.launchFormUI.viewModeKanban },
            { value: 'wall', label: t.launchFormUI.viewModeWall }
          ]}
          value={viewMode}
          onChange={setViewMode}
        />
        <div className="flex gap-3">
          <ViewModePreview
            variant="kanban"
            selected={viewMode === 'kanban'}
            onClick={() => setViewMode('kanban')}
          />
          <ViewModePreview
            variant="wall"
            selected={viewMode === 'wall'}
            onClick={() => setViewMode('wall')}
          />
        </div>
      </div>

      {/* Publish path — workspace default per U5. Required field with
          defaults visible; user must click through (or accept the
          default) before launching. */}
      <div className="flex flex-col gap-2">
        <SegmentedControl<'direct-merge' | 'pr' | 'both'>
          label={t.launchFormUI.publishPathLabel}
          options={[
            { value: 'direct-merge', label: t.launchFormUI.publishPathDirectMerge },
            { value: 'pr', label: t.launchFormUI.publishPathPr },
            { value: 'both', label: t.launchFormUI.publishPathBoth }
          ]}
          value={defaultPublishPath}
          onChange={setDefaultPublishPath}
        />
        <p className="text-[11px] text-fg-muted">
          {defaultPublishPath === 'direct-merge' && t.launchFormUI.publishPathHintDirectMerge}
          {defaultPublishPath === 'pr' && t.launchFormUI.publishPathHintPr}
          {defaultPublishPath === 'both' && t.launchFormUI.publishPathHintBoth}
        </p>
      </div>

      {/* Advanced Setup */}
      <div>
        <button
          type="button"
          onClick={() => setAdvanced(!advanced)}
          className="ui-btn text-sm text-fg-secondary hover:text-fg-primary transition-colors duration-[80ms] flex items-center gap-1.5"
        >
          <span>{advanced ? '▾' : '▸'}</span>
          {t.launchFormUI.advancedSetup}
        </button>

        <div className={`advanced-collapse${advanced ? ' open' : ''}`}>
          <div className="advanced-collapse-inner">
            <div className="pt-5 flex flex-col gap-5">
              {/* Terminal location — moved from basic */}
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

              {/* Branch layout — visible in both repo modes now */}
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

              {/* Model */}
              <SegmentedControl
                label={t.launchFormUI.modelLabel}
                options={MODEL_OPTIONS}
                value={model}
                onChange={(v) => setModel(v as Model)}
              />

              {/* Effort */}
              <SegmentedControl
                label={t.launchFormUI.effortLabel}
                options={EFFORT_OPTIONS.map((o) => ({
                  ...o,
                  disabled: (o.value === 'max' || o.value === 'xhigh') && !maxEffortAllowed
                }))}
                value={effort}
                onChange={(v) => setEffort(v as EffortLevel)}
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-danger-fg">{error}</p>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={!canLaunch || launching}
      >
        {launching
          ? t.launchFormUI.submitOpening
          : t.launchFormUI.submitLabel(terminalCount)
        }
      </Button>
    </form>
  )
}
