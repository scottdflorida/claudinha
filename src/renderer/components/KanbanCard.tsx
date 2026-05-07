import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { RendererPane } from '../hooks/usePaneState'
import { usePaneState } from '../hooks/usePaneState'
import { resolvePaneDisplayName } from '../../shared/pane-display'
import { formatToolActivity } from '../../shared/tool-activity'
import { useStrings } from '../lib/strings'
import type { Strings } from '../lib/strings'

interface KanbanCardProps {
  pane: RendererPane
  /** Status-driven border + dot color (matches Wall pane border). */
  statusColor: string
  /** Whether this card is the currently focused active terminal in Kanban view. */
  isActive: boolean
  onClick: () => void
  /** Click on the X — routes to the shared close-pane flow. */
  onClose?: () => void
  /** Click on the "Conflict" chip — opens the conflict resolution modal. */
  onResolveConflict?: () => void
}

/**
 * Activity text shown on the working column tile. Per the redesign, only
 * working tiles show a verb; other columns are explained by their column
 * header.
 */
function activityFor(pane: RendererPane, t: Strings): string | null {
  if (pane.terminated) return 'PTY exited'
  if (pane.status !== 'working') return null
  return pane.activeToolName ? formatToolActivity(pane.activeToolName) : t.kanban.working
}

export function KanbanCard({
  pane,
  statusColor,
  isActive,
  onClick,
  onClose,
  onResolveConflict
}: KanbanCardProps): React.JSX.Element {
  const t = useStrings()
  const agentName = resolvePaneDisplayName(pane)
  const activity = activityFor(pane, t)
  // Surface conflict on the tile so the user can route to the resolver
  // without opening a modal. Error state is shown as a non-clickable
  // indicator. (Dirty-main was removed in completion-actions v2 — side-
  // clone merges never touch the user's working tree.)
  const completionState = pane.completionStatus?.state
  const showActionWarn =
    completionState === 'conflict' ||
    completionState === 'error'

  const { setUserName } = usePaneState()

  // Inline rename — double-click name OR click pencil → edit. Enter saves,
  // Escape cancels, blur saves.
  const [isEditingName, setIsEditingName] = useState(false)
  const [draftName, setDraftName] = useState(agentName)
  const nameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [isEditingName])

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setDraftName(agentName)
    setIsEditingName(true)
  }, [agentName])

  const commitName = useCallback(() => {
    setIsEditingName(false)
    const trimmed = draftName.trim()
    if (trimmed === agentName) return
    setUserName(pane.id, trimmed.length > 0 ? trimmed : null)
  }, [draftName, agentName, pane.id, setUserName])

  const cancelEdit = useCallback(() => {
    setIsEditingName(false)
  }, [])

  const handleCardClick = useCallback(() => {
    if (isEditingName) return
    onClick()
  }, [isEditingName, onClick])

  const handleCloseClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose?.()
  }, [onClose])

  const handleActionWarnClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (completionState === 'conflict') onResolveConflict?.()
    // 'error' has no resolver action — the tile shows the indicator only.
  }, [completionState, onResolveConflict])

  const baseBg = isActive ? 'bg-overlay' : 'bg-raised'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (isEditingName) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      aria-pressed={isActive}
      aria-label={`Select ${agentName}`}
      className={`
        group/card w-full text-left rounded-md ${baseBg}
        flex flex-col justify-center gap-0 cursor-pointer
        px-3 pt-0 pb-1
        transition-colors duration-[80ms]
        hover:bg-overlay focus:outline-none focus-visible:outline-accent
      `}
      style={{
        // Fixed height so the in-flight overlay never shrinks/expands when
        // the source column's two-line content (working with active tool)
        // doesn't match the destination's one-line content. Every card is
        // the same 34px shell; one-line content centers vertically,
        // two-line content sits with the top row hugging the upper edge
        // (top-padding zeroed below) so the second line drops beneath
        // without overflowing the bottom. The bottom padding stays at 4px
        // for visual balance.
        height: 34,
        // Red left-border when the pane is in any error condition: PTY
        // terminated OR a transient action failure (mirrors PaneBorder's
        // hasError treatment in Wall mode).
        borderLeft: `2px solid ${(pane.terminated || completionState === 'error') ? '#DB4D3F' : statusColor}`,
        outline: isActive ? '1px solid var(--color-fg-muted)' : 'none',
        outlineOffset: isActive ? 2 : 0
      }}
    >
      {/* Top row: repo · agent name (truncated) · spacer · pill · X.
          Close X and rename pencil are HOVER-ONLY across every column —
          one consistent rule, no per-column variant. */}
      <div className="flex items-baseline min-w-0 gap-2">
        <span
          className="text-[11px] text-fg-muted shrink-0 truncate max-w-[40%]"
          title={pane.repoName}
        >
          {pane.repoName}
        </span>
        {isEditingName ? (
          <input
            ref={nameInputRef}
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); commitName() }
              else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
            }}
            maxLength={80}
            aria-label={t.kanban.agentNameAria}
            className="text-xs font-[600] text-fg-primary bg-canvas border border-[var(--color-border-subtle)] rounded-sm px-1 py-0 outline-none focus:ring-1 focus:ring-accent flex-1 min-w-0"
          />
        ) : (
          <>
            <span
              className="text-xs font-[600] text-fg-primary truncate min-w-0 cursor-text"
              title={`${agentName} — click pencil to rename`}
              onDoubleClick={startEdit}
            >
              {agentName}
            </span>
            <button
              type="button"
              onClick={startEdit}
              aria-label={t.kanban.renameAgent}
              title={t.kanban.renameAgent}
              className="text-[11px] text-fg-muted hover:text-white shrink-0 -ml-1 opacity-0 group-hover/card:opacity-100 transition-opacity"
            >
              ✎
            </button>
            <span className="flex-1" aria-hidden="true" />
          </>
        )}
        {/* Action-state warn glyph (conflict / failed) — clickable
            shortcut to the resolver, or non-clickable indicator on `error`. */}
        {showActionWarn && (
          <button
            type="button"
            onClick={handleActionWarnClick}
            className="shrink-0 text-[11px] text-warning-fg hover:underline"
            title={
              completionState === 'conflict'
                ? t.kanban.actionConflictResolve
                : t.kanban.actionFailed
            }
          >
            {completionState === 'conflict'
              ? t.kanban.actionConflict
              : t.kanban.actionFailed}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={handleCloseClick}
            aria-label={t.paneHeader.closePane}
            title={t.paneHeader.clearPane}
            className="shrink-0 text-fg-muted hover:text-danger-fg transition-colors duration-[80ms] -mr-1 opacity-0 group-hover/card:opacity-100"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Activity row — only on working tiles */}
      {activity && (
        <div className="text-[11px] text-fg-secondary truncate" title={activity}>
          {activity}
        </div>
      )}
    </div>
  )
}
