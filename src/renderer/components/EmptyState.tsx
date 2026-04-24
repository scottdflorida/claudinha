import React from 'react'
import type { WorkspaceType } from '../../shared/types'
import { BrandMark } from './ui/BrandMark'
import { useStrings } from '../lib/strings'

interface EmptyStateProps {
  onSpawnClick: () => void
  onShowManager: () => void
  workspaceName?: string
  workspaceType?: WorkspaceType
}

/**
 * EmptyState — shown inside a workspace window when no terminals are open.
 *
 * Follows design-system §10.18: BrandMark at 56px, title in text-lg +
 * font-[600], muted subtitle with a kbd hint, a secondary back-link
 * beneath. Whole surface is a large click target that spawns the first
 * terminal (workspace-level keyboard shortcut).
 */
export function EmptyState({ onSpawnClick, onShowManager, workspaceName, workspaceType }: EmptyStateProps): React.JSX.Element {
  const t = useStrings()
  const title = (workspaceType === 'repo' || workspaceType === 'worktree-branch') && workspaceName
    ? t.emptyState.workspaceBareNamed(workspaceName)
    : t.emptyState.workspaceBareUnnamed

  const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
  const shortcut = isMac ? '⌘⇧N' : 'Ctrl+Shift+N'
  const managerShortcut = isMac ? '⌘⇧P' : 'Ctrl+Shift+P'

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center select-none bg-canvas"
      onClick={onSpawnClick}
      style={{ cursor: 'default' }}
    >
      <BrandMark size={56} className="mb-5" />

      <div className="text-lg font-[600] text-fg-primary mb-2">
        {title}
      </div>

      <div className="text-sm text-fg-muted mb-1">
        {t.emptyState.pressLabel}{' '}
        <span className="text-fg-secondary font-[500]">{shortcut}</span>
        {t.emptyState.pressToOpenSuffix}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onShowManager()
        }}
        className="mt-4 text-xs text-fg-muted hover:text-fg-primary transition-colors bg-transparent border-0 p-0 cursor-pointer"
        aria-label={t.emptyState.backToClaudinha}
      >
        {t.emptyState.backToClaudinhaArrow}
        <span className="text-fg-subtle">{managerShortcut}</span>
      </button>
    </div>
  )
}
