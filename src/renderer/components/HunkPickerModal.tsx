/**
 * HunkPickerModal — split-a-turn UI.
 *
 * Opened from TurnsModal's PublishDropdown ("Split a turn…") for an
 * `open` turn. Fetches the turn's per-file hunks via TURN_GET_DIFF, lets
 * the user check which hunks go to the FIRST commit (the rest go to the
 * SECOND), takes two commit messages, and fires TURN_SPLIT.
 *
 * Per U4 default: hunks expanded by default (the body is shown inline so
 * the user can see context, not just `+5/-2`).
 *
 * Validation gates:
 *   - At least one hunk in LEFT.
 *   - At least one hunk left over for RIGHT (rejects "all selected").
 *   - Both commit messages non-empty.
 *
 * The backend runs `git apply --check` before mutating anything, so even
 * if the picker passes a combination that's syntactically valid but
 * semantically illegal (e.g., overlapping hunks in the same file in a
 * way `git apply` rejects), the engine surfaces a clear error and aborts
 * the rebase without touching local history.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStrings } from '../lib/strings'
import { ipcInvoke } from '../hooks/useIpc'
import { IPC } from '../../shared/ipc-channels'
import type {
  TurnGetDiffPayload,
  TurnGetDiffResult,
  TurnDiffFile,
  HunkSelection,
  TurnSplitPayload,
  TurnActionResult
} from '../../shared/ipc-channels'
import type { Turn } from '../../shared/types'

interface HunkPickerModalProps {
  paneId: string
  turn: Turn
  onClose: () => void
  /** Called after a successful split; lets the parent refresh state. */
  onSplit: () => void
}

