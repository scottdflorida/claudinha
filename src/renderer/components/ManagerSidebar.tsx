import React, { useCallback, useRef, useState } from 'react'
import {
  Search,
  ChevronDown,
  ChevronRight,
  TreePine,
  Sprout,
  Lock,
  Settings
} from 'lucide-react'
import type { RendererWorkspace } from '../../shared/types'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManagerSidebarProps {
  activeWorkspaces: RendererWorkspace[]
  dormantWorkspaces: RendererWorkspace[]
  archivedWorkspaces: RendererWorkspace[]
  selectedId: string | null
  onSelect: (id: string) => void
  searchRef?: React.RefObject<HTMLInputElement>
}

// ---------------------------------------------------------------------------
// Workspace row
// ---------------------------------------------------------------------------

interface WorkspaceRowProps {
  workspace: RendererWorkspace
  isActive: boolean
  isDormant: boolean
  isArchived: boolean
  isSelected: boolean
  onClick: () => void
}

function WorkspaceRow({ workspace, isActive, isDormant, isArchived, isSelected, onClick }: WorkspaceRowProps): React.JSX.Element {
  const paneCount = isActive ? workspace.activePaneCount : workspace.pausedTerminals.length

  const labelClass = isArchived
    ? 'font-[450] text-fg-muted'
    : isActive
      ? 'font-[500] text-fg-primary'
      : isDormant
        ? 'font-[450] text-fg-secondary'
        : 'font-[450] text-fg-secondary'

  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className={`group relative flex items-center gap-2 pl-6 pr-3 cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]
        ${isSelected ? 'bg-raised' : 'hover:bg-overlay'}
      `}
      style={{ height: 36 }}
    >
      {/* Leading 2px rail — accent when selected, accent-subtle on hover */}
      <div
        className={`absolute left-0 top-0 bottom-0 ${isSelected ? 'bg-accent' : 'bg-transparent group-hover:bg-accent-subtle'}`}
        style={{ width: 2 }}
      />

      {/* Status dot slot — reserved for all rows to keep name left-edge aligned across groups */}
      <div className="w-1.5 h-1.5 flex-shrink-0">
        {isActive && (
          <div className="w-full h-full rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />
        )}
      </div>

      {/* Name */}
      <span className={`flex-1 text-[13px] truncate ${labelClass} ${!isSelected ? 'group-hover:text-fg-primary' : ''}`}>
        {workspace.name}
      </span>

      {/* Pane count */}
      <span className="flex items-center gap-0.5 text-[11px] font-[500] text-fg-muted tabular-nums flex-shrink-0">
        <TreePine size={12} className="text-fg-muted" />
        <span>{paneCount}</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Group header
// ---------------------------------------------------------------------------

interface GroupHeaderProps {
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
}

function GroupHeader({ label, count, expanded, onToggle }: GroupHeaderProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-3 cursor-pointer select-none hover:bg-overlay transition-colors duration-[80ms]"
      style={{ height: 24 }}
    >
      <span className="text-[11px] font-[550] uppercase tracking-[0.06em] text-fg-muted flex-1 text-left">
        {label}
      </span>
      <span className="text-[11px] font-[450] tabular-nums text-fg-subtle mr-1">{count}</span>
      {expanded
        ? <ChevronDown size={12} className="text-fg-subtle flex-shrink-0" />
        : <ChevronRight size={12} className="text-fg-subtle flex-shrink-0" />
      }
    </button>
  )
}

// ---------------------------------------------------------------------------
// ManagerSidebar
// ---------------------------------------------------------------------------

