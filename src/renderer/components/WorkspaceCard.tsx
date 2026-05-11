import React, { useState, useCallback, useEffect } from 'react'
import { ChevronDown, ChevronRight, ArrowUpRight, MoreHorizontal } from 'lucide-react'
import type { RendererWorkspace, PaneStatus, TerminalSnapshot, ActivePaneSummary } from '../../shared/types'
import { resolvePaneDisplayName } from '../../shared/pane-display'
import { formatTimeAgo } from '../lib/formatTimeAgo'
import { formatStatusLabel } from './StatusOverlay'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusDotColor(status: PaneStatus): string {
  switch (status) {
    case 'working': return 'var(--color-accent)'
    case 'changes-ready': return 'var(--color-success-fg, #4ade80)'
    case 'plan-ready': return 'var(--color-success-fg, #4ade80)'
    case 'planning': return 'var(--color-accent)'
    case 'needs-input': return 'var(--color-warning-fg, #f59e0b)'
    case 'awaiting-prompt':
    default: return 'var(--color-fg-muted)'
  }
}

function workspaceBranchLabel(w: RendererWorkspace): string {
  if (w.type === 'worktree-branch' && w.constraint.branchName) {
    return `branch: ${w.constraint.branchName}`
  }
  return 'main'
}

function workspaceRepoLabel(w: RendererWorkspace): string {
  if (w.constraint.repoPath) {
    const parts = w.constraint.repoPath.split('/')
    return parts[parts.length - 1] || parts[parts.length - 2] || w.name
  }
  return w.name
}

function activePaneDisplayName(p: ActivePaneSummary): string {
  return resolvePaneDisplayName({
    worktreeName: p.worktreeName,
    userName: p.userName,
    metrics: { sessionTitle: p.sessionTitle }
  })
}

function dormantTerminalDisplayName(t: TerminalSnapshot): string {
  return resolvePaneDisplayName({
    worktreeName: t.worktreeName,
    userName: t.userName,
    metrics: { sessionTitle: t.sessionTitle }
  })
}

// ---------------------------------------------------------------------------
// Overflow menu (inline dropdown for archive / unarchive / delete)
// ---------------------------------------------------------------------------

interface OverflowMenuProps {
  isArchived: boolean
  canArchive: boolean
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}

function OverflowMenu({ isArchived, canArchive, onArchive, onUnarchive, onDelete }: OverflowMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="p-1 rounded hover:bg-overlay text-fg-muted hover:text-fg-primary transition-colors duration-[80ms]"
        aria-label="More actions"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-overlay" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-popover bg-raised border border-[var(--color-border-subtle)] rounded-md shadow-md min-w-[140px] py-1">
            {isArchived ? (
              <>
                <button
                  type="button"
                  onClick={() => { setOpen(false); onUnarchive() }}
                  className="w-full text-left px-3 py-1.5 text-sm text-fg-secondary hover:bg-overlay hover:text-fg-primary transition-colors duration-[80ms]"
                >
                  Unarchive
                </button>
                <button
                  type="button"
                  onClick={() => { setOpen(false); onDelete() }}
                  className="w-full text-left px-3 py-1.5 text-sm text-danger-fg hover:bg-danger-subtle-bg transition-colors duration-[80ms]"
                >
                  Delete permanently
                </button>
              </>
            ) : (
              canArchive && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); onArchive() }}
                  className="w-full text-left px-3 py-1.5 text-sm text-fg-secondary hover:bg-overlay hover:text-fg-primary transition-colors duration-[80ms]"
                >
                  Archive workspace
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WorkspaceCard
// ---------------------------------------------------------------------------

export interface WorkspaceCardProps {
  workspace: RendererWorkspace
  /** 'open' = active, 'closed' = dormant, 'archived' */
  group: 'open' | 'closed' | 'archived'
  /** Open or focus the workspace window. */
  onJumpToWorkspace: () => void
  /** Open the workspace window with a specific agent's terminal in focus. */
  onJumpToAgent: (paneId: string) => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}

