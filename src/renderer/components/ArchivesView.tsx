import React, { useCallback, useEffect, useState } from 'react'
import { useManagerState } from '../hooks/useManagerState'
import { PermanentDeleteWorkspaceConfirmModal } from './PermanentDeleteWorkspaceConfirmModal'
import type { RendererWorkspace } from '../../shared/types'
import { formatTimeAgo } from '../lib/formatTimeAgo'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// ArchivesView — full-panel view listing archived workspaces
// ---------------------------------------------------------------------------

interface ArchivesViewProps {
  onClose: () => void
}

// Labels resolved at render time via useStrings.

/**
 * ArchivesView — full-panel view shown when the user opens "View Archives"
 * from the manager window. Lists every archived workspace with two inline
 * actions per row:
 *
 *  - Restore: moves the workspace back to the dormant list (single click).
 *  - Delete Permanently: opens a destructive confirmation modal.
 *
 * Escape key closes the view (returns to the main manager content).
 */
export function ArchivesView({ onClose }: ArchivesViewProps): React.JSX.Element {
  const t = useStrings()
  const WORKSPACE_TYPE_LABELS: Record<string, string> = {
    general: t.archivesView.typeGeneral,
    repo: t.archivesView.typeRepo,
    'worktree-branch': t.archivesView.typeWorktree
  }
  const { archivedWorkspaces: rawArchivedWorkspaces, unarchiveWorkspace, deleteArchivedWorkspace } = useManagerState()
  const [deleteConfirmWorkspace, setDeleteConfirmWorkspace] = useState<RendererWorkspace | null>(null)

  // Most recent activity on top
  const archivedWorkspaces = React.useMemo(
    () => [...rawArchivedWorkspaces].sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [rawArchivedWorkspaces]
  )

  // Escape closes the view (only when no modal is open — modal owns Escape)
  useEffect(() => {
    if (deleteConfirmWorkspace) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, deleteConfirmWorkspace])

  const handleRestore = useCallback((workspaceId: string) => {
    unarchiveWorkspace(workspaceId)
  }, [unarchiveWorkspace])

  const handleDelete = useCallback(() => {
    if (!deleteConfirmWorkspace) return
    deleteArchivedWorkspace(deleteConfirmWorkspace.id)
    setDeleteConfirmWorkspace(null)
  }, [deleteConfirmWorkspace, deleteArchivedWorkspace])

  return (
    <div
      className="flex-1 min-h-0 flex flex-col"
      style={{ background: 'var(--color-bg-canvas)', padding: 16, overflow: 'auto' }}
    >
      {/* Title row with Back button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8
        }}
      >
        <div style={{ color: 'var(--color-fg-subtle)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {'── '}
          <span style={{ color: 'var(--color-accent)' }}>{t.archivesView.title}</span>
          {' ─────────────────────────────────────────────────'}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-accent)',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 12,
            padding: '2px 6px'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-fg-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-accent)' }}
          aria-label={t.archivesView.backAria}
        >
          {t.archivesView.backLabel}
        </button>
      </div>

      {/* Shortcuts bar */}
      <div style={{ color: 'var(--color-fg-subtle)', marginBottom: 16, flexShrink: 0 }}>
        <span style={{ color: 'var(--color-fg-muted)' }}>[Esc]</span> {t.archivesView.escHint}
      </div>

      {/* Empty state */}
      {archivedWorkspaces.length === 0 ? (
        <div style={{ color: 'var(--color-fg-muted)', padding: '24px 0' }}>
          {t.archivesView.empty}
        </div>
      ) : (
        <div>
          {archivedWorkspaces.map((workspace) => {
            const typeLabel = WORKSPACE_TYPE_LABELS[workspace.type] || workspace.type
            const constraintLabel = workspace.type === 'repo' && workspace.constraint.repoPath
              ? workspace.constraint.repoPath.split('/').pop()
              : workspace.type === 'worktree-branch' && workspace.constraint.branchName
                ? `${workspace.constraint.repoPath?.split('/').pop()}/${workspace.constraint.branchName}`
                : null
            const terminalCount = workspace.pausedTerminals.length

            return (
              <div
                key={workspace.id}
                style={{
                  padding: '8px 0',
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-raised)' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <span style={{ color: 'var(--color-fg-muted)', flexShrink: 0, paddingTop: 1 }}>·</span>
                {/* Workspace details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--color-fg-primary)' }}>{workspace.name}</span>
                    <span style={{ color: 'var(--color-fg-subtle)', fontSize: '0.9em' }}>
                      [{typeLabel}{constraintLabel ? `: ${constraintLabel}` : ''}]
                    </span>
                  </div>
                  <div style={{ color: 'var(--color-fg-subtle)', marginTop: 2, fontSize: '0.9em' }}>
                    {t.archivesView.dormantPanesFmt(terminalCount)}
                    <span style={{ marginLeft: 8 }}>{t.archivesView.archivedAtPrefix}{formatTimeAgo(workspace.lastActiveAt)}</span>
                  </div>
                </div>

                {/* Inline actions */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleRestore(workspace.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-accent)',
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: 12,
                      padding: '2px 6px'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-fg-primary)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-accent)' }}
                    aria-label={t.archivesView.restoreAria(workspace.name)}
                  >
                    {t.archivesView.restoreButton}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmWorkspace(workspace)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-danger-fg)',
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: 12,
                      padding: '2px 6px'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-fg-primary)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-danger-fg)' }}
                    aria-label={t.archivesView.deleteAria(workspace.name)}
                  >
                    {t.archivesView.deleteButton}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Permanent delete confirmation modal */}
      {deleteConfirmWorkspace && (
        <PermanentDeleteWorkspaceConfirmModal
          workspaceName={deleteConfirmWorkspace.name}
          pausedTerminalCount={deleteConfirmWorkspace.pausedTerminals.length}
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmWorkspace(null)}
        />
      )}
    </div>
  )
}
