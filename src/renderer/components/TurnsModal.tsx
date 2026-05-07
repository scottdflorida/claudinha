/**
 * TurnsModal — per-terminal modal for the turn-as-commit completion-actions
 * flow (Option B). Replaces the legacy ChangesReadyModal.
 *
 * **M0 STATUS: stub.** Renders a "coming soon" placeholder. M1 fleshes out
 * the turn list, inline diffs, and the publish/squash dropdown. M2 adds
 * discard + cascade. M3 adds hunk-level split. M4 wires the merge / PR
 * paths. M5 introduces the repo-level aggregate via `RepoChangesModal`.
 *
 * Mounted by:
 *   - `Pane.tsx`               — wall-mode in-strip CTA on changes-ready panes
 *   - `KanbanBoard.tsx`        — kanban-mode pill on changes-ready cards
 *
 * The dialog uses `<dialog>.showModal()` for top-layer paint (per L-060)
 * so it composes correctly with `ConflictResolveModal` and any future
 * sub-dialogs.
 */

import React, { useEffect, useRef } from 'react'
import { useStrings } from '../lib/strings'

interface TurnsModalProps {
  /** The pane whose turns we're surfacing. */
  paneId: string
  /** Display name for the pane (resolved via `resolvePaneDisplayName`). */
  paneName: string
  /** Workspace owning this pane — passed to publish actions that need
   *  workspace context (e.g. side-clone-manager scoping). */
  workspaceId: string | null
  onClose: () => void
}

export function TurnsModal({ paneId, paneName, workspaceId, onClose }: TurnsModalProps): React.JSX.Element {
  const t = useStrings()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const handleNativeClose = (): void => onClose()
    dialog.addEventListener('close', handleNativeClose)
    return () => dialog.removeEventListener('close', handleNativeClose)
  }, [onClose])

  // Cancel button + Escape both close.
  const handleClose = (): void => {
    dialogRef.current?.close()
  }

  // Reference workspaceId so an unused-param warning doesn't fire while M1+
  // is still being built. Real wiring lands when publish actions get handlers.
  void workspaceId

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="turns-modal-title"
      className="
        bg-surface text-fg-primary
        rounded-lg border border-[var(--color-border-strong)] shadow-2xl
        p-0 w-[640px] max-w-[90vw] max-h-[80vh]
        overflow-hidden
        backdrop:bg-black/40
      "
      data-testid={`turns-modal-${paneId}`}
    >
      <header className="px-5 py-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
        <div className="min-w-0">
          <h2
            id="turns-modal-title"
            className="text-sm font-[600] text-fg-primary truncate"
            title={paneName}
          >
            {t.turnsModal.titleFmt(paneName)}
          </h2>
          <p className="text-[11px] text-fg-muted mt-0.5">
            {t.turnsModal.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label={t.turnsModal.closeAria}
          className="text-fg-muted hover:text-fg-primary text-lg leading-none"
        >
          ×
        </button>
      </header>

      <div className="p-8 flex flex-col items-center justify-center text-center gap-3">
        <div className="text-2xl">🚧</div>
        <p className="text-sm text-fg-secondary">{t.turnsModal.comingSoon}</p>
        <p className="text-[11px] text-fg-muted max-w-[400px]">
          {t.turnsModal.comingSoonBody}
        </p>
      </div>

      <footer className="px-5 py-3 border-t border-[var(--color-border-subtle)] flex justify-end">
        <button
          type="button"
          onClick={handleClose}
          className="
            text-[12px] px-3 py-1 rounded border border-[var(--color-border-subtle)]
            text-fg-secondary hover:text-fg-primary hover:bg-overlay
            transition-colors duration-[80ms]
          "
        >
          {t.turnsModal.closeButton}
        </button>
      </footer>
    </dialog>
  )
}
