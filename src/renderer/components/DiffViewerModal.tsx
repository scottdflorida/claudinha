import React, { useEffect, useMemo, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { RepoDiffGetPayload, RepoDiffGetResult } from '../../shared/ipc-channels'
import { ipcInvoke } from '../hooks/useIpc'
import { Button } from './ui/Button'
import { useStrings } from '../lib/strings'

interface DiffViewerModalProps {
  paneId: string
  paneName: string
  onClose: () => void
}

export type DiffLineKind =
  | 'file-header'
  | 'hunk-header'
  | 'added'
  | 'removed'
  | 'meta'
  | 'context'

/**
 * Classify a single line from `git diff --no-color` output. Order matters:
 * the four-char prefixes `--- ` and `+++ ` must be caught before the
 * one-char `+`/`-` branches, or file-path markers would render as
 * additions/removals.
 */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('diff --git ') || line.startsWith('index ')) return 'file-header'
  if (line.startsWith('--- ') || line.startsWith('+++ ')) return 'file-header'
  if (line.startsWith('@@')) return 'hunk-header'
  if (line.startsWith('\\')) return 'meta'
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'context'
}

function rowClassFor(kind: DiffLineKind): string {
  switch (kind) {
    case 'added':
      return 'bg-success-subtle-bg text-success-fg'
    case 'removed':
      return 'bg-danger-subtle-bg text-danger-fg'
    case 'hunk-header':
      return 'bg-sunken text-info-fg font-[600]'
    case 'file-header':
      return 'bg-sunken text-fg-muted'
    case 'meta':
      return 'text-fg-muted italic'
    case 'context':
    default:
      return ''
  }
}

function signFor(kind: DiffLineKind): string {
  if (kind === 'added') return '+'
  if (kind === 'removed') return '-'
  if (kind === 'hunk-header') return '@'
  return ' '
}

/**
 * DiffViewerModal — read-only viewer of `git diff <base>..HEAD` for a pane's
 * worktree. Triggered by clicking the diff chip on a Kanban card. Diff is
 * truncated server-side at 1MB to keep IPC payloads bounded; truncation is
 * shown to the user as a banner.
 */
export function DiffViewerModal({ paneId, paneName, onClose }: DiffViewerModalProps): React.JSX.Element {
  const t = useStrings()
  const [diff, setDiff] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [baseBranch, setBaseBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const payload: RepoDiffGetPayload = { paneId }
    ipcInvoke(IPC.REPO_DIFF_GET, payload)
      .then((res) => {
        if (cancelled) return
        const result = res as RepoDiffGetResult
        if (result.error) {
          setError(result.error)
          return
        }
        setDiff(result.diff)
        setTruncated(result.truncated)
        setBaseBranch(result.baseBranch)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [paneId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const lines = useMemo(() => (diff.length === 0 ? [] : diff.split('\n')), [diff])

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={t.diffViewer.diffForFmt(paneName)}
    >
      <div
        className="w-[1040px] max-w-[94vw] max-h-[88vh] bg-surface border border-[var(--color-border-strong)] rounded-md shadow-xl flex flex-col"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-[600] text-fg-primary truncate">{t.diffViewer.title}</span>
            <span className="text-[11px] text-fg-muted truncate">
              {paneName}{baseBranch ? t.diffViewer.vsBranchFmt(baseBranch) : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.diffViewer.closeAria}
            className="text-fg-muted hover:text-fg-primary"
          >
            ✕
          </button>
        </div>

        {truncated && (
          <div className="shrink-0 px-4 py-2 bg-warning-fg/10 border-b border-[var(--color-border-subtle)] text-xs text-warning-fg">
            {t.diffViewer.truncated} <code>git diff</code> {t.diffViewer.truncatedSuffix}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-fg-muted">
              {t.diffViewer.loading}
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-sm text-danger-fg">
              {error}
            </div>
          ) : lines.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-fg-muted">
              {t.diffViewer.noDifferences}
            </div>
          ) : (
            <div className="font-mono text-[12px] leading-[1.55] text-fg-primary">
              {lines.map((line, i) => {
                const kind = classifyDiffLine(line)
                const sign = signFor(kind)
                const body = kind === 'added' || kind === 'removed' ? line.slice(1) : line
                return (
                  <div
                    key={i}
                    className={`grid grid-cols-[1.5rem_1fr] ${rowClassFor(kind)}`}
                  >
                    <span className="select-none text-center opacity-70">{sign}</span>
                    <span className="whitespace-pre-wrap break-all pr-3">
                      {body.length === 0 ? ' ' : body}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-[var(--color-border-subtle)] flex items-center justify-end">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            {t.diffViewer.close}
          </Button>
        </div>
      </div>
    </div>
  )
}
