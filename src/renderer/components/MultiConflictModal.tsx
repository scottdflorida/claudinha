/**
 * MultiConflictModal — surfaces every per-pane failure from a bulk run
 * in a single screen so the user can resolve them all at once.
 *
 * Per-row resolution choices (U6 default — both bulk and per-row):
 *   - "Resolve manually": no IPC; the user opens the pane and resolves
 *     conflicts in their editor, then re-publishes via the per-terminal
 *     TurnsModal.
 *   - "Discard": drops every publishable turn on the conflicted pane
 *     via the discard engine (cascade-confirmed). The work is gone.
 *   - "Punt to Claude": deferred to M6. The MVP shows it as a disabled
 *     option with an explanatory tooltip.
 *
 * Bulk choice ("apply to all"): pick a kind in the header, click "Apply
 * to all conflicts." The renderer dispatches one MERGE_CONFLICT_RESOLVE
 * per row with the chosen kind.
 */

import React, { useEffect, useRef, useState } from 'react'
import { ipcInvoke } from '../hooks/useIpc'
import { IPC } from '../../shared/ipc-channels'
import type {
  RepoPaneTurns,
  BulkActionResult,
  MergeConflictResolvePayload,
  MergeConflictResolveResult,
  ConflictResolution
} from '../../shared/ipc-channels'

interface MultiConflictModalProps {
  panes: RepoPaneTurns[]
  results: BulkActionResult[]
  onClose: () => void
}

