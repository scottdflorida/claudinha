import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Plus, FolderOpen } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type {
  WorkspaceCreateWithTerminalsPayload,
  WorkspaceCreateWithTerminalsResult,
  GitListBranchesPayload,
  GitListBranchesResult
} from '../../shared/ipc-channels'
import type { EffortLevel, Model } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { TextInput } from './ui/TextInput'
import { Button } from './ui/Button'
import { SegmentedControl } from './ui/SegmentedControl'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X High' },
  { value: 'max', label: 'Max' }
]

const MODEL_OPTIONS: { value: Model; label: string }[] = [
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' }
]

const YES_NO_OPTIONS: { value: 'yes' | 'no'; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
]

const LS_KEY_LAST_REPO = 'claudinha:lastRepoPath'
const LS_KEY_LAST_MODEL = 'claudinha:lastModel'
const LS_KEY_LAST_EFFORT = 'claudinha:lastEffort'
const LS_KEY_LAST_EFFORT_ENABLED = 'claudinha:lastEffortEnabled'

/** Default field width (~half the 720px content column) so the form reads as
 *  a centered stack rather than a wall-to-wall sheet. */
const FIELD_HALF_WIDTH = 'w-full max-w-[360px]'

function readLast<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored && (allowed as readonly string[]).includes(stored)) return stored as T
  } catch { /* private browsing */ }
  return fallback
}

/** Cap for the persisted last-effort that this model can actually run. */
function effortCapForModel(m: Model): EffortLevel {
  return m === 'opus' ? 'max' : 'high'
}

function clampEffortToModel(level: EffortLevel, m: Model): EffortLevel {
  if (m === 'opus') return level
  if (level === 'xhigh' || level === 'max') return 'high'
  return level
}

/** Initial effort for a given model: persisted last → otherwise xhigh for
 *  Opus, high for Sonnet/Haiku. Clamped to what the chosen model can run. */
function initialEffortFor(m: Model): EffortLevel {
  const persisted = readLast<EffortLevel | ''>(LS_KEY_LAST_EFFORT, ['low', 'medium', 'high', 'xhigh', 'max', ''], '')
  if (persisted) return clampEffortToModel(persisted as EffortLevel, m)
  return m === 'opus' ? 'xhigh' : 'high'
}

// ---------------------------------------------------------------------------
// BranchPicker — main / + New / existing branches popover
// ---------------------------------------------------------------------------

interface BranchPickerProps {
  repoPath: string | null
  branch: string | null
  pendingNewBranch: string | null
  onSelect: (selection: { branch: string | null; pendingNewBranch: string | null }) => void
}