export function WorkspaceCard({
  workspace,
  group,
  onJumpToWorkspace,
  onJumpToAgent,
  onArchive,
  onUnarchive,
  onDelete
}: WorkspaceCardProps): React.JSX.Element {
  const t = useStrings()
  const [expanded, setExpanded] = useState(false)
  const isOpen = group === 'open'
  const isArchived = group === 'archived'

  const toggle = useCallback(() => setExpanded((v) => !v), [])

  const repoLabel = workspaceRepoLabel(workspace)
  const branchLabel = workspaceBranchLabel(workspace)
  const agentCount = isOpen ? workspace.activePaneCount : workspace.pausedTerminals.length

  return (
    <div className="border-b border-[var(--color-border-subtle)] last:border-b-0">
      {/* Collapsed row */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
        className="group relative flex items-center gap-2 pl-3 pr-2 cursor-pointer select-none hover:bg-overlay transition-colors duration-[80ms] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        style={{ height: 40 }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggle() }}
          className="text-fg-muted hover:text-fg-primary transition-colors duration-[80ms]"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="w-1.5 h-1.5 flex-shrink-0">
          {isOpen && <div className="w-full h-full rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />}
        </div>

        <div className="flex-1 min-w-0 flex items-baseline gap-1.5 truncate">
          <span className={`text-[13px] font-[500] truncate ${isArchived ? 'text-fg-muted' : 'text-fg-primary'}`}>
            {repoLabel}
          </span>
          <span className={`text-[12px] ${isArchived ? 'text-fg-muted' : 'text-fg-secondary'} truncate`}>
            {branchLabel}
          </span>
        </div>

        <span className="text-[11px] font-[500] text-fg-muted tabular-nums flex-shrink-0">
          {agentCount}
        </span>

        <OverflowMenu
          isArchived={isArchived}
          canArchive={!isArchived}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDelete={onDelete}
        />

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onJumpToWorkspace() }}
          className="p-1 rounded hover:bg-raised text-fg-muted hover:text-fg-primary transition-colors duration-[80ms]"
          aria-label={isOpen ? 'Open workspace window' : 'Activate and open workspace'}
        >
          <ArrowUpRight size={14} />
        </button>
      </div>

      {/* Expanded agent rows */}
      {expanded && (
        <div className="bg-[var(--color-bg-sunken)] py-1">
          {isOpen && workspace.activePanes.length > 0 && workspace.activePanes.map((p) => {
            const statusText = formatStatusLabel(p.status, p.activeToolName, false, false, t)
            const age = p.lastActiveAt > 0 ? formatTimeAgo(p.lastActiveAt) : ''
            return (
              <div
                key={p.paneId}
                className="flex items-center gap-2 pl-10 pr-2 py-1.5 hover:bg-overlay transition-colors duration-[80ms]"
              >
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: statusDotColor(p.status) }}
                />
                <span className="flex-1 text-[12px] text-fg-primary truncate">
                  {activePaneDisplayName(p)}
                </span>
                <span className="text-[11px] text-fg-muted flex-shrink-0 truncate max-w-[100px]">
                  {statusText}
                </span>
                <span className="text-[11px] text-fg-subtle tabular-nums flex-shrink-0">
                  {age}
                </span>
                <button
                  type="button"
                  onClick={() => onJumpToAgent(p.paneId)}
                  className="p-1 rounded hover:bg-raised text-fg-muted hover:text-fg-primary transition-colors duration-[80ms]"
                  aria-label={`Jump to ${activePaneDisplayName(p)}`}
                >
                  <ArrowUpRight size={12} />
                </button>
              </div>
            )
          })}

          {!isOpen && workspace.pausedTerminals.length > 0 && workspace.pausedTerminals.map((s) => (
            <div
              key={s.paneId}
              className="flex items-center gap-2 pl-10 pr-2 py-1.5 opacity-60"
            >
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-fg-muted" />
              <span className="flex-1 text-[12px] text-fg-secondary truncate">
                {dormantTerminalDisplayName(s)}
              </span>
              <span className="text-[11px] text-fg-subtle tabular-nums flex-shrink-0">
                {formatTimeAgo(s.snapshotAt)}
              </span>
            </div>
          ))}

          {((isOpen && workspace.activePanes.length === 0) || (!isOpen && workspace.pausedTerminals.length === 0)) && (
            <div className="pl-10 pr-2 py-1.5 text-[12px] text-fg-muted italic">
              No agents.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