export function MultiConflictModal({ panes, results, onClose }: MultiConflictModalProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [resolved, setResolved] = useState<Map<string, ConflictResolution['kind']>>(new Map())
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const handleNativeClose = (): void => onClose()
    dialog.addEventListener('close', handleNativeClose)
    return () => dialog.removeEventListener('close', handleNativeClose)
  }, [onClose])

  const failures = results.filter((r) => !r.ok)
  // Match each failure to its pane name for the row label.
  const rows = failures.map((r) => ({
    result: r,
    pane: panes.find((p) => p.paneId === r.paneId) ?? null
  }))

  const dispatchOne = async (paneId: string, kind: ConflictResolution['kind']): Promise<void> => {
    setWorking(paneId)
    setError(null)
    const payload: MergeConflictResolvePayload = {
      paneId,
      resolution: { kind } as ConflictResolution
    }
    const raw = await ipcInvoke(IPC.MERGE_CONFLICT_RESOLVE, payload)
    const result = raw as MergeConflictResolveResult
    setWorking(null)
    if (result.error) {
      setError(`${paneId}: ${result.error}`)
      return
    }
    setResolved((prev) => {
      const next = new Map(prev)
      next.set(paneId, kind)
      return next
    })
  }

  const applyToAll = async (kind: ConflictResolution['kind']): Promise<void> => {
    setError(null)
    for (const row of rows) {
      if (resolved.has(row.result.paneId)) continue
      await dispatchOne(row.result.paneId, kind)
    }
  }

  const handleClose = (): void => dialogRef.current?.close()

  const allResolved = rows.every((r) => resolved.has(r.result.paneId))

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="multi-conflict-modal-title"
      className="
        bg-surface text-fg-primary
        rounded-lg border border-[var(--color-border-strong)] shadow-2xl
        p-0 w-[640px] max-w-[92vw] max-h-[85vh]
        flex flex-col overflow-hidden
        backdrop:bg-black/40
      "
      data-testid="multi-conflict-modal"
    >
      <header className="flex-shrink-0 px-5 py-4 border-b border-[var(--color-border-subtle)]">
        <h2 id="multi-conflict-modal-title" className="text-sm font-[600] text-fg-primary">
          {failures.length === 1 ? 'Bulk run hit one conflict' : `Bulk run hit ${failures.length} conflicts`}
        </h2>
        <p className="text-[11px] text-fg-muted mt-0.5">
          Pick a resolution per agent, or apply one to all.
        </p>
      </header>

      <div className="flex-shrink-0 px-5 py-2 flex items-center gap-2 border-b border-[var(--color-border-subtle)] text-[11px]">
        <span className="text-fg-muted">Apply to all:</span>
        <button
          type="button"
          onClick={() => void applyToAll('manual')}
          disabled={allResolved || working !== null}
          className="px-2 py-0.5 rounded border border-[var(--color-border-subtle)] text-fg-muted hover:text-fg-primary disabled:opacity-50"
        >
          Resolve manually
        </button>
        <button
          type="button"
          onClick={() => void applyToAll('discard')}
          disabled={allResolved || working !== null}
          className="px-2 py-0.5 rounded border border-danger-fg/60 text-danger-fg hover:bg-danger-fg/10 disabled:opacity-50"
        >
          Discard all
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-fg-muted">
            No conflicts.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {rows.map(({ result, pane }) => {
              const r = resolved.get(result.paneId)
              const isWorking = working === result.paneId
              return (
                <li key={result.paneId} className="px-5 py-3 flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-[600] text-fg-primary truncate">
                      {pane?.paneName ?? result.paneId}
                    </span>
                    <span className="text-[11px] uppercase text-warning-fg">
                      {result.errorKind ?? 'error'}
                    </span>
                  </div>
                  <pre className="text-[11px] text-fg-secondary whitespace-pre-wrap leading-tight bg-canvas/40 rounded px-2 py-1">
                    {result.errorMessage ?? 'unknown error'}
                  </pre>
                  {r ? (
                    <span className="text-[11px] text-success-fg">resolved · {labelFor(r)}</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <RowResolutionButton
                        onClick={() => void dispatchOne(result.paneId, 'manual')}
                        disabled={isWorking || working !== null}
                      >
                        Resolve manually
                      </RowResolutionButton>
                      <RowResolutionButton
                        onClick={() => void dispatchOne(result.paneId, 'discard')}
                        tone="danger"
                        disabled={isWorking || working !== null}
                      >
                        Discard
                      </RowResolutionButton>
                      <RowResolutionButton
                        onClick={() => void 0}
                        disabled
                        title="Coming in M6: hands the conflict back to the agent's terminal with a 'rebase onto main and resolve' prompt. For now, use Resolve manually (open the worktree in your editor) or Discard."
                      >
                        Punt to Claude
                      </RowResolutionButton>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <footer className="flex-shrink-0 border-t border-[var(--color-border-subtle)] px-5 py-3 flex items-center justify-end gap-2 bg-bg-elevated">
        {error && <div className="flex-1 text-[11px] text-danger-fg">{error}</div>}
        <button
          type="button"
          onClick={handleClose}
          className="text-[12px] px-3 py-1 rounded border border-[var(--color-border-subtle)] text-fg-secondary hover:text-fg-primary hover:bg-overlay"
        >
          Close
        </button>
      </footer>
    </dialog>
  )
}

function labelFor(kind: ConflictResolution['kind']): string {
  switch (kind) {
    case 'manual': return 'manual'
    case 'discard': return 'discarded'
    case 'punt-to-claude': return 'punted to Claude'
  }
}

interface RowResolutionButtonProps {
  onClick: () => void
  disabled?: boolean
  tone?: 'danger'
  title?: string
  children: React.ReactNode
}

function RowResolutionButton({ onClick, disabled, tone, title, children }: RowResolutionButtonProps): React.JSX.Element {
  const toneClass = tone === 'danger'
    ? 'border-danger-fg/60 text-danger-fg hover:bg-danger-fg/10'
    : 'border-[var(--color-border-subtle)] text-fg-secondary hover:text-fg-primary hover:bg-overlay'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        text-[11px] px-2 py-0.5 rounded border
        transition-colors duration-[80ms]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${toneClass}
      `}
    >
      {children}
    </button>
  )
}
