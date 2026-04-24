import type { PaneCloseAction, PaneStatus } from '../../shared/types'

// ---------------------------------------------------------------------------
// Pure builder for the PaneCloseConfirmModal action set. Keeps the modal
// component dumb and lets the branching logic live somewhere directly
// unit-tested.
// ---------------------------------------------------------------------------

export interface PaneCloseDescriptor {
  status: PaneStatus
  isWorktree: boolean
  /** True when the pane has never consumed tokens AND is awaiting-prompt. */
  isUntouched: boolean
  hasUncommittedChanges: boolean
  changedFileCount: number
  commitsAhead: number
}

export interface PaneCloseOption {
  action: PaneCloseAction
  label: string
  /** Primary = recommended default + rightmost emphasised button. */
  variant: 'primary' | 'secondary' | 'destructive'
  /** Short destructive note shown with the button (red-tinted in the modal). */
  warning?: string
}

/** The subset of PaneCloseActions that can appear as a silent-bypass action.
 *  merge-close and keep-close never bypass (they always need confirmation). */
export type PaneBypassAction = Extract<PaneCloseAction, 'prune-close' | 'close-non-worktree'>

export interface PaneCloseResolution {
  /** When set, the caller should close silently with this action — no modal. */
  bypass?: PaneBypassAction
  /** One-line status summary — shown as the modal's status row. */
  statusLine: string
  /** Unmerged summary. null when the worktree is clean or not applicable. */
  unmergedCallout: string | null
  /** Ordered buttons excluding Cancel (Cancel is rendered uniformly by the modal). */
  buttons: PaneCloseOption[]
}

// ---------------------------------------------------------------------------
// Status copy map — keeps phrasing consistent across modals.
// ---------------------------------------------------------------------------

const STATUS_COPY: Record<PaneStatus, string> = {
  'awaiting-prompt': 'Session is awaiting a prompt',
  'working': 'Terminal is actively working',
  'needs-input': 'Terminal is waiting for input',
  'done': 'Terminal has finished',
  'error': 'Terminal is in an error state'
}

/**
 * Human-readable summary of how far the worktree has drifted from main.
 * Returns null when the branch is clean — so the modal can skip the callout.
 */
export function buildUnmergedCallout(changedFileCount: number, commitsAhead: number): string | null {
  const parts: string[] = []
  if (changedFileCount > 0) {
    parts.push(`${changedFileCount} file${changedFileCount === 1 ? '' : 's'} modified`)
  }
  if (commitsAhead > 0) {
    parts.push(`${commitsAhead} commit${commitsAhead === 1 ? '' : 's'} ahead of main`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function hasUnmergedWork(descriptor: PaneCloseDescriptor): boolean {
  return descriptor.hasUncommittedChanges || descriptor.commitsAhead > 0
}

/**
 * Decide whether the caller can silently close the pane (bypass) or must show
 * the confirmation modal, and if so, which buttons to offer.
 *
 * Bypass rules:
 *  - Untouched awaiting-prompt panes (status='awaiting-prompt' + no tokens) close silently.
 *    Worktree panes prune their worktree; non-worktree panes just close.
 *  - Worktree panes that are 'done' and clean (no uncommitted files, 0 commits ahead
 *    of main) also close silently, pruning the worktree. There's nothing to preserve.
 *  - Non-worktree 'done' panes close silently — the status-aware modal applies to
 *    busy/error states only.
 *
 * Modal rules for worktree panes:
 *  - 'done' + unmerged → Keep-close, Prune-close (with warning if uncommitted),
 *    Merge-close (primary).
 *  - Any other state (busy / needs-input / error / touched-awaiting-prompt) →
 *    Keep-close, Prune-close. Merge is not offered (pane isn't really done).
 *
 * Modal rules for non-worktree panes (rare): single "Close anyway" button.
 */
export function buildPaneCloseOptions(descriptor: PaneCloseDescriptor): PaneCloseResolution {
  const { status, isWorktree, isUntouched, hasUncommittedChanges, changedFileCount, commitsAhead } = descriptor
  const unmerged = hasUnmergedWork(descriptor)
  const unmergedCallout = isWorktree ? buildUnmergedCallout(changedFileCount, commitsAhead) : null

  // -------- Bypass paths --------
  if (isUntouched) {
    return {
      bypass: isWorktree ? 'prune-close' : 'close-non-worktree',
      statusLine: STATUS_COPY[status],
      unmergedCallout,
      buttons: []
    }
  }
  if (status === 'done' && !unmerged) {
    return {
      bypass: isWorktree ? 'prune-close' : 'close-non-worktree',
      statusLine: STATUS_COPY[status],
      unmergedCallout,
      buttons: []
    }
  }

  // -------- Non-worktree: single close button --------
  if (!isWorktree) {
    return {
      statusLine: STATUS_COPY[status],
      unmergedCallout: null,
      buttons: [
        { action: 'close-non-worktree', label: 'Close anyway', variant: 'primary' }
      ]
    }
  }

  // -------- Worktree, done + unmerged: full 3-action set with merge as primary --------
  if (status === 'done' && unmerged) {
    return {
      statusLine: STATUS_COPY[status],
      unmergedCallout,
      buttons: [
        { action: 'keep-close',  label: 'Keep worktree & close',  variant: 'secondary' },
        {
          action: 'prune-close',
          label: 'Prune worktree & close',
          variant: 'destructive',
          warning: hasUncommittedChanges
            ? `${changedFileCount} uncommitted file${changedFileCount === 1 ? '' : 's'} will be discarded`
            : undefined
        },
        { action: 'merge-close', label: 'Merge & close', variant: 'primary' }
      ]
    }
  }

  // -------- Worktree, busy / needs-input / error / touched-awaiting: keep or prune --------
  return {
    statusLine: STATUS_COPY[status],
    unmergedCallout,
    buttons: [
      { action: 'keep-close',  label: 'Keep worktree & close',  variant: 'secondary' },
      {
        action: 'prune-close',
        label: 'Prune worktree & close',
        variant: 'destructive',
        warning: hasUncommittedChanges
          ? `${changedFileCount} uncommitted file${changedFileCount === 1 ? '' : 's'} will be discarded`
          : undefined
      }
    ]
  }
}
