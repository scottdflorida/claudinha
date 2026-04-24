import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { CompletionActionStatus, MergeStrategy } from '../../shared/types'
import type { GhCliCheckResult } from '../../shared/ipc-channels'
import { ipcInvoke, ipcSend } from '../hooks/useIpc'
import { CompletionErrorModal } from './CompletionErrorModal'
import { useStrings } from '../lib/strings'
import {
  COMPLETION_BAR_HEIGHT_PX,
  COMPLETION_MERGE_COLOR,
  COMPLETION_PR_COLOR,
  COMPLETION_ERROR_COLOR,
  COMPLETION_CONFLICT_COLOR
} from '../lib/constants'

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const FG_MUTED = 'var(--color-fg-muted)'
const FG_DIM   = 'var(--color-fg-subtle)'
const STATUS_DONE_COLOR    = 'var(--color-status-done)'

/** Dimmed versions of merge/PR colors for unselected state */
const MERGE_COLOR_DIM = '#2D8B4E'  // dimmer green
const PR_COLOR_DIM = '#2980A8'     // dimmer blue

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompletionActionBarProps {
  paneId: string
  completionStatus: CompletionActionStatus | null
  /** Called when the user dismisses the action bar */
  onDismiss: () => void
  /** Called after a merge or PR action is submitted so the parent can refocus the terminal */
  onAction?: () => void
  /** The workspace this pane belongs to — required for "Merge all (this workspace)" option */
  workspaceId?: string | null
}

// ---------------------------------------------------------------------------
// Merge strategy labels
// ---------------------------------------------------------------------------

// Strategy values are stable IPC identifiers; labels resolved via useStrings
// at render time inside the component.
const MERGE_STRATEGY_VALUES: MergeStrategy[] = ['rebase-ff', 'squash', 'merge-commit']
const PR_DRAFT_VALUES: boolean[] = [false, true]

// ---------------------------------------------------------------------------
// DropdownMenu — terminal-style popover (opens upward, right-aligned)
// ---------------------------------------------------------------------------

interface MenuItem {
  label: string
  disabled?: boolean
  disabledTooltip?: string
  onSelect: () => void
  /** Non-interactive separator row (divider between sections). */
  separator?: boolean
}

