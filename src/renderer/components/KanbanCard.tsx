import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileDiff, X } from 'lucide-react'
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
  /** Click on the diff chip — opens the diff viewer modal. */
  onDiffClick?: () => void
  /** Click on the X — routes to the shared close-pane flow. */
  onClose?: () => void
}

/**
 * Activity text. Per feedback item 6, status text is redundant with the column
 * header — only render an activity row while Claude is actively working, and
 * only to expose the current tool (if one is in-flight).
 */
function activityFor(pane: RendererPane, t: Strings): string | null {
  if (pane.terminated) return 'PTY exited'
  if (pane.status !== 'working') return null
  return pane.activeToolName ? formatToolActivity(pane.activeToolName) : t.kanban.working
}

/**
 * Compose the right-side completion/sync indicator. Uncommitted is NOT shown
 * here — it's rendered inline with the diff chip instead (see feedback item 8).
 */
function syncIndicator(pane: RendererPane, t: Strings): { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' } | null {
  const cs = pane.completionStatus
  if (cs) {
    switch (cs.state) {
      case 'queued':     return { label: t.completionBar.queued(cs.queuePosition ?? 0), tone: 'neutral' }
      case 'rebasing':   return { label: t.kanban.actionRebasing, tone: 'neutral' }
      case 'merging':    return { label: t.kanban.actionMerging, tone: 'neutral' }
      case 'pushing':    return { label: t.kanban.actionPushing, tone: 'neutral' }
      case 'merged':     return { label: t.kanban.actionMerged, tone: 'good' }
      case 'pr-created': return { label: 'PR', tone: 'good' }
      case 'conflict':   return { label: t.kanban.actionConflict, tone: 'warn' }
      case 'dirty-main': return { label: t.kanban.actionMainDirty, tone: 'warn' }
      case 'error':      return { label: t.kanban.actionFailed, tone: 'bad' }
      default: break
    }
  }
  const gs = pane.gitStatus
  if (!gs) return null
  if (gs.commitsAhead > 0) return { label: `${gs.commitsAhead} ahead`, tone: 'neutral' }
  return null
}

const TONE_CLASSES: Record<'neutral' | 'good' | 'warn' | 'bad', string> = {
  neutral: 'text-fg-muted',
  good: 'text-success-fg',
  warn: 'text-warning-fg',
  bad: 'text-danger-fg'
}

export function KanbanCard({ pane, statusColor, isActive, onClick, onDiffClick, onClose }: KanbanCardProps): React.JSX.Element {
  const t = useStrings()
  const agentName = resolvePaneDisplayName(pane)
  const activity = activityFor(pane, t)
  const sync = syncIndicator(pane, t)
  const linesAdded = pane.metrics.linesAdded ?? 0
  const linesRemoved = pane.metrics.linesRemoved ?? 0
  const showDiffChip = linesAdded > 0 || linesRemoved > 0
  const hasUncommitted = pane.gitStatus?.hasUncommittedChanges === true
  const showPlanBadge = pane.permissionMode === 'plan'
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

  const handleDiffClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onDiffClick?.()
  }, [onDiffClick])

  const handleCloseClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose?.()
  }, [onClose])

  // Focus indicator (feedback item 11):
  // - `bg-overlay` on focused to lift the background
  // - `outline` (outside the box, doesn't cover the left status bar) at the
  //   fg-muted color with a small offset
  // - DO NOT use `ring-*` — that's box-shadow based and overlays the box,
  //   which was covering the left borderLeft color bar.
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
        w-full text-left rounded-md ${baseBg}
        flex flex-col gap-1.5 px-3 py-2 cursor-pointer
        transition-colors duration-[80ms]
        hover:bg-overlay focus:outline-none focus-visible:outline-accent
      `}
      style={{
        // Status-color bar on the left (matches Wall's pane border).
        borderLeft: `2px solid ${statusColor}`,
        // Focus outline OUTSIDE the box so it doesn't cover the left color bar.
        outline: isActive ? '1px solid var(--color-fg-muted)' : 'none',
        outlineOffset: isActive ? 2 : 0
      }}
    >
      {/* Top row: repo · agent name (truncated) · pencil · plan badge.
          The pencil sits immediately after the last character of the name
          so it's visually unambiguous which thing it will rename. A flex-1
          spacer after the pencil pushes the PLAN badge to the right edge. */}
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
              className="text-[11px] text-fg-muted hover:text-white shrink-0 -ml-1"
            >
              ✎
            </button>
            {/* Spacer: pushes the PLAN badge to the right so the pencil stays
                adjacent to the name rather than floating away from it. */}
            <span className="flex-1" aria-hidden="true" />
          </>
        )}
        {showPlanBadge && (
          <span
            className="shrink-0 text-[9px] font-[600] uppercase tracking-wider px-1 py-0 rounded-sm border"
            style={{ color: '#47978c', borderColor: '#47978c' }}
            title={t.kanban.planMode}
          >
            PLANNING
          </span>
        )}
        {sync && (
          <span
            className={`shrink-0 text-[11px] ${TONE_CLASSES[sync.tone]}`}
            title={sync.label}
          >
            {sync.label}
          </span>
        )}
        {onClose && (
          <button
            type="button"
            onClick={handleCloseClick}
            aria-label={t.paneHeader.closePane}
            title={t.paneHeader.clearPane}
            className="shrink-0 text-fg-muted hover:text-danger-fg transition-colors duration-[80ms] -mr-1"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Activity row — only when working (concept feedback item 6) */}
      {activity && (
        <div className="text-[11px] text-fg-secondary truncate" title={activity}>
          {activity}
        </div>
      )}

      {/* Footer: diff chip + uncommitted pill, left-aligned. The sync badge
          (Merged / PR open / Conflict / Action failed / Queued N / etc.)
          lives in the title row above so cards without diff/uncommitted
          content stay a single row tall. The "Uncommitted" pill sits
          adjacent to +N/-M per feedback item 8 so users read "these changes
          are uncommitted" as one thought. */}
      {(showDiffChip || hasUncommitted) && (
        <div className="flex items-center gap-2 text-[11px] tabular-nums min-w-0">
          {showDiffChip && (
            <button
              type="button"
              onClick={handleDiffClick}
              disabled={!onDiffClick}
              aria-label={t.kanban.viewDiff}
              title={onDiffClick ? t.kanban.viewDiffVsBase : undefined}
              className="inline-flex items-center gap-1 text-fg-muted hover:text-fg-primary disabled:cursor-default disabled:hover:text-fg-muted group"
            >
              <FileDiff size={11} className="shrink-0 opacity-70 group-hover:opacity-100" />
              <span>
                <span className="text-success-fg">+{linesAdded}</span>
                <span className="text-fg-muted"> </span>
                <span className="text-danger-fg">−{linesRemoved}</span>
              </span>
            </button>
          )}
          {hasUncommitted && (
            <span
              className="shrink-0 text-warning-fg"
              title={t.kanban.uncommittedTooltip}
            >
              Uncommitted
            </span>
          )}
        </div>
      )}
    </div>
  )
}
