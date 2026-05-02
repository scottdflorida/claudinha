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
  /** Click on the next-step pill (changes-ready tiles only) — opens
   *  the ChangesReadyModal. The diff chip is gone in the new design;
   *  the pill is the single CTA. */
  onPillClick?: () => void
  /** Click on the X — routes to the shared close-pane flow. */
  onClose?: () => void
  /** Click on the "Main dirty" chip — opens the resolution modal. */
  onResolveDirtyMain?: () => void
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

/**
 * Single "next step" pill rendered on changes-ready tiles. Precedence:
 *   1. uncommitted edits   → `+N/-M to commit`
 *   2. unmerged-vs-base    → `N to merge`
 *   3. unpushed-to-remote  → `↑N to push`
 *   4. open PR             → `PR #N open`  (PR # not currently tracked,
 *                          shown as `PR open` until plumbing arrives)
 *   5. otherwise           → null (tile shouldn't be in this column).
 *
 * Renders nothing on tiles outside `changes-ready`.
 */
function nextStepPill(pane: RendererPane, t: Strings): { label: string; tone: 'good' | 'neutral' | 'warn' } | null {
  if (pane.status !== 'changes-ready') return null
  const linesAdded = pane.metrics.linesAdded ?? 0
  const linesRemoved = pane.metrics.linesRemoved ?? 0
  const gs = pane.gitStatus
  if (gs?.hasUncommittedChanges) {
    return { label: t.kanban.nextStepCommit(linesAdded, linesRemoved), tone: 'warn' }
  }
  // Without a dedicated "unmerged-vs-base" probe, fall back to commitsAhead
  // for both merge and push pills. The plan's precedence (commit → merge →
  // push → PR) collapses here because the renderer doesn't currently
  // distinguish merged-but-unpushed from unmerged.
  if (gs && gs.commitsAhead > 0) {
    return { label: t.kanban.nextStepMerge(gs.commitsAhead), tone: 'neutral' }
  }
  // Open PR display would require a per-tile PR number; not wired yet.
  return null
}

const PILL_TONE_CLASSES: Record<'good' | 'neutral' | 'warn', string> = {
  good: 'text-success-fg border-success-fg/60 hover:bg-success-fg/10',
  neutral: 'text-fg-primary border-[var(--color-border-strong)] hover:bg-overlay',
  warn: 'text-warning-fg border-warning-fg/60 hover:bg-warning-fg/10'
}

export function KanbanCard({
  pane,
  statusColor,
  isActive,
  onClick,
  onPillClick,
  onClose,
  onResolveDirtyMain,
  onResolveConflict
}: KanbanCardProps): React.JSX.Element {
  const t = useStrings()
  const agentName = resolvePaneDisplayName(pane)
  const activity = activityFor(pane, t)
  const pill = nextStepPill(pane, t)
  // Surface action-state errors / conflicts / dirty-main on the tile so the
  // user can route them without opening the changes-ready modal.
  const completionState = pane.completionStatus?.state
  const showActionWarn =
    completionState === 'conflict' ||
    completionState === 'dirty-main' ||
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

  const handlePillClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onPillClick?.()
  }, [onPillClick])

  const handleCloseClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose?.()
  }, [onClose])

  const handleActionWarnClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (completionState === 'conflict') onResolveConflict?.()
    else if (completionState === 'dirty-main') onResolveDirtyMain?.()
    else onPillClick?.()
  }, [completionState, onResolveConflict, onResolveDirtyMain, onPillClick])

  const isAwaitingOrders = pane.status === 'awaiting-prompt'
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
        flex flex-col gap-1.5 px-3 py-2 cursor-pointer
        transition-colors duration-[80ms]
        hover:bg-overlay focus:outline-none focus-visible:outline-accent
      `}
      style={{
        borderLeft: `2px solid ${pane.terminated ? '#DB4D3F' : statusColor}`,
        outline: isActive ? '1px solid var(--color-fg-muted)' : 'none',
        outlineOffset: isActive ? 2 : 0
      }}
    >
      {/* Top row: repo · agent name (truncated) · spacer · pill · X.
          Close X and rename pencil are HOVER-ONLY across every column —
          one consistent rule, no per-column variant. */}
      <div className="flex items-baseline min-w-0 gap-2">
        {!isAwaitingOrders && (
          <span
            className="text-[11px] text-fg-muted shrink-0 truncate max-w-[40%]"
            title={pane.repoName}
          >
            {pane.repoName}
          </span>
        )}
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
              {isAwaitingOrders ? pane.repoName : agentName}
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
        {/* Action-state warn glyph (conflict / dirty-main / failed) — clickable
            shortcut to the matching resolver. */}
        {showActionWarn && (
          <button
            type="button"
            onClick={handleActionWarnClick}
            className="shrink-0 text-[11px] text-warning-fg hover:underline"
            title={
              completionState === 'conflict'
                ? t.kanban.actionConflictResolve
                : completionState === 'dirty-main'
                  ? t.kanban.actionMainDirtyResolve
                  : t.kanban.actionFailed
            }
          >
            {completionState === 'conflict'
              ? t.kanban.actionConflict
              : completionState === 'dirty-main'
                ? t.kanban.actionMainDirty
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

      {/* Next-step pill — only on changes-ready tiles. The pill is the
          modal-opening CTA; the old separate diff chip + sync glyph are
          collapsed into this one slot. */}
      {pill && (
        <div className="flex items-center min-w-0">
          <button
            type="button"
            onClick={handlePillClick}
            disabled={!onPillClick}
            className={`
              inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] tabular-nums
              transition-colors duration-[80ms]
              disabled:cursor-default
              ${PILL_TONE_CLASSES[pill.tone]}
            `}
          >
            {pill.label}
          </button>
        </div>
      )}
    </div>
  )
}
