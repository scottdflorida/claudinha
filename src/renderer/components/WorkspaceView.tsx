import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { RendererWorkspace, TerminalSnapshot, ActivePaneSummary, PaneStatus } from '../../shared/types'
import { Button } from './ui/Button'
import { formatTimeAgo } from '../lib/formatTimeAgo'
import { useStrings } from '../lib/strings'
import { resolvePaneDisplayName } from '../../shared/pane-display'
import { formatStatusLabel } from './StatusOverlay'

// Adapter for resolvePaneDisplayName so dormant snapshots reuse the kanban's
// fallback chain (userName → sessionTitle → worktreeName) without each card
// site reimplementing the precedence.
function dormantTerminalDisplayName(t: TerminalSnapshot): string {
  return resolvePaneDisplayName({
    worktreeName: t.worktreeName,
    userName: t.userName,
    metrics: { sessionTitle: t.sessionTitle }
  })
}

function activePaneDisplayName(p: ActivePaneSummary): string {
  return resolvePaneDisplayName({
    worktreeName: p.worktreeName,
    userName: p.userName,
    metrics: { sessionTitle: p.sessionTitle }
  })
}

// Single CSS-var color per status, sized to the existing 8px dot. Mirrors the
// minimum-information chrome the workspace window uses (full StatusOverlay is
// overkill for this management-card surface).
function statusDotColor(status: PaneStatus): string {
  switch (status) {
    case 'working': return 'var(--color-accent)'
    case 'done': return 'var(--color-success-fg, #4ade80)'
    case 'needs-input': return 'var(--color-warning-fg, #f59e0b)'
    case 'error': return 'var(--color-danger-fg, #ef4444)'
    case 'awaiting-prompt':
    default: return 'var(--color-fg-muted)'
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkspaceDetailViewProps {
  workspace: RendererWorkspace
  isActive: boolean
  isDormant: boolean
  isArchived: boolean
  onOpenGrove: () => void
  onArchive: () => void
  onDelete: () => void
  onUnarchive: () => void
}

// ---------------------------------------------------------------------------
// Overflow menu (inline dropdown for archive/delete)
// ---------------------------------------------------------------------------

interface OverflowMenuProps {
  isArchived: boolean
  onArchive: () => void
  onDelete: () => void
}

function OverflowMenu({ isArchived, onArchive, onDelete }: OverflowMenuProps): React.JSX.Element {
  const t = useStrings()
  const [open, setOpen] = useState(false)

  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.workspaceView.moreActions}
      >
        ⋯
      </Button>
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-overlay"
            onClick={() => setOpen(false)}
          />
          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-1 z-popover bg-raised border border-[var(--color-border-subtle)] rounded-md shadow-md min-w-[140px] py-1">
            {!isArchived ? (
              <button
                type="button"
                onClick={() => { setOpen(false); onArchive() }}
                className="w-full text-left px-3 py-1.5 text-sm text-fg-secondary hover:bg-overlay hover:text-fg-primary transition-colors duration-[80ms]"
              >
                {t.workspaceView.archiveWorkspace}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setOpen(false); onDelete() }}
                className="w-full text-left px-3 py-1.5 text-sm text-danger-fg hover:bg-danger-subtle-bg transition-colors duration-[80ms]"
              >
                {t.workspaceView.deletePermanently}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WorkspaceView
// ---------------------------------------------------------------------------

export function WorkspaceView({
  workspace,
  isActive,
  isDormant,
  isArchived,
  onOpenGrove,
  onArchive,
  onDelete,
  onUnarchive
}: WorkspaceDetailViewProps): React.JSX.Element {
  const t = useStrings()
  const [dormantExpanded, setDormantExpanded] = useState(false)

  const repoPath = workspace.constraint.repoPath ?? workspace.constraint.worktreePath ?? '—'
  const paneCount = isActive ? workspace.activePaneCount : workspace.pausedTerminals.length

  return (
    <div className="flex-1 min-h-0 overflow-y-auto w-full">
      <div className="max-w-[720px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-[var(--color-border-subtle)]">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-[600] text-fg-primary truncate">{workspace.name}</h2>
          <p className="text-xs text-fg-muted mt-1 truncate" title={repoPath}>{repoPath}</p>
          <p className="text-sm text-fg-secondary mt-1">
            {t.workspaceView.paneCountLabel(paneCount)}
          </p>
        </div>

        {/* Action cluster */}
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          {isArchived ? (
            <Button variant="secondary" size="sm" onClick={onUnarchive}>{t.workspaceView.unarchive}</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={onOpenGrove}>
              {t.workspaceView.openWorkspace}
            </Button>
          )}
          <OverflowMenu
            isArchived={isArchived}
            onArchive={onArchive}
            onDelete={onDelete}
          />
        </div>
      </div>

      {/* Panes section */}
      <div className="mt-4">
        <h3 className="text-xs font-[600] uppercase tracking-wide text-fg-muted mb-2">{t.workspaceView.panesHeading}</h3>

        {isActive && workspace.activePanes.length > 0 ? (
          <div className="flex flex-col gap-2">
            {workspace.activePanes.map((pane) => {
              const label = `${pane.repoName}/${activePaneDisplayName(pane)}`
              const statusText = formatStatusLabel(pane.status, pane.activeToolName, false, false, t)
              const prompt = pane.initialPrompt?.trim()
              return (
                <div
                  key={pane.paneId}
                  className="bg-surface rounded-md border border-[var(--color-border-subtle)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: statusDotColor(pane.status) }}
                    />
                    <span className="flex-1 text-sm font-[500] text-fg-primary truncate">{label}</span>
                    <span className="text-xs text-fg-muted flex-shrink-0">{statusText}</span>
                    <Button variant="ghost" size="sm" onClick={onOpenGrove}>{t.workspaceView.open}</Button>
                  </div>
                  {prompt && (
                    <div className="mt-1 text-xs truncate">
                      <span className="text-fg-muted">{t.workspaceView.startingPrompt}: </span>
                      <span className="text-fg-secondary">{prompt}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : !isActive && paneCount === 0 ? (
          <p className="text-sm text-fg-muted">{t.workspaceView.noPanes}</p>
        ) : null}

        {/* Dormant workspace — dormant panes listed as primary content */}
        {(isDormant || isArchived) && workspace.pausedTerminals.length > 0 && (
          <div className="flex flex-col gap-1">
            {workspace.pausedTerminals.map((terminal) => {
              const label = `${terminal.repoName}/${dormantTerminalDisplayName(terminal)}`
              const prompt = terminal.initialPrompt?.trim()
              return (
                <div
                  key={terminal.paneId}
                  className="bg-surface rounded-md border border-[var(--color-border-subtle)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-[500] text-fg-secondary truncate">{label}</span>
                    <span className="text-xs text-fg-muted flex-shrink-0">{formatTimeAgo(terminal.snapshotAt)}</span>
                  </div>
                  {prompt && (
                    <div className="mt-1 text-xs truncate">
                      <span className="text-fg-muted">{t.workspaceView.startingPrompt}: </span>
                      <span className="text-fg-secondary">{prompt}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Dormant panes sub-section (when active workspace has dormant panes) */}
      {isActive && workspace.pausedTerminals.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setDormantExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-[600] uppercase tracking-wide text-fg-muted mb-2 cursor-pointer hover:text-fg-secondary transition-colors duration-[80ms]"
          >
            {dormantExpanded
              ? <ChevronDown size={12} />
              : <ChevronRight size={12} />
            }
            {t.workspaceView.dormantPanesHeading(workspace.pausedTerminals.length)}
          </button>
          {dormantExpanded && (
            <div className="flex flex-col">
              {workspace.pausedTerminals.map((terminal) => {
                const label = `${terminal.repoName}/${dormantTerminalDisplayName(terminal)}`
                return (
                  <div
                    key={terminal.paneId}
                    className="flex items-center gap-3 py-2 px-3 rounded"
                  >
                    <span className="flex-1 text-sm text-fg-secondary truncate">{label}</span>
                    <span className="text-xs text-fg-muted flex-shrink-0">{formatTimeAgo(terminal.snapshotAt)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Destructive footer */}
      <div className="mt-8 pt-4 border-t border-[var(--color-border-subtle)] flex gap-2">
        {isArchived ? (
          <Button variant="secondary" size="sm" destructive onClick={onDelete}>
            {t.workspaceView.deletePermanently}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" destructive onClick={onArchive}>
            {t.workspaceView.archiveWorkspace}
          </Button>
        )}
      </div>
      </div>
    </div>
  )
}