function DropdownMenu({
  items,
  onClose,
  onSwitchMenu,
  currentMenu
}: {
  items: MenuItem[]
  onClose: () => void
  /** Called when user presses a key that should switch to another menu (M or P) */
  onSwitchMenu?: (menu: 'merge' | 'pr') => void
  /** Which menu this is, so arrow keys can toggle to the other */
  currentMenu?: 'merge' | 'pr'
}): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectableIndices = items
    .map((item, i) => (!item.disabled && !item.separator ? i : -1))
    .filter((i) => i !== -1)

  // Focus on mount so keyboard works immediately
  useEffect(() => {
    // Use requestAnimationFrame to ensure the element is rendered before focusing
    const raf = requestAnimationFrame(() => {
      containerRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use setTimeout to avoid catching the click that opened the menu
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Let Cmd/Ctrl+Shift combos pass through to WindowShell global shortcuts
      const isMeta = e.metaKey || e.ctrlKey
      if (isMeta && e.shiftKey) return

      e.stopPropagation()
      if (e.key === 'Escape') {
        onClose()
      } else if ((e.key === 'm' || e.key === 'M') && onSwitchMenu) {
        e.preventDefault()
        onSwitchMenu('merge')
      } else if ((e.key === 'p' || e.key === 'P') && onSwitchMenu) {
        e.preventDefault()
        onSwitchMenu('pr')
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onSwitchMenu) {
        e.preventDefault()
        onSwitchMenu(currentMenu === 'merge' ? 'pr' : 'merge')
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const curPos = selectableIndices.indexOf(selectedIndex)
        const next = curPos < selectableIndices.length - 1
          ? selectableIndices[curPos + 1]
          : selectableIndices[0]
        setSelectedIndex(next)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const curPos = selectableIndices.indexOf(selectedIndex)
        const prev = curPos > 0
          ? selectableIndices[curPos - 1]
          : selectableIndices[selectableIndices.length - 1]
        setSelectedIndex(prev)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[selectedIndex]
        if (item && !item.disabled) {
          item.onSelect()
        }
      }
    },
    [items, selectedIndex, selectableIndices, onClose, onSwitchMenu, currentMenu]
  )

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="absolute z-popover right-0 min-w-[260px] bg-overlay border border-subtle rounded-md shadow-md py-1 outline-none"
      style={{ bottom: '100%', marginBottom: 4 }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="h-px bg-border-subtle mx-2 my-1" />
        }
        const isSelected = selectedIndex === i

        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (!item.disabled) item.onSelect()
            }}
            onMouseEnter={() => {
              if (!item.disabled) setSelectedIndex(i)
            }}
            disabled={item.disabled}
            title={item.disabled ? item.disabledTooltip : undefined}
            className={`ui-btn w-full text-left px-3 h-7 text-sm flex items-center transition-colors duration-[80ms]
              ${item.disabled
                ? 'opacity-40 cursor-not-allowed text-fg-muted'
                : isSelected
                  ? 'bg-raised text-fg-primary'
                  : 'text-fg-secondary hover:bg-raised hover:text-fg-primary'
              }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CompletionActionBar
// ---------------------------------------------------------------------------

export function CompletionActionBar({
  paneId,
  completionStatus,
  onDismiss,
  onAction,
  workspaceId
}: CompletionActionBarProps): React.JSX.Element | null {
  const t = useStrings()
  const MERGE_STRATEGIES = MERGE_STRATEGY_VALUES.map((strategy) => ({
    strategy,
    label:
      strategy === 'rebase-ff'
        ? t.completionBar.rebaseOntoMainAndMerge
        : strategy === 'squash'
          ? t.completionBar.squashOntoMain
          : t.completionBar.mergeCommitIntoMain
  }))
  const PR_OPTIONS = PR_DRAFT_VALUES.map((draft) => ({
    draft,
    label: draft ? t.completionBar.pushAndCreateDraftPr : t.completionBar.pushAndCreatePr
  }))
  const [openMenu, setOpenMenu] = useState<'merge' | 'pr' | null>(null)
  const [ghAvailable, setGhAvailable] = useState<boolean | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const isMac = navigator.platform.startsWith('Mac')
  const metaHint = isMac ? '⌘⇧' : 'Ctrl⇧'

  // Check gh CLI availability on mount
  useEffect(() => {
    ipcInvoke(IPC.GH_CLI_CHECK)
      .then((result) => setGhAvailable((result as GhCliCheckResult).available))
      .catch(() => setGhAvailable(false))
  }, [])

  const state = completionStatus?.state ?? 'ready'

  // Listen for global shortcuts to open merge/PR menus directly.
  // These fire from WindowShell via custom events, so they work even when
  // the terminal has focus — no intermediate "focus the bar" step.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ paneId: string; menu: 'merge' | 'pr' }>
      if (ce.detail?.paneId === paneId && state === 'ready') {
        setOpenMenu(ce.detail.menu)
      }
    }
    document.addEventListener('claudinha:open-completion-menu', handler)
    return () => document.removeEventListener('claudinha:open-completion-menu', handler)
  }, [paneId, state])

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  const handleMerge = useCallback(
    (strategy: MergeStrategy) => {
      setOpenMenu(null) // close menu immediately
      void ipcInvoke(IPC.COMPLETION_MERGE, { paneId, strategy })
      onAction?.()
    },
    [paneId, onAction]
  )

  const handlePr = useCallback(
    (draft: boolean) => {
      setOpenMenu(null) // close menu immediately
      void ipcInvoke(IPC.COMPLETION_PR, { paneId, draft })
      onAction?.()
    },
    [paneId, onAction]
  )

  const handleMergeAll = useCallback(
    (scope: 'workspace' | 'global', strategy: MergeStrategy) => {
      setOpenMenu(null)
      void ipcInvoke(IPC.COMPLETION_MERGE_ALL, {
        scope,
        workspaceId: scope === 'workspace' ? workspaceId ?? undefined : undefined,
        strategy,
        alsoSetPolicy: false
      })
      onAction?.()
    },
    [workspaceId, onAction]
  )

  const handlePrAll = useCallback(
    (scope: 'workspace' | 'global', draft: boolean) => {
      setOpenMenu(null)
      void ipcInvoke(IPC.COMPLETION_PR_ALL, {
        scope,
        workspaceId: scope === 'workspace' ? workspaceId ?? undefined : undefined,
        draft,
        alsoSetPolicy: false
      })
      onAction?.()
    },
    [workspaceId, onAction]
  )

  const handleAbort = useCallback(() => {
    void ipcInvoke(IPC.COMPLETION_ABORT, { paneId })
  }, [paneId])

  const handleResolveWithClaude = useCallback(() => {
    void ipcInvoke(IPC.COMPLETION_RESOLVE, { paneId })
    onAction?.()
  }, [paneId, onAction])

  const handleCancelQueue = useCallback(() => {
    void ipcInvoke(IPC.COMPLETION_CANCEL_QUEUE, { paneId })
  }, [paneId])

  /** Hard-dismiss: hide the bar for the rest of this done cycle. */
  const handleHideBar = useCallback(() => {
    onDismiss()
    ipcSend(IPC.COMPLETION_DISMISS, { paneId })
  }, [paneId, onDismiss])

  /**
   * Non-destructive close: drop a failure state back to 'ready' so the user
   * still has Merge/PR dropdowns to try a different strategy. Does NOT hide
   * the bar (so does not call onDismiss).
   */
  const handleReturnToReady = useCallback(() => {
    ipcSend(IPC.COMPLETION_CLEAR_STATE, { paneId })
  }, [paneId])

  const handleRetry = useCallback(() => {
    void ipcInvoke(IPC.COMPLETION_MERGE, { paneId, strategy: 'rebase-ff' as MergeStrategy })
  }, [paneId])

  // Auto-open the error modal when a merge/PR fails. Reset when state leaves error.
  const [showErrorModal, setShowErrorModal] = useState(false)
  useEffect(() => {
    if (state === 'error') setShowErrorModal(true)
    else setShowErrorModal(false)
  }, [state])

  const handleRevealDirtyMain = useCallback(() => {
    const target = completionStatus?.dirtyMain?.path
    if (!target) return
    void ipcInvoke(IPC.WORKSPACE_REVEAL_PATH, { path: target })
  }, [completionStatus?.dirtyMain?.path])

  // Keyboard handler for the bar (Esc to dismiss, M/P to open menus when bar has focus)
  const handleBarKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openMenu !== null) {
          setOpenMenu(null)
        } else {
          handleHideBar()
        }
      }
    },
    [openMenu, handleHideBar]
  )

  // -------------------------------------------------------------------------
  // Render state-dependent content
  // -------------------------------------------------------------------------

  const renderContent = (): React.JSX.Element => {
    switch (state) {
      case 'rebasing':
        return <span style={{ color: STATUS_DONE_COLOR }}>{t.completionBar.rebasingOntoMain}</span>

      case 'merging':
        return <span style={{ color: STATUS_DONE_COLOR }}>{t.completionBar.mergingIntoMain}</span>

      case 'pushing':
        return <span style={{ color: COMPLETION_PR_COLOR }}>{t.completionBar.pushingToOrigin}</span>

      case 'conflict':
        return (
          <span>
            <span style={{ color: COMPLETION_CONFLICT_COLOR }}>{t.completionBar.conflictDetected}</span>
            <ActionButton
              label={t.completionBar.resolveWithClaude}
              onClick={handleResolveWithClaude}
              color={COMPLETION_MERGE_COLOR}
              bold
            />
            <ActionButton label={t.completionBar.abort} onClick={handleAbort} color={FG_MUTED} />
          </span>
        )

      case 'dirty-main': {
        const dm = completionStatus?.dirtyMain
        const count = dm?.totalCount ?? 0
        const countLabel = count > 0 ? t.completionBar.mainDirtyWithCount(count) : t.completionBar.mainDirty
        const fileTooltip = dm && dm.files.length > 0
          ? dm.files
              .slice(0, 10)
              .concat(dm.totalCount > 10 ? [t.completionBar.moreFiles(dm.totalCount - 10)] : [])
              .join('\n')
          : undefined
        return (
          <span className="inline-flex items-center" style={{ gap: 4 }}>
            <span style={{ color: COMPLETION_CONFLICT_COLOR }} title={fileTooltip}>
              {countLabel}
            </span>
            <ActionButton
              label={t.completionBar.revealInFinder}
              onClick={handleRevealDirtyMain}
              color={FG_MUTED}
              disabled={!dm?.path}
              title={dm?.path}
            />
            <ActionButton label={t.completionBar.retry} onClick={handleRetry} color={FG_MUTED} />
            <ActionButton label={t.completionBar.closeAction} onClick={handleReturnToReady} color={FG_MUTED} />
          </span>
        )
      }

      case 'merged':
        return (
          <span style={{ color: COMPLETION_MERGE_COLOR }}>{t.completionBar.mergedToMain}</span>
        )

      case 'pr-created':
        return (
          <span style={{ color: COMPLETION_PR_COLOR }}>
            {t.completionBar.prCreatedAction}
            {completionStatus?.prUrl && (
              <span style={{ color: FG_MUTED, marginLeft: 8, fontSize: 11 }}>
                {completionStatus.prUrl}
              </span>
            )}
          </span>
        )

      case 'error':
        return (
          <span className="inline-flex items-center" style={{ gap: 4 }}>
            <span style={{ color: COMPLETION_ERROR_COLOR }}>{t.completionBar.mergeOrPrFailed}</span>
            <ActionButton label={t.completionBar.details} onClick={() => setShowErrorModal(true)} color={FG_MUTED} />
            <ActionButton label={t.completionBar.retry} onClick={handleRetry} color={FG_MUTED} />
            <ActionButton label={t.completionBar.closeAction} onClick={handleReturnToReady} color={FG_MUTED} />
          </span>
        )

      case 'queued':
        return (
          <span>
            <span style={{ color: FG_MUTED }}>
              {t.completionBar.queuedFmt(ordinal(completionStatus?.queuePosition ?? 1))}
            </span>
            <ActionButton label={t.completionBar.cancelAction} onClick={handleCancelQueue} color={FG_MUTED} />
          </span>
        )

      case 'ready':
      default:
        return (
          <>
            {/* Merge button + dropdown */}
            <div className="relative inline-block">
              <ActionButton
                label={t.completionBar.mergeMenu}
                onClick={() => setOpenMenu(openMenu === 'merge' ? null : 'merge')}
                color={openMenu === 'merge' ? COMPLETION_MERGE_COLOR : MERGE_COLOR_DIM}
                active={openMenu === 'merge'}
                title={`${metaHint}G`}
              />
              {openMenu === 'merge' && (
                <DropdownMenu
                  onClose={closeMenu}
                  onSwitchMenu={setOpenMenu}
                  currentMenu="merge"
                  items={[
                    ...MERGE_STRATEGIES.map((s) => ({
                      label: s.label,
                      onSelect: () => handleMerge(s.strategy)
                    })),
                    { label: '', separator: true, onSelect: () => { /* noop */ } },
                    {
                      label: t.completionBar.mergeAllGrove,
                      disabled: !workspaceId,
                      disabledTooltip: t.completionBar.noGroveContext,
                      onSelect: () => handleMergeAll('workspace', 'rebase-ff')
                    },
                    {
                      label: t.completionBar.mergeAllGlobal,
                      onSelect: () => handleMergeAll('global', 'rebase-ff')
                    }
                  ]}
                />
              )}
            </div>

            {/* PR button + dropdown */}
            <div className="relative inline-block">
              <ActionButton
                label={t.completionBar.prMenu}
                onClick={() => setOpenMenu(openMenu === 'pr' ? null : 'pr')}
                color={openMenu === 'pr' ? COMPLETION_PR_COLOR : PR_COLOR_DIM}
                active={openMenu === 'pr'}
                title={`${metaHint}R`}
              />
              {openMenu === 'pr' && (
                <DropdownMenu
                  onClose={closeMenu}
                  onSwitchMenu={setOpenMenu}
                  currentMenu="pr"
                  items={[
                    ...PR_OPTIONS.map((opt) => ({
                      label: opt.label,
                      disabled: ghAvailable === false,
                      disabledTooltip: t.completionBar.installGhTooltip,
                      onSelect: () => handlePr(opt.draft)
                    })),
                    { label: '', separator: true, onSelect: () => { /* noop */ } },
                    {
                      label: t.completionBar.createPrsGrove,
                      disabled: ghAvailable === false || !workspaceId,
                      disabledTooltip: !workspaceId
                        ? t.completionBar.noGroveContext
                        : t.completionBar.installGhTooltip,
                      onSelect: () => handlePrAll('workspace', false)
                    },
                    {
                      label: t.completionBar.createDraftPrsGrove,
                      disabled: ghAvailable === false || !workspaceId,
                      disabledTooltip: !workspaceId
                        ? t.completionBar.noGroveContext
                        : t.completionBar.installGhTooltip,
                      onSelect: () => handlePrAll('workspace', true)
                    },
                    {
                      label: t.completionBar.createPrsAllGlobal,
                      disabled: ghAvailable === false,
                      disabledTooltip: t.completionBar.installGhTooltip,
                      onSelect: () => handlePrAll('global', false)
                    }
                  ]}
                />
              )}
            </div>
          </>
        )
    }
  }

  const barBg =
    state === 'conflict' || state === 'dirty-main' || state === 'error'
      ? 'var(--color-danger-subtle-bg)'
      : 'var(--color-success-subtle-bg)'

  return (
    <div
      ref={barRef}
      tabIndex={0}
      onKeyDown={handleBarKeyDown}
      className="flex items-center justify-end px-2 flex-shrink-0"
      style={{
        height: COMPLETION_BAR_HEIGHT_PX,
        background: barBg,
        outline: 'none',
        fontSize: 13
      }}
    >
      <div className="flex items-center flex-shrink-0" style={{ gap: 4 }}>
        {renderContent()}
        {/* Always-present hard-dismiss: hides the bar for the rest of this done cycle. */}
        <ActionButton label="×" onClick={handleHideBar} color={FG_DIM} title="Hide bar" />
      </div>
      {showErrorModal && (
        <CompletionErrorModal
          message={completionStatus?.errorMessage || 'Unknown error.'}
          onRetry={handleRetry}
          onClose={() => setShowErrorModal(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  onClick,
  color,
  bold,
  active,
  title,
  disabled
}: {
  label: string
  onClick: () => void
  /** Explicit text color override — used for state-colored labels (merged, error, …). */
  color?: string
  /** Deprecated alias for `active`. Retained so existing callers keep compiling. */
  bold?: boolean
  /** Filled/highlighted state (e.g. dropdown open). */
  active?: boolean
  title?: string
  disabled?: boolean
}): React.JSX.Element {
  const isActive = active ?? bold ?? false
  const base =
    'ui-btn inline-flex items-center h-6 px-2 rounded-[4px] text-[12px] leading-none transition-colors duration-[80ms]'
  const stateClass = disabled
    ? 'opacity-40 cursor-not-allowed'
    : isActive
      ? 'bg-raised font-semibold'
      : 'hover:bg-raised'
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick() }}
      className={`${base} ${stateClass}`}
      style={color ? { color } : undefined}
      title={title}
      disabled={disabled}
    >
      {label}
    </button>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