export function ManagerSidebar({
  activeWorkspaces,
  dormantWorkspaces,
  archivedWorkspaces,
  selectedId,
  onSelect,
  searchRef: externalSearchRef
}: ManagerSidebarProps): React.JSX.Element {
  const t = useStrings()
  const [search, setSearch] = useState('')
  const [activeExpanded, setActiveExpanded] = useState(true)
  const [dormantExpanded, setDormantExpanded] = useState(false)
  const [archivedExpanded, setArchivedExpanded] = useState(false)

  const internalSearchRef = useRef<HTMLInputElement>(null)
  const searchInputRef = externalSearchRef ?? internalSearchRef

  const [sidebarWidth, setSidebarWidth] = useState(272)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(272)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const delta = ev.clientX - dragStartX.current
      const newWidth = Math.max(200, Math.min(480, dragStartWidth.current + delta))
      setSidebarWidth(newWidth)
    }

    const onUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  // Filter function
  const matchesSearch = useCallback((workspace: RendererWorkspace): boolean => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      workspace.name.toLowerCase().includes(q) ||
      (workspace.constraint.repoPath?.toLowerCase().includes(q) ?? false) ||
      (workspace.constraint.branchName?.toLowerCase().includes(q) ?? false)
    )
  }, [search])

  const filteredActive = activeWorkspaces.filter(matchesSearch)
  const filteredDormant = dormantWorkspaces.filter(matchesSearch)
  const filteredArchived = archivedWorkspaces.filter(matchesSearch)

  const handleClearSearch = () => {
    setSearch('')
    searchInputRef.current?.focus()
  }

  return (
    <div
      className="relative flex flex-col shrink-0 bg-surface border-r border-[var(--color-border-strong)]"
      style={{ width: sidebarWidth, boxShadow: '3px 0 10px rgba(0,0,0,0.35)' }}
    >
      {/* Zone 1: Search */}
      <div className="shrink-0 px-2 py-2">
        <div className="relative flex items-center h-8 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-2 gap-1.5 focus-within:border-[var(--color-border-strong)] focus-within:ring-2 focus-within:ring-[var(--color-focus-ring)] transition-colors duration-[80ms]">
          <Search size={14} className="text-fg-muted flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.managerSidebar.searchPlaceholder}
            aria-label={t.managerSidebar.searchAriaLabel}
            className="flex-1 bg-transparent text-sm text-fg-primary placeholder-fg-muted outline-none min-w-0"
          />
          {search && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="flex-shrink-0 text-fg-muted hover:text-fg-primary transition-colors duration-[80ms]"
              tabIndex={-1}
              aria-label={t.managerSidebar.clearSearch}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Zone 2: Nav groups (scrollable) */}
      <div role="listbox" aria-label={t.managerSidebar.workspacesListLabel} className="flex-1 min-h-0 overflow-y-auto">
        {/* Active Workspaces */}
        <div className="pt-1">
          <GroupHeader
            label={t.managerSidebar.groupActive}
            count={filteredActive.length}
            expanded={activeExpanded}
            onToggle={() => setActiveExpanded((v) => !v)}
          />
          {activeExpanded && filteredActive.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              isActive={true}
              isDormant={false}
              isArchived={false}
              isSelected={selectedId === workspace.id}
              onClick={() => onSelect(workspace.id)}
            />
          ))}
          {activeExpanded && filteredActive.length === 0 && search && (
            <div className="px-3 py-1 text-xs text-fg-muted italic">{t.managerSidebar.noMatches}</div>
          )}
        </div>

        {/* Dormant */}
        <div className="pt-3">
          <GroupHeader
            label={t.managerSidebar.groupDormant}
            count={filteredDormant.length}
            expanded={dormantExpanded}
            onToggle={() => setDormantExpanded((v) => !v)}
          />
          {dormantExpanded && filteredDormant.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              isActive={false}
              isDormant={true}
              isArchived={false}
              isSelected={selectedId === workspace.id}
              onClick={() => onSelect(workspace.id)}
            />
          ))}
          {dormantExpanded && filteredDormant.length === 0 && search && (
            <div className="px-3 py-1 text-xs text-fg-muted italic">{t.managerSidebar.noMatches}</div>
          )}
        </div>

        {/* Archived */}
        <div className="pt-3">
          <GroupHeader
            label={t.managerSidebar.groupArchived}
            count={filteredArchived.length}
            expanded={archivedExpanded}
            onToggle={() => setArchivedExpanded((v) => !v)}
          />
          {archivedExpanded && filteredArchived.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              isActive={false}
              isDormant={false}
              isArchived={true}
              isSelected={selectedId === workspace.id}
              onClick={() => onSelect(workspace.id)}
            />
          ))}
          {archivedExpanded && filteredArchived.length === 0 && search && (
            <div className="px-3 py-1 text-xs text-fg-muted italic">{t.managerSidebar.noMatches}</div>
          )}
        </div>
      </div>

      {/* Zone 3: New workspace */}
      <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
        <button
          type="button"
          onClick={() => onSelect('home')}
          className={`w-full flex items-center gap-2 px-3 cursor-pointer select-none transition-colors duration-[80ms]
            ${selectedId === 'home'
              ? 'bg-[color-mix(in_oklch,var(--color-accent)_18%,transparent)]'
              : 'hover:bg-[color-mix(in_oklch,var(--color-accent)_12%,transparent)]'}
          `}
          style={{ height: 36 }}
        >
          <Sprout size={16} className="text-accent flex-shrink-0" />
          <span className="flex-1 text-[13px] font-[550] text-fg-primary text-left">{t.managerSidebar.newWorkspace}</span>
        </button>
      </div>

      {/* Zone 4: Tertiary nav */}
      <div className="shrink-0 border-t border-[var(--color-border-subtle)] py-1">
        {/* Permissions */}
        <button
          type="button"
          onClick={() => onSelect('permissions')}
          className={`group w-full flex items-center gap-2 px-3 cursor-pointer select-none hover:bg-overlay transition-colors duration-[80ms] relative
            ${selectedId === 'permissions' ? 'bg-raised' : ''}
          `}
          style={{ height: 28 }}
        >
          {selectedId === 'permissions' && (
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent" />
          )}
          <Lock size={14} className="text-fg-muted flex-shrink-0" />
          <span className={`text-[13px] text-left ${selectedId === 'permissions' ? 'font-[500] text-fg-primary' : 'font-[450] text-fg-secondary group-hover:text-fg-primary'}`}>
            {t.managerSidebar.navPermissions}
          </span>
        </button>

        {/* Configuration */}
        <button
          type="button"
          onClick={() => onSelect('config')}
          className={`group w-full flex items-center gap-2 px-3 cursor-pointer select-none hover:bg-overlay transition-colors duration-[80ms] relative
            ${selectedId === 'config' ? 'bg-raised' : ''}
          `}
          style={{ height: 28 }}
        >
          {selectedId === 'config' && (
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent" />
          )}
          <Settings size={14} className="text-fg-muted flex-shrink-0" />
          <span className={`text-[13px] text-left ${selectedId === 'config' ? 'font-[500] text-fg-primary' : 'font-[450] text-fg-secondary group-hover:text-fg-primary'}`}>
            {t.managerSidebar.navConfiguration}
          </span>
        </button>
      </div>

      {/* Resize handle — 4px hit target on trailing edge */}
      <div
        className="absolute right-0 top-0 bottom-0 cursor-col-resize hover:bg-[var(--color-border-strong)] transition-colors duration-[80ms]"
        style={{ width: 4 }}
        onMouseDown={handleDragStart}
      />
    </div>
  )
}
