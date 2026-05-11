import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { useManagerState } from '../hooks/useManagerState'
import { ClaudeCheckModal } from './ClaudeCheckModal'
import { PermissionsManagerView } from './PermissionsManagerView'
import { ConfigurationView } from './ConfigurationView'
import { ArchiveWorkspaceConfirmModal } from './ArchiveWorkspaceConfirmModal'
import { PermanentDeleteWorkspaceConfirmModal } from './PermanentDeleteWorkspaceConfirmModal'
import { ManagerSidebar } from './ManagerSidebar'
import { HomeView } from './HomeView'
import { LanguageFlagToggle } from './LanguageFlagToggle'
import { useStrings } from '../lib/strings'
import { openFeedbackUrl } from '../lib/open-feedback'
import type { RendererWorkspace } from '../../shared/types'

// ---------------------------------------------------------------------------
// ManagerWindow
// ---------------------------------------------------------------------------

interface ManagerWindowProps {
  claudeFound: boolean
}

/**
 * ManagerWindow — the Claudinha Manager hub UI.
 *
 * New design: sidebar workspace + focused detail layout (Linear-inspired).
 * - Sidebar: search, collapsible workspace groups, launcher, tertiary nav.
 * - Main area: swaps between WelcomeView, WorkspaceView, HomeView,
 *   PermissionsManagerView, or ConfigurationView based on sidebar selection.
 */