function BranchPicker({ repoPath, branch, pendingNewBranch, onSelect }: BranchPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [enteringNew, setEnteringNew] = useState(false)
  const [newDraft, setNewDraft] = useState('')
  const newInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!repoPath) {
      setBranches([])
      setDefaultBranch(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const payload: GitListBranchesPayload = { repoPath }
    ipcInvoke(IPC.GIT_LIST_BRANCHES, payload)
      .then((result) => {
        const r = result as GitListBranchesResult
        if (cancelled) return
        if (r.error) {
          setBranches([])
          setDefaultBranch(null)
          return
        }
        setBranches(r.branches)
        setDefaultBranch(r.defaultBranch ?? 'main')
      })
      .catch(() => {
        if (!cancelled) {
          setBranches([])
          setDefaultBranch(null)
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [repoPath])

  const close = useCallback(() => {
    setOpen(false)
    setEnteringNew(false)
    setNewDraft('')
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, close])

  useEffect(() => {
    if (enteringNew) requestAnimationFrame(() => newInputRef.current?.focus())
  }, [enteringNew])

  const mainLabel = defaultBranch ?? 'main'
  const buttonLabel = pendingNewBranch
    ? `New: ${pendingNewBranch}`
    : branch === null
      ? mainLabel
      : branch

  const handleSelectMain = () => {
    onSelect({ branch: null, pendingNewBranch: null })
    close()
  }

  const handleSelectExisting = (b: string) => {
    onSelect({ branch: b, pendingNewBranch: null })
    close()
  }

  const commitNew = () => {
    const trimmed = newDraft.trim()
    if (trimmed.length === 0) {
      setEnteringNew(false)
      return
    }
    onSelect({ branch: null, pendingNewBranch: trimmed })
    close()
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={!repoPath}
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 h-9 px-3 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] text-left text-[13px] transition-colors duration-[80ms] ${
          repoPath
            ? 'text-fg-primary hover:border-[var(--color-border-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]'
            : 'text-fg-muted opacity-60 cursor-not-allowed'
        }`}
      >
        <span className="truncate">{repoPath ? buttonLabel : 'Choose a repo first'}</span>
        <ChevronDown size={14} className="text-fg-muted flex-shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-overlay" onClick={close} />
          <div className="absolute left-0 right-0 top-full mt-1 z-popover bg-raised border border-[var(--color-border-subtle)] rounded-md shadow-md py-1 max-h-[280px] overflow-y-auto">
            <button
              type="button"
              onClick={handleSelectMain}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-fg-primary hover:bg-overlay transition-colors duration-[80ms]"
            >
              <span className="flex-1 truncate">{mainLabel}</span>
              {branch === null && pendingNewBranch === null && <Check size={14} className="text-accent" />}
            </button>

            <div className="h-px bg-[var(--color-border-subtle)] my-1" />

            {enteringNew ? (
              <div className="px-2 py-1">
                <input
                  ref={newInputRef}
                  type="text"
                  value={newDraft}
                  onChange={(e) => setNewDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter and Tab both commit — Tab is the natural "finish
                    // this field and move on" key, and committing is what
                    // moving on means here.
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitNew()
                    } else if (e.key === 'Tab') {
                      e.preventDefault()
                      commitNew()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setEnteringNew(false)
                      setNewDraft('')
                    }
                  }}
                  onBlur={() => {
                    if (newDraft.trim().length > 0) commitNew()
                    else setEnteringNew(false)
                  }}
                  placeholder="branch name"
                  className="w-full h-7 px-2 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] text-[13px] text-fg-primary outline-none focus:border-[var(--color-border-strong)] focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEnteringNew(true)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-fg-primary hover:bg-overlay transition-colors duration-[80ms]"
              >
                <Plus size={14} className="text-fg-muted" />
                <span className="flex-1">New branch…</span>
              </button>
            )}

            <div className="h-px bg-[var(--color-border-subtle)] my-1" />

            {loading ? (
              <div className="px-3 py-1.5 text-[12px] text-fg-muted italic">Loading…</div>
            ) : branches.length === 0 ? (
              <div className="px-3 py-1.5 text-[12px] text-fg-muted italic">No other branches</div>
            ) : (
              branches.filter((b) => b !== defaultBranch).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => handleSelectExisting(b)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-fg-primary hover:bg-overlay transition-colors duration-[80ms]"
                >
                  <span className="flex-1 truncate">{b}</span>
                  {branch === b && <Check size={14} className="text-accent" />}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// LaunchForm
// ---------------------------------------------------------------------------

interface LaunchFormProps {
  onLaunched?: () => void
  /** Kept for backwards-compat with HomeView callers; no longer used since
   *  workspace names auto-generate from `<repo>: <branch>`. */
  nextWorkspaceNumber?: number
}

export function LaunchForm({ onLaunched }: LaunchFormProps): React.JSX.Element {
  const [repoPath, setRepoPath] = useState(() => {
    try { return localStorage.getItem(LS_KEY_LAST_REPO) ?? '' } catch { return '' }
  })
  // branch === null + pendingNewBranch === null → run on main (no worktree)
  // branch === 'foo' → attach to existing branch foo
  // pendingNewBranch === 'bar' → create new branch bar
  const [branch, setBranch] = useState<string | null>(null)
  const [pendingNewBranch, setPendingNewBranch] = useState<string | null>(null)
  const [agentCount, setAgentCount] = useState(1)
  const [model, setModel] = useState<Model>(() =>
    readLast<Model>(LS_KEY_LAST_MODEL, ['haiku', 'sonnet', 'opus'], 'opus')
  )
  // Effort toggle defaults to Yes; the underlying effort level is always
  // populated so the disabled selector reads correctly when toggled off.
  const [effortEnabled, setEffortEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY_LAST_EFFORT_ENABLED)
      if (stored === null) return true
      return stored === '1'
    } catch { return true }
  })
  const [effort, setEffort] = useState<EffortLevel>(() => initialEffortFor(
    readLast<Model>(LS_KEY_LAST_MODEL, ['haiku', 'sonnet', 'opus'], 'opus')
  ))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Effort clamp: non-opus models cap at 'high'.
  useEffect(() => {
    setEffort((cur) => clampEffortToModel(cur, model))
  }, [model])

  const branchSelection = useCallback((s: { branch: string | null; pendingNewBranch: string | null }) => {
    setBranch(s.branch)
    setPendingNewBranch(s.pendingNewBranch)
  }, [])

  const handleBrowseRepo = useCallback(async () => {
    try {
      const picked = await ipcInvoke(IPC.FOLDER_BROWSE) as string | null
      if (picked && typeof picked === 'string') {
        setRepoPath(picked)
        // Reset branch selection — branches belong to a specific repo.
        setBranch(null)
        setPendingNewBranch(null)
      }
    } catch (err) {
      console.warn('[LaunchForm] folder browse failed:', err)
    }
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const trimmedRepo = repoPath.trim()
    if (!trimmedRepo) {
      setError('Repository path is required.')
      return
    }
    if (agentCount < 1 || agentCount > 32) {
      setError('Agents to spawn must be between 1 and 32.')
      return
    }
    setError(null)
    setSubmitting(true)

    const resolvedBranch = pendingNewBranch ?? branch ?? null
    const payload: WorkspaceCreateWithTerminalsPayload = {
      repoPath: trimmedRepo,
      terminalCount: agentCount,
      worktreeMode: resolvedBranch ? 'shared' : 'main',
      namingMode: 'auto',
      model,
      effort: effortEnabled ? effort : 'high',
      ...(resolvedBranch ? { branchName: resolvedBranch } : {})
    }
    try {
      const result = (await ipcInvoke(IPC.WORKSPACE_CREATE_WITH_TERMINALS, payload)) as WorkspaceCreateWithTerminalsResult
      if (result.error) {
        setError(result.error)
        setSubmitting(false)
        return
      }
      try {
        localStorage.setItem(LS_KEY_LAST_REPO, trimmedRepo)
        localStorage.setItem(LS_KEY_LAST_MODEL, model)
        if (effortEnabled) localStorage.setItem(LS_KEY_LAST_EFFORT, effort)
        localStorage.setItem(LS_KEY_LAST_EFFORT_ENABLED, effortEnabled ? '1' : '0')
      } catch { /* ignore */ }
      onLaunched?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }, [agentCount, branch, effort, effortEnabled, model, onLaunched, pendingNewBranch, repoPath, submitting])

  const effortOptionsForModel = EFFORT_OPTIONS.map((o) => ({
    ...o,
    disabled: !effortEnabled || (model !== 'opus' && (o.value === 'xhigh' || o.value === 'max'))
  }))
  // Make sure the displayed effort is a level this model can actually run.
  const displayedEffort: EffortLevel =
    model !== 'opus' && (effort === 'xhigh' || effort === 'max') ? 'high' : effort

  const launchLabel = submitting
    ? 'Launching…'
    : agentCount === 1
      ? 'Launch workspace with 1 agent'
      : `Launch workspace with ${agentCount} agents`

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-center gap-5">
      {/* Repo */}
      <div className="w-full max-w-[600px] flex flex-col gap-1.5">
        <label className="text-[12px] font-[600] text-fg-secondary uppercase tracking-wide">Repository</label>
        <div className="flex items-center gap-2">
          <TextInput
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="/path/to/repo"
            autoFocus
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleBrowseRepo}
            aria-label="Browse for repository folder"
          >
            <FolderOpen size={14} />
            <span className="ml-1.5">Browse</span>
          </Button>
        </div>
      </div>

      {/* Branch */}
      <div className={`${FIELD_HALF_WIDTH} flex flex-col gap-1.5`}>
        <label className="text-[12px] font-[600] text-fg-secondary uppercase tracking-wide">Branch</label>
        <BranchPicker
          repoPath={repoPath.trim() || null}
          branch={branch}
          pendingNewBranch={pendingNewBranch}
          onSelect={branchSelection}
        />
        <p className="text-[12px] text-fg-muted">
          Pick <span className="text-fg-secondary">main</span> to run agents directly on the repo's default branch, or
          create / attach a branch to run in a dedicated worktree.
        </p>
      </div>

      {/* Agents to spawn */}
      <div className={`${FIELD_HALF_WIDTH} flex flex-col gap-1.5`}>
        <label className="text-[12px] font-[600] text-fg-secondary uppercase tracking-wide">Agents to spawn</label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={agentCount <= 1}
            onClick={() => setAgentCount((n) => Math.max(1, n - 1))}
            aria-label="Decrement agents"
          >
            −
          </Button>
          <span className="text-[14px] font-[600] text-fg-primary tabular-nums min-w-[2ch] text-center">
            {agentCount}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={agentCount >= 32}
            onClick={() => setAgentCount((n) => Math.min(32, n + 1))}
            aria-label="Increment agents"
          >
            +
          </Button>
        </div>
      </div>

      {/* Model */}
      <div className={`${FIELD_HALF_WIDTH} flex flex-col gap-1.5`}>
        <label className="text-[12px] font-[600] text-fg-secondary uppercase tracking-wide">Model</label>
        <SegmentedControl
          options={MODEL_OPTIONS}
          value={model}
          onChange={setModel}
          size="sm"
        />
      </div>

      {/* Effort */}
      <div className={`${FIELD_HALF_WIDTH} flex flex-col gap-1.5`}>
        <div className="flex items-center justify-between gap-3">
          <label className="text-[12px] font-[600] text-fg-secondary uppercase tracking-wide">Set global effort?</label>
          <div className="w-[100px]">
            <SegmentedControl
              options={YES_NO_OPTIONS}
              value={effortEnabled ? 'yes' : 'no'}
              onChange={(v) => setEffortEnabled(v === 'yes')}
              size="sm"
            />
          </div>
        </div>
        <div className={effortEnabled ? '' : 'opacity-50 pointer-events-none'} aria-disabled={!effortEnabled}>
          <SegmentedControl
            options={effortOptionsForModel}
            value={displayedEffort}
            onChange={(v) => effortEnabled && setEffort(v)}
            size="sm"
          />
        </div>
        {effortEnabled && model !== 'opus' && (
          <p className="text-[12px] text-fg-muted">
            X High and Max effort require the Opus model.
          </p>
        )}
      </div>

      {error && (
        <div className={`${FIELD_HALF_WIDTH} text-[13px] text-danger-fg bg-danger-subtle-bg border border-danger-fg/30 rounded px-3 py-2`}>
          {error}
        </div>
      )}

      <div className="flex justify-center pt-2">
        <Button type="submit" variant="primary" size="md" disabled={submitting}>
          {launchLabel}
        </Button>
      </div>
    </form>
  )
}

/** Test-only — preserved for compatibility with the previous LaunchForm's
 *  cache-reset helper, even though the new form doesn't use a module cache. */
export function __resetCachedLaunchStateForTests(): void {
  // No-op: the new form persists only to localStorage; tests can clear that
  // themselves if needed.
}
