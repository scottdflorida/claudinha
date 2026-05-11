import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Plus } from 'lucide-react'
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

const LS_KEY_LAST_REPO = 'claudinha:lastRepoPath'
const LS_KEY_LAST_MODEL = 'claudinha:lastModel'
const LS_KEY_LAST_EFFORT = 'claudinha:lastEffort'
const LS_KEY_LAST_EFFORT_ENABLED = 'claudinha:lastEffortEnabled'

function readLast<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored && (allowed as readonly string[]).includes(stored)) return stored as T
  } catch { /* private browsing */ }
  return fallback
}

// ---------------------------------------------------------------------------
// BranchPicker — main / + New / existing branches popover
// ---------------------------------------------------------------------------

interface BranchPickerProps {
  repoPath: string | null
  /** Selected branch name, or null when the user picked "main" (run on the
   *  repo's default branch with no worktree). */
  branch: string | null
  /** Sentinel: user is creating a new branch and has typed `pendingNewBranch`. */
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

  const handleCommitNew = () => {
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
                    if (e.key === 'Enter') { e.preventDefault(); handleCommitNew() }
                    else if (e.key === 'Escape') { e.preventDefault(); setEnteringNew(false); setNewDraft('') }
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
  const [model, setModel] = useState<Model>(() => readLast<Model>(LS_KEY_LAST_MODEL, ['haiku', 'sonnet', 'opus'], 'opus'))
  const [effortEnabled, setEffortEnabled] = useState(() => {
    try { return localStorage.getItem(LS_KEY_LAST_EFFORT_ENABLED) === '1' } catch { return false }
  })
  const [effort, setEffort] = useState<EffortLevel>(() =>
    readLast<EffortLevel>(LS_KEY_LAST_EFFORT, ['low', 'medium', 'high', 'xhigh', 'max'], 'high')
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Effort clamp: non-opus models cap at 'high'.
  useEffect(() => {
    if (model !== 'opus' && (effort === 'xhigh' || effort === 'max')) {
      setEffort('high')
    }
  }, [model, effort])

  const branchSelection = useCallback((s: { branch: string | null; pendingNewBranch: string | null }) => {
    setBranch(s.branch)
    setPendingNewBranch(s.pendingNewBranch)
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

  const maxEffortForModel: EffortLevel = model === 'opus' ? 'max' : 'high'
  const effortOptionsForModel = EFFORT_OPTIONS.filter((o) => {
    if (model === 'opus') return true
    return o.value === 'low' || o.value === 'medium' || o.value === 'high'
  })

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Repo */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-[600] text-fg-secondary uppercase tracking-wide">Repository</label>
        <TextInput
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="/path/to/repo"
          autoFocus
        />
      </div>

      {/* Branch */}
      <div className="flex flex-col gap-1.5">
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
      <div className="flex flex-col gap-1.5">
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
      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-[600] text-fg-secondary uppercase tracking-wide">Model</label>
        <SegmentedControl
          options={MODEL_OPTIONS}
          value={model}
          onChange={setModel}
          size="sm"
        />
      </div>

      {/* Effort */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <label className="text-[12px] font-[600] text-fg-secondary uppercase tracking-wide">Set global effort?</label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={effortEnabled}
              onChange={(e) => setEffortEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-[13px] text-fg-secondary">{effortEnabled ? 'Yes' : 'No'}</span>
          </label>
        </div>
        {effortEnabled && (
          <>
            <SegmentedControl
              options={effortOptionsForModel}
              value={effortOptionsForModel.some((o) => o.value === effort) ? effort : maxEffortForModel}
              onChange={setEffort}
              size="sm"
            />
            {model !== 'opus' && (
              <p className="text-[12px] text-fg-muted">
                X High and Max effort require the Opus model.
              </p>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="text-[13px] text-danger-fg bg-danger-subtle-bg border border-danger-fg/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" variant="primary" size="md" disabled={submitting}>
          {submitting ? 'Launching…' : 'Launch workspace'}
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