export function ManagerWindow({ claudeFound }: ManagerWindowProps): React.JSX.Element {
  const t = useStrings()
  const {
    activeWorkspaces: rawActiveHives,
    dormantWorkspaces: rawDormantHives,
    archivedWorkspaces,
    nextWorkspaceNumber,
    focusWorkspace,
    focusTerminal,
    activateWorkspace,
    archiveWorkspace,
    unarchiveWorkspace,
    deleteArchivedWorkspace
  } = useManagerState()

  const [claudeResolved, setClaudeResolved] = useState(claudeFound)
  const [selectedId, setSelectedId] = useState<string | null>('home')
  const [archiveConfirmWorkspace, setArchiveConfirmWorkspace] = useState<RendererWorkspace | null>(null)
  const [permanentDeleteWorkspace, setPermanentDeleteWorkspace] = useState<RendererWorkspace | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Most recent activity on top
  const activeWorkspaces = React.useMemo(
    () => [...rawActiveHives].sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [rawActiveHives]
  )
  const dormantWorkspaces = React.useMemo(
    () => [...rawDormantHives].sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [rawDormantHives]
  )

  const handleFeedback = useCallback(() => {
    void openFeedbackUrl()
  }, [])

  const handleArchiveConfirm = useCallback(() => {
    if (!archiveConfirmWorkspace) return
    archiveWorkspace(archiveConfirmWorkspace.id)
    // If the archived workspace was selected, fall back to Home
    if (selectedId === archiveConfirmWorkspace.id) setSelectedId('home')
    setArchiveConfirmWorkspace(null)
  }, [archiveConfirmWorkspace, archiveWorkspace, selectedId])

  const handlePermanentDeleteConfirm = useCallback(() => {
    if (!permanentDeleteWorkspace) return
    deleteArchivedWorkspace(permanentDeleteWorkspace.id)
    // If the deleted workspace was selected, fall back to Home
    if (selectedId === permanentDeleteWorkspace.id) setSelectedId('home')
    setPermanentDeleteWorkspace(null)
  }, [permanentDeleteWorkspace, deleteArchivedWorkspace, selectedId])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.startsWith('Mac')
      const meta = isMac ? e.metaKey : e.ctrlKey

      // Cmd+Shift+I / Ctrl+Shift+I — open feedback
      if (meta && e.shiftKey && e.key.toUpperCase() === 'I') {
        e.preventDefault()
        void openFeedbackUrl()
        return
      }

      // / — focus search when not typing in an input/textarea
      if (
        e.key === '/' &&
        !meta &&
        !e.shiftKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function renderMainArea(): React.JSX.Element {
    if (selectedId === 'permissions') {
      return <PermissionsManagerView onClose={() => setSelectedId('home')} />
    }
    if (selectedId === 'config') {
      return <ConfigurationView />
    }
    // Default: Launch New Workspace form. Workspaces no longer take over the
    // right pane — interactions on a card (expand, jump, overflow) are inline.
    return <HomeView onLaunched={() => setSelectedId('home')} nextWorkspaceNumber={nextWorkspaceNumber} />
  }

  const handleJumpToWorkspace = useCallback((workspaceId: string) => {
    if (activeWorkspaces.some((w) => w.id === workspaceId)) {
      focusWorkspace(workspaceId)
    } else {
      activateWorkspace(workspaceId)
    }
  }, [activeWorkspaces, focusWorkspace, activateWorkspace])

  const handleJumpToAgent = useCallback((workspaceId: string, paneId: string) => {
    if (activeWorkspaces.some((w) => w.id === workspaceId)) {
      focusTerminal(workspaceId, paneId)
    } else {
      activateWorkspace(workspaceId, [paneId])
    }
  }, [activeWorkspaces, focusTerminal, activateWorkspace])

  return (
    <div className="w-screen h-screen overflow-hidden bg-canvas flex flex-col relative">
      {!claudeResolved && (
        <ClaudeCheckModal onResolved={() => setClaudeResolved(true)} />
      )}

      {/* Titlebar */}
      <div
        className="shrink-0 relative flex items-center justify-end px-3 bg-surface border-b border-[var(--color-border-strong)]"
        style={{ height: 32, WebkitAppRegion: 'drag', boxShadow: 'var(--shadow-sm)' } as React.CSSProperties}
      >
        {/* Centered title */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[16px] font-[600] text-fg-secondary">{t.managerWindow.title}</span>
        </div>
        <button
          onClick={handleFeedback}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="relative flex items-center gap-1.5 text-fg-muted hover:text-fg-primary transition-colors duration-[80ms] px-2 py-1 rounded"
          title={t.managerWindow.submitFeedbackTooltip}
          type="button"
        >
          <span className="text-xs">{t.managerWindow.submitFeedback}</span>
          <MessageSquareText size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-row">
        <ManagerSidebar
          activeWorkspaces={activeWorkspaces}
          dormantWorkspaces={dormantWorkspaces}
          archivedWorkspaces={archivedWorkspaces}
          selectedId={selectedId}
          onSelectView={setSelectedId}
          onJumpToWorkspace={handleJumpToWorkspace}
          onJumpToAgent={handleJumpToAgent}
          onArchiveWorkspace={(w) => setArchiveConfirmWorkspace(w)}
          onUnarchiveWorkspace={(w) => unarchiveWorkspace(w.id)}
          onDeleteWorkspace={(w) => setPermanentDeleteWorkspace(w)}
          searchRef={searchInputRef}
        />
        <main className="flex-1 min-h-0 bg-canvas px-6 py-6 flex flex-col">
          {renderMainArea()}
        </main>
      </div>

      {/* Modals */}
      {archiveConfirmWorkspace && (
        <ArchiveWorkspaceConfirmModal
          workspaceName={archiveConfirmWorkspace.name}
          pausedTerminalCount={archiveConfirmWorkspace.pausedTerminals.length}
          onConfirm={handleArchiveConfirm}
          onCancel={() => setArchiveConfirmWorkspace(null)}
        />
      )}

      {permanentDeleteWorkspace && (
        <PermanentDeleteWorkspaceConfirmModal
          workspaceName={permanentDeleteWorkspace.name}
          pausedTerminalCount={permanentDeleteWorkspace.pausedTerminals.length}
          onConfirm={handlePermanentDeleteConfirm}
          onCancel={() => setPermanentDeleteWorkspace(null)}
        />
      )}

      <LanguageFlagToggle className="absolute bottom-3 right-3 z-10" />
    </div>
  )
}
