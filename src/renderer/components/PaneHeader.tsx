import React, { useCallback } from 'react'
import {
  ArrowRightLeft, X, MoreHorizontal,
  GitMerge, GitPullRequest, Hand,
  ArrowUp, Asterisk, ChevronDown
} from 'lucide-react'
import type { EffortLevel, Model, GitStatus, CompletionPolicy, PaneStatus, PaneMetrics } from '../../shared/types'
import type { PaneMetricsIpc } from '../../shared/ipc-channels'
import { HEADER_ROW1_HEIGHT_PX, STATUS_COLORS, STATUS_TERMINATED_COLOR } from '../lib/constants'
import { formatStatusLabel } from './StatusOverlay'
import { ContextBar } from './ContextBar'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_NAMES: Record<Model, string> = {
  opus:   'Opus 4.7',
  sonnet: 'Sonnet 4.6',
  haiku:  'Haiku 4.5'
}

// ---------------------------------------------------------------------------
// Icon button — 24px hit target, 14px icon, hover bg-raised
// ---------------------------------------------------------------------------

function IconBtn({
  icon: Icon,
  label,
  title,
  onClick,
  danger = false,
  className = ''
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  title?: string
  onClick?: (e: React.MouseEvent) => void
  danger?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      className={`flex items-center justify-center w-6 h-6 rounded flex-shrink-0 transition-colors duration-[80ms]
        ${danger
          ? 'text-fg-muted hover:bg-danger-subtle-bg hover:text-danger-fg'
          : 'text-fg-muted hover:bg-raised hover:text-fg-primary'
        } ${className}`}
      style={{ cursor: 'pointer' }}
    >
      <Icon size={14} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// PaneHeader
// ---------------------------------------------------------------------------

interface PaneHeaderProps {
  paneId: string
  repoName: string
  worktreeName: string
  sessionTitle?: string | null
  onMoveClick?: () => void
  isNarrow?: boolean
  positionNumber?: number
  onClose?: () => void
  effort?: EffortLevel
  onEffortToggle?: () => void
  gitStatus?: GitStatus | null
  completionPolicy?: CompletionPolicy | null
  onPolicyClick?: () => void
  model?: Model
  onModelClick?: () => void
  /** Controls header bg tint and label brightness (bg-surface → bg-raised, fg-secondary → fg-primary) */
  isFocused?: boolean
  /**
   * 'wall' (default): full chrome with Move/Close buttons.
   * 'kanban': hide Move/Close. Render an inline status chip and a compact
   * metrics summary in their slot, since the floating StatusOverlay /
   * MetricsOverlay are also suppressed in this mode.
   */
  chromeMode?: 'wall' | 'kanban'
  /** Required when chromeMode === 'kanban' (drives the inline status chip). */
  paneStatus?: PaneStatus
  activeToolName?: string | null
  terminated?: boolean
  isResolvingConflict?: boolean
  /** Required when chromeMode === 'kanban' (drives the inline metrics line). */
  metrics?: PaneMetrics | PaneMetricsIpc
  isApiBilling?: boolean
}

export function PaneHeader({
  paneId,
  repoName,
  worktreeName,
  sessionTitle,
  onMoveClick,
  isNarrow = false,
  positionNumber,
  onClose,
  gitStatus,
  completionPolicy,
  onPolicyClick,
  model,
  onModelClick,
  isFocused = false,
  chromeMode = 'wall',
  paneStatus,
  activeToolName = null,
  terminated = false,
  isResolvingConflict = false,
  metrics,
  isApiBilling = false
}: PaneHeaderProps): React.JSX.Element {
  const t = useStrings()
  const handleClose = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onClose?.() }, [onClose])
  const handleMove = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onMoveClick?.() }, [onMoveClick])
  const handlePolicyClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onPolicyClick?.() }, [onPolicyClick])
  const handleModelClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onModelClick?.() }, [onModelClick])

  // Policy icon (only shown for non-ask policies)
  const PolicyIcon =
    completionPolicy?.action === 'auto-merge' ? GitMerge
    : completionPolicy?.action === 'auto-pr' || completionPolicy?.action === 'auto-draft-pr' ? GitPullRequest
    : null
  const policyLabel = completionPolicy
    ? completionPolicy.action === 'auto-merge' ? `Auto-merge (${completionPolicy.mergeStrategy})`
      : completionPolicy.action === 'auto-pr' ? 'Auto-create PR'
      : completionPolicy.action === 'auto-draft-pr' ? 'Auto-create draft PR'
      : 'Ask before action'
    : undefined

  const isDirty = gitStatus?.hasUncommittedChanges ?? false
  const commitsAhead = gitStatus?.commitsAhead ?? 0

  // Kanban mode: shift the header one step darker on the surface scale so it
  // doesn't collide with the Kanban board's bg-raised tone above. Focus
  // distinction (focused slightly lighter than unfocused) is preserved at
  // the new lower starting point. Wall mode is unchanged.
  const bgClass = chromeMode === 'kanban'
    ? (isFocused ? 'bg-surface' : 'bg-canvas')
    : (isFocused ? 'bg-raised' : 'bg-surface')
  const labelColor = isFocused ? 'text-fg-primary' : 'text-fg-secondary'

  return (
    <div
      className={`flex items-center justify-between px-2 gap-1 flex-shrink-0 overflow-hidden ${bgClass}`}
      style={{ height: HEADER_ROW1_HEIGHT_PX }}
    >
      {/* Left: position pill + label + git indicators */}
      <div className={`flex items-center gap-1.5 min-w-0 flex-1 ${labelColor}`}>
        {/* Position number pill */}
        {positionNumber !== undefined && (
          <span
            className="inline-flex items-center justify-center flex-shrink-0 w-5 h-5 rounded text-[11px] font-[500] text-fg-muted bg-raised tabular-nums"
          >
            {positionNumber}
          </span>
        )}

        {/* Repo / worktree label */}
        <span className="truncate text-sm font-[500] min-w-0">
          {isNarrow
            ? (sessionTitle ?? repoName)
            : `${repoName} · ${sessionTitle ?? worktreeName}`}
        </span>

        {/* Dirty indicator */}
        {isDirty && (
          <Asterisk
            size={11}
            className="flex-shrink-0"
            style={{ color: 'var(--color-status-done)' }}
          />
        )}

        {/* Ahead indicator */}
        {!isNarrow && commitsAhead > 0 && (
          <span className="flex items-center gap-px flex-shrink-0 text-success-fg text-[11px] tabular-nums">
            <ArrowUp size={11} />
            {commitsAhead}
          </span>
        )}
      </div>

      {/* Right: action buttons / inline status+metrics chips */}
      {chromeMode === 'kanban' ? (
        <KanbanHeaderRight
          paneStatus={paneStatus ?? 'awaiting-prompt'}
          activeToolName={activeToolName}
          terminated={terminated}
          isResolvingConflict={isResolvingConflict}
          metrics={metrics}
          isApiBilling={isApiBilling}
          model={model}
          onModelClick={handleModelClick}
        />
      ) : isNarrow ? (
        /* Narrow mode: single close + overflow kebab */
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <IconBtn
            icon={MoreHorizontal}
            label={t.paneHeader.moreActions}
            title={t.paneHeader.moreActionsTooltip}
            onClick={(e) => e.stopPropagation()}
          />
          <IconBtn icon={X} label={t.paneHeader.closePane} onClick={handleClose} danger />
        </div>
      ) : (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Policy icon */}
          {PolicyIcon && (
            <IconBtn
              icon={PolicyIcon}
              label={policyLabel ?? t.paneHeader.completionPolicyLabel}
              title={policyLabel}
              onClick={handlePolicyClick}
            />
          )}

          {/* Model badge */}
          {model && (
            <button
              onClick={handleModelClick}
              aria-label={t.paneHeader.modelClickToChange(MODEL_NAMES[model])}
              title={t.paneHeader.modelClickToChange(MODEL_NAMES[model])}
              className="flex items-center gap-1 h-6 px-2 rounded flex-shrink-0 text-fg-muted bg-raised hover:bg-overlay hover:text-fg-primary transition-colors duration-[80ms] text-[11px] font-[550]"
              style={{ cursor: 'pointer' }}
            >
              <span>{MODEL_NAMES[model]}</span>
              <ChevronDown size={10} className="opacity-60" aria-hidden />
            </button>
          )}

          {/* Transfer / transplant */}
          <IconBtn
            icon={ArrowRightLeft}
            label={t.paneHeader.moveToWindow}
            title={t.paneHeader.transplantTooltip}
            onClick={handleMove}
          />

          {/* Close */}
          <IconBtn
            icon={X}
            label={t.paneHeader.closePane}
            title={t.paneHeader.clearPane}
            onClick={handleClose}
            danger
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kanban-mode right-side cluster: inline status chip + compact metrics line
// ---------------------------------------------------------------------------

interface KanbanHeaderRightProps {
  paneStatus: PaneStatus
  activeToolName: string | null
  terminated: boolean
  isResolvingConflict: boolean
  metrics?: PaneMetrics | PaneMetricsIpc
  isApiBilling: boolean
  model?: Model
  onModelClick?: (e: React.MouseEvent) => void
}

function KanbanHeaderRight({
  paneStatus,
  activeToolName,
  terminated,
  isResolvingConflict,
  metrics,
  isApiBilling,
  model,
  onModelClick
}: KanbanHeaderRightProps): React.JSX.Element {
  const t = useStrings()
  const statusColor = terminated ? STATUS_TERMINATED_COLOR : STATUS_COLORS[paneStatus]
  const label = formatStatusLabel(paneStatus, activeToolName, terminated, isResolvingConflict, t)

  const contextPercent = metrics?.contextPercent ?? null

  // Non-context metrics (lines diff, API cost) still render as a joined text run
  // after the ContextBar. The bar takes the first slot so it always anchors the
  // metrics cluster, even when the text run is empty.
  const metricBits: string[] = []
  if (metrics) {
    const la = metrics.linesAdded ?? 0
    const lr = metrics.linesRemoved ?? 0
    if (la > 0 || lr > 0) metricBits.push(`+${la} −${lr}`)
    // Cost is only meaningful for API-billing accounts (subscription-billed
    // accounts have no per-call cost), matching the floating overlay's rule.
    if (isApiBilling && metrics.totalCostUsd != null) {
      metricBits.push(`$${metrics.totalCostUsd.toFixed(2)}`)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-shrink-0 text-[11px] tabular-nums">
      {/* Inline status chip — color dot + status text. Replaces the floating
          StatusOverlay that the Wall view renders above the top border. */}
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-raised text-fg-secondary"
        title={label}
      >
        <span
          aria-hidden="true"
          className="inline-block rounded-full"
          style={{ width: 6, height: 6, background: statusColor }}
        />
        <span className="truncate max-w-[160px]">{label}</span>
      </span>

      {/* Context-window gauge. Warm gray until ≥70%, then darkish red. Always
          rendered (placeholder when data hasn't arrived yet) so neighbours
          don't reflow when the first metrics tick lands. */}
      <ContextBar contextPercent={contextPercent} />

      {/* Remaining metrics (lines diff, cost) — text run joined with " · ".
          Hidden when no metrics have arrived yet, since these segments are
          optional and their absence isn't ambiguous. */}
      {metricBits.length > 0 && (
        <span className="text-fg-muted truncate" title={metricBits.join(' · ')}>
          {metricBits.join(' · ')}
        </span>
      )}

      {/* Model badge (kept — it's useful for the active terminal). */}
      {model && (
        <button
          onClick={onModelClick}
          aria-label={`Model: ${MODEL_NAMES[model]} · click to change`}
          title={`Model: ${MODEL_NAMES[model]} · click to change`}
          className="flex items-center gap-1 h-6 px-2 rounded flex-shrink-0 text-fg-muted bg-raised hover:bg-overlay hover:text-fg-primary transition-colors duration-[80ms] text-[11px] font-[550]"
          style={{ cursor: 'pointer' }}
        >
          <span>{MODEL_NAMES[model]}</span>
          <ChevronDown size={10} className="opacity-60" aria-hidden />
        </button>
      )}
    </div>
  )
}