export function HunkPickerModal({ paneId, turn, onClose, onSplit }: HunkPickerModalProps): React.JSX.Element {
  const t = useStrings()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [files, setFiles] = useState<TurnDiffFile[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Per-file set of LEFT-selected hunk indexes. Keyed by file path.
  const [leftSelections, setLeftSelections] = useState<Map<string, Set<number>>>(new Map())
  const [leftMessage, setLeftMessage] = useState('')
  const [rightMessage, setRightMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Mount the dialog and listen for native close.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const handleNativeClose = (): void => onClose()
    dialog.addEventListener('close', handleNativeClose)
    return () => dialog.removeEventListener('close', handleNativeClose)
  }, [onClose])

  // Fetch the diff on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const payload: TurnGetDiffPayload = { paneId, turnId: turn.id }
      const raw = await ipcInvoke(IPC.TURN_GET_DIFF, payload)
      const result = raw as TurnGetDiffResult
      if (cancelled) return
      if (result.error) {
        setLoadError(result.error)
        return
      }
      setFiles(result.files)
      // Default: every hunk in LEFT. The user typically wants to *peel
      // off* a small piece for RIGHT — pre-checking everything makes
      // that the cheaper interaction.
      const initial = new Map<string, Set<number>>()
      for (const f of result.files) {
        initial.set(f.path, new Set(f.hunks.map((h) => h.index)))
      }
      setLeftSelections(initial)
    })()
    return () => { cancelled = true }
  }, [paneId, turn.id])

  const totalHunks = useMemo(() => {
    if (!files) return 0
    return files.reduce((acc, f) => acc + f.hunks.length, 0)
  }, [files])

  const leftHunkCount = useMemo(() => {
    let n = 0
    for (const set of leftSelections.values()) n += set.size
    return n
  }, [leftSelections])

  const canSubmit =
    !submitting &&
    files !== null &&
    leftHunkCount > 0 &&
    leftHunkCount < totalHunks &&
    leftMessage.trim().length > 0 &&
    rightMessage.trim().length > 0

  const toggleHunk = useCallback((file: string, hunkIndex: number) => {
    setActionError(null)
    setLeftSelections((prev) => {
      const next = new Map(prev)
      const set = new Set(next.get(file) ?? [])
      if (set.has(hunkIndex)) set.delete(hunkIndex)
      else set.add(hunkIndex)
      next.set(file, set)
      return next
    })
  }, [])

  const handleClose = (): void => dialogRef.current?.close()

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit || !files) return
    setSubmitting(true)
    setActionError(null)
    const hunkSelections: HunkSelection[] = files.map((f) => ({
      file: f.path,
      leftHunkIndexes: [...(leftSelections.get(f.path) ?? new Set<number>())].sort((a, b) => a - b)
    }))
    const payload: TurnSplitPayload = {
      paneId,
      turnId: turn.id,
      hunkSelections,
      leftMessage: leftMessage.trim(),
      rightMessage: rightMessage.trim()
    }
    const raw = await ipcInvoke(IPC.TURN_SPLIT, payload)
    const result = raw as TurnActionResult
    setSubmitting(false)
    if (result.error) {
      setActionError(result.error)
      return
    }
    onSplit()
    dialogRef.current?.close()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`split-modal-title-${turn.id}`}
      className="
        bg-surface text-fg-primary
        rounded-lg border border-[var(--color-border-strong)] shadow-2xl
        p-0 w-[820px] max-w-[95vw] max-h-[90vh]
        flex flex-col overflow-hidden
        backdrop:bg-black/40
      "
      data-testid={`hunk-picker-${turn.id}`}
    >
      <header className="flex-shrink-0 px-5 py-4 border-b border-[var(--color-border-subtle)]">
        <h2 id={`split-modal-title-${turn.id}`} className="text-sm font-[600] text-fg-primary">
          {t.turnsModal.splitTitleFmt(turn.index)}
        </h2>
        <p className="text-[11px] text-fg-muted mt-0.5">
          {t.turnsModal.splitBodyHint}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loadError ? (
          <div className="px-5 py-8 text-center text-[12px] text-danger-fg">{loadError}</div>
        ) : files === null ? (
          <div className="px-5 py-8 text-center text-[12px] text-fg-muted">Loading diff…</div>
        ) : files.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-fg-muted">
            This turn has no hunks (binary-only or empty diff).
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {files.map((file) => (
              <FileBlock
                key={file.path}
                file={file}
                selected={leftSelections.get(file.path) ?? new Set<number>()}
                onToggle={(idx) => toggleHunk(file.path, idx)}
                disabled={submitting}
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="flex-shrink-0 border-t border-[var(--color-border-subtle)] px-5 py-3 flex flex-col gap-2 bg-bg-elevated">
        <div className="flex items-center gap-3 text-[11px] text-fg-muted">
          <span>
            {leftHunkCount} → first · {totalHunks - leftHunkCount} → second
          </span>
          {leftHunkCount === 0 && (
            <span className="text-warning-fg">Pick at least one hunk for the first commit.</span>
          )}
          {leftHunkCount === totalHunks && totalHunks > 0 && (
            <span className="text-warning-fg">
              Every hunk is in the first commit — second would be empty. Uncheck at least one.
            </span>
          )}
        </div>
        {actionError && (
          <div className="text-[11px] text-danger-fg">{actionError}</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={leftMessage}
            onChange={(e) => setLeftMessage(e.target.value)}
            disabled={submitting}
            className="
              text-[12px] px-2 py-1 rounded border border-[var(--color-border-subtle)]
              bg-canvas text-fg-primary placeholder:text-fg-muted
              focus:outline-none focus-visible:outline-accent
              disabled:opacity-50
            "
            placeholder="First commit message"
            aria-label="First commit message"
          />
          <input
            type="text"
            value={rightMessage}
            onChange={(e) => setRightMessage(e.target.value)}
            disabled={submitting}
            className="
              text-[12px] px-2 py-1 rounded border border-[var(--color-border-subtle)]
              bg-canvas text-fg-primary placeholder:text-fg-muted
              focus:outline-none focus-visible:outline-accent
              disabled:opacity-50
            "
            placeholder="Second commit message"
            aria-label="Second commit message"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="
              text-[12px] px-3 py-1 rounded border border-[var(--color-border-subtle)]
              text-fg-secondary hover:text-fg-primary hover:bg-overlay
              transition-colors duration-[80ms]
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {t.turnsModal.splitCancelButton}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="
              text-[12px] px-3 py-1 rounded border border-success-fg/60
              text-success-fg hover:bg-success-fg/10
              transition-colors duration-[80ms]
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {submitting ? t.turnsModal.splitting : t.turnsModal.splitConfirmButton}
          </button>
        </div>
      </footer>
    </dialog>
  )
}

// ----------------------------------------------------------------------------
// FileBlock — one file's hunks rendered with checkboxes + diff body.
// ----------------------------------------------------------------------------

interface FileBlockProps {
  file: TurnDiffFile
  selected: Set<number>
  onToggle: (hunkIndex: number) => void
  disabled: boolean
}

function FileBlock({ file, selected, onToggle, disabled }: FileBlockProps): React.JSX.Element {
  const allSelected = file.hunks.every((h) => selected.has(h.index))
  const noneSelected = file.hunks.every((h) => !selected.has(h.index))
  const tone = allSelected ? 'all-left' : noneSelected ? 'all-right' : 'split'
  const toneClass =
    tone === 'all-left'
      ? 'border-l-2 border-success-fg/60'
      : tone === 'all-right'
        ? 'border-l-2 border-info-fg/60'
        : 'border-l-2 border-warning-fg/60'

  return (
    <li className={`px-5 py-2 flex flex-col gap-1.5 ${toneClass}`}>
      <header className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-mono text-fg-primary truncate" title={file.path}>
          {file.path}
        </span>
        <span className="text-[11px] text-fg-muted">
          {fileSplitSummary(file.hunks.length, selected.size)}
        </span>
      </header>
      {file.hunks.length === 0 ? (
        <p className="text-[11px] text-fg-muted italic">binary or empty</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {file.hunks.map((hunk) => {
            const isFirst = selected.has(hunk.index)
            return (
              <li
                key={hunk.index}
                className={`
                  rounded border border-[var(--color-border-subtle)]
                  ${isFirst ? 'bg-success-fg/5' : 'bg-info-fg/5'}
                `}
              >
                <div
                  className={`
                    flex items-start gap-2 px-2 py-1.5
                    ${disabled ? 'opacity-60' : ''}
                  `}
                >
                  <FirstSecondToggle
                    isFirst={isFirst}
                    disabled={disabled}
                    onToggle={() => onToggle(hunk.index)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                      <span className="font-mono truncate">{hunk.header}</span>
                      <span className="ml-auto tabular-nums">
                        <span className="text-success-fg">+{hunk.additions}</span>
                        {' '}
                        <span className="text-danger-fg">−{hunk.deletions}</span>
                      </span>
                    </div>
                    <CollapsibleHunkBody body={hunk.body} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

// ----------------------------------------------------------------------------
// FirstSecondToggle — segmented "first / second" replacement for the old
// binary checkbox. "first" maps to membership in the LEFT set (the same
// thing the checkbox used to mean); "second" maps to absence.
// ----------------------------------------------------------------------------

interface FirstSecondToggleProps {
  isFirst: boolean
  disabled: boolean
  onToggle: () => void
}

function FirstSecondToggle({ isFirst, disabled, onToggle }: FirstSecondToggleProps): React.JSX.Element {
  const baseSeg =
    'text-[10px] font-medium px-1.5 py-0.5 select-none transition-colors duration-[80ms]'
  const activeFirst = 'bg-success-fg/25 text-success-fg'
  const activeSecond = 'bg-info-fg/25 text-info-fg'
  const idle = 'text-fg-muted hover:text-fg-primary'
  return (
    <div
      role="group"
      aria-label="First or second commit"
      className={`
        mt-0.5 inline-flex rounded border border-[var(--color-border-subtle)] overflow-hidden
        ${disabled ? 'opacity-60 cursor-not-allowed' : ''}
      `}
    >
      <button
        type="button"
        aria-pressed={isFirst}
        disabled={disabled}
        onClick={() => { if (!isFirst) onToggle() }}
        className={`${baseSeg} ${isFirst ? activeFirst : idle} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        first
      </button>
      <button
        type="button"
        aria-pressed={!isFirst}
        disabled={disabled}
        onClick={() => { if (isFirst) onToggle() }}
        className={`${baseSeg} border-l border-[var(--color-border-subtle)] ${!isFirst ? activeSecond : idle} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        second
      </button>
    </div>
  )
}

/**
 * Compose a per-file summary for the hunk-picker header. Shows where
 * each hunk is going so the user doesn't have to mentally invert the
 * "first" count when most hunks are heading to the second commit.
 *
 * Examples:
 *   total=1, selected=1 → "→ first"           (whole file → first)
 *   total=1, selected=0 → "→ second"          (whole file → second)
 *   total=4, selected=3 → "3 first · 1 second" (split)
 */
function fileSplitSummary(total: number, selected: number): string {
  if (total === 0) return ''
  if (selected === total) return '→ first'
  if (selected === 0) return '→ second'
  return `${selected} first · ${total - selected} second`
}

// ----------------------------------------------------------------------------
// CollapsibleHunkBody — diff body with a 4-line preview + expand toggle.
// ----------------------------------------------------------------------------
//
// Most turns split cleanly with 1-2 hunks visible; the full body is rarely
// load-bearing. Default to a 4-line peek with a "Show all (N lines)" toggle.
// The full body is always sent to the backend — this is purely display.

const COLLAPSED_LINES = 4

function CollapsibleHunkBody({ body }: { body: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => body.split('\n'), [body])
  const isLong = lines.length > COLLAPSED_LINES
  const visible = expanded || !isLong ? body : lines.slice(0, COLLAPSED_LINES).join('\n')
  return (
    <div className="mt-1">
      <pre className="
        text-[10.5px] font-mono leading-tight
        whitespace-pre overflow-x-auto
        bg-canvas/40 rounded px-2 py-1
        text-fg-secondary
      ">{visible}</pre>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-[10.5px] text-fg-muted hover:text-fg-primary transition-colors duration-[80ms]"
          aria-expanded={expanded}
        >
          {expanded
            ? `▴ Collapse`
            : `▾ Show all (${lines.length} lines)`}
        </button>
      )}
    </div>
  )
}
