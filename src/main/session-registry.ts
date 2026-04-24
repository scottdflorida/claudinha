import { randomUUID } from 'crypto'
import type { PaneState, PaneStatus, PaneMetrics, GitStatus, CompletionActionStatus } from '../shared/types'

/**
 * SessionRegistry — the main process source of truth for all pane state.
 *
 * Maps pane IDs to PaneState objects. All status updates, metrics updates,
 * and window moves go through this registry so the state stays consistent.
 *
 * A single instance is created in index.ts and imported by IPC handlers.
 */
/** One-shot listener for pane status transitions */
type StatusChangeListener = (
  paneId: string,
  newStatus: PaneStatus,
  previousStatus: PaneStatus
) => void

export class SessionRegistry {
  private readonly panes = new Map<string, PaneState>()

  /**
   * One-shot status change subscribers keyed by paneId. Each listener fires on
   * the next status transition for that pane and is then removed automatically.
   * Used by the completion executor's conflict-resolution flow to wait for
   * Claude to return to a known state without reaching for Node EventEmitter.
   */
  private readonly statusChangeListeners = new Map<string, Set<StatusChangeListener>>()

  /**
   * Standing status-change subscribers that fire on every transition for any
   * pane (not one-shot, not per-pane). Used by the repo-pane broadcast wiring
   * so the workspace summary refreshes as soon as any pane's status flips,
   * instead of waiting for the next 30s git poll.
   */
  private readonly anyStatusListeners = new Set<StatusChangeListener>()

  // ---------------------------------------------------------------------------
  // ID generation
  // ---------------------------------------------------------------------------

  /** Generate a new unique pane ID (UUID v4 via Node.js crypto) */
  generatePaneId(): string {
    return randomUUID()
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /** Register a newly spawned pane. The paneState must have a unique id. */
  registerPane(paneState: PaneState): void {
    this.panes.set(paneState.id, paneState)
  }

  /** Retrieve a pane by ID, or undefined if not found */
  getPane(paneId: string): PaneState | undefined {
    return this.panes.get(paneId)
  }

  /**
   * Remove a pane from the registry. Returns the removed PaneState so callers
   * can perform cleanup (e.g. kill the associated PTY).
   */
  removePane(paneId: string): PaneState | undefined {
    const pane = this.panes.get(paneId)
    if (pane) {
      this.panes.delete(paneId)
    }
    return pane
  }

  /** Total number of panes currently registered */
  get paneCount(): number {
    return this.panes.size
  }

  /** Returns all panes that belong to the given window, in registration order */
  getPanesForWindow(windowId: string): PaneState[] {
    const result: PaneState[] = []
    for (const pane of this.panes.values()) {
      if (pane.windowId === windowId) {
        result.push(pane)
      }
    }
    return result
  }

  /** Returns all panes that belong to the given workspace */
  getPanesForWorkspace(workspaceId: string): PaneState[] {
    const result: PaneState[] = []
    for (const pane of this.panes.values()) {
      if (pane.workspaceId === workspaceId) {
        result.push(pane)
      }
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // Window movement
  // ---------------------------------------------------------------------------

  /**
   * Update a pane's windowId to reflect it being moved to a different window.
   * Returns the updated PaneState, or null if the pane is not found.
   */
  movePane(paneId: string, targetWindowId: string): PaneState | null {
    const pane = this.panes.get(paneId)
    if (!pane) return null
    pane.windowId = targetWindowId
    return pane
  }

  // ---------------------------------------------------------------------------
  // Status updates
  // ---------------------------------------------------------------------------

  /**
   * Update a pane's status. Only emits a meaningful update when status actually
   * changes (callers should compare return value against prior state).
   *
   * @param paneId         Target pane
   * @param status         New status
   * @param source         Detection source: 'hook' or 'pty-fallback'
   * @param activeToolName Optional: tool name for PreToolUse, null to clear
   * @returns Updated PaneState, or null if pane not found
   */
  updatePaneStatus(
    paneId: string,
    status: PaneStatus,
    source: 'hook' | 'pty-fallback',
    activeToolName?: string | null
  ): PaneState | null {
    const pane = this.panes.get(paneId)
    if (!pane) return null

    const previousStatus = pane.status
    const statusChanged = previousStatus !== status
    // Clear completion action status on any status transition — prevents
    // stale merge/PR/error states from persisting across done cycles.
    // Safe for in-progress merges because pane stays 'done' during merge flow.
    if (statusChanged) {
      pane.completionActionStatus = null
    }
    pane.status = status
    pane.statusSource = source

    if (activeToolName !== undefined) {
      pane.activeToolName = activeToolName
    }

    if (statusChanged) {
      pane.statusChangedAt = Date.now()
      // Mark unseen change only for unfocused panes (cleared when pane is focused)
      if (!pane.isFocused) {
        pane.hasUnseenStatusChange = true
      }
      // Fire any one-shot status listeners registered for this pane.
      this.fireStatusChangeListeners(paneId, status, previousStatus)
    }

    return pane
  }

  /**
   * Register a one-shot listener for the next status transition on a pane.
   * The listener fires exactly once and is automatically removed afterwards.
   * Returns an unsubscribe function the caller can invoke to detach early
   * (e.g. on timeout).
   */
  onNextStatusChange(paneId: string, listener: StatusChangeListener): () => void {
    let set = this.statusChangeListeners.get(paneId)
    if (!set) {
      set = new Set()
      this.statusChangeListeners.set(paneId, set)
    }
    set.add(listener)
    return () => {
      const current = this.statusChangeListeners.get(paneId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.statusChangeListeners.delete(paneId)
    }
  }

  /**
   * Register a standing listener that fires on every pane status transition
   * (any pane). Returns an unsubscribe fn. Fires ONLY when status actually
   * changes — not when only activeToolName, statusSource, or any other field
   * is updated. Sibling to `onNextStatusChange` (one-shot, per-pane); this
   * one is many-shot, any-pane.
   */
  onAnyStatusChange(listener: StatusChangeListener): () => void {
    this.anyStatusListeners.add(listener)
    return () => {
      this.anyStatusListeners.delete(listener)
    }
  }

  private fireStatusChangeListeners(
    paneId: string,
    newStatus: PaneStatus,
    previousStatus: PaneStatus
  ): void {
    const perPane = this.statusChangeListeners.get(paneId)
    if (perPane && perPane.size > 0) {
      // Snapshot + clear before firing so listeners registering new listeners
      // from within a callback don't get caught in the same batch.
      const listeners = [...perPane]
      this.statusChangeListeners.delete(paneId)
      for (const listener of listeners) {
        try {
          listener(paneId, newStatus, previousStatus)
        } catch (err) {
          console.error('[session-registry] onNextStatusChange listener threw:', err)
        }
      }
    }

    if (this.anyStatusListeners.size > 0) {
      // Snapshot before iterating so an unsubscribe during a callback only
      // affects the next fire, not this one.
      const standing = [...this.anyStatusListeners]
      for (const listener of standing) {
        try {
          listener(paneId, newStatus, previousStatus)
        } catch (err) {
          console.error('[session-registry] onAnyStatusChange listener threw:', err)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Metrics updates
  // ---------------------------------------------------------------------------

  /**
   * Replace a pane's metrics with updated values from MetricsCollector.
   * Returns the updated PaneState, or null if pane not found.
   */
  updatePaneMetrics(paneId: string, metrics: PaneMetrics): PaneState | null {
    const pane = this.panes.get(paneId)
    if (!pane) return null
    pane.metrics = metrics
    return pane
  }

  // ---------------------------------------------------------------------------
  // Auxiliary updaters (used by HookListener and IPC handlers)
  // ---------------------------------------------------------------------------

  /** Store the Claude Code session_id obtained from SessionStart hook event */
  updatePaneSessionId(paneId: string, sessionId: string): void {
    const pane = this.panes.get(paneId)
    if (pane) pane.sessionId = sessionId
  }

  /** Store the transcript file path obtained from Stop hook event */
  updatePaneTranscriptPath(paneId: string, transcriptPath: string): void {
    const pane = this.panes.get(paneId)
    if (pane) pane.transcriptPath = transcriptPath
  }

  /** Store the context window size reported by the statusline JSON */
  updatePaneContextWindowSize(paneId: string, size: number): void {
    const pane = this.panes.get(paneId)
    if (pane) pane.contextWindowSize = size
  }

  /**
   * Set the Claude Code permission mode for a pane. Returns true when the
   * value actually changed (so callers can gate the broadcast on transitions
   * only).
   */
  updatePanePermissionMode(paneId: string, mode: 'normal' | 'plan'): boolean {
    const pane = this.panes.get(paneId)
    if (!pane) return false
    if ((pane.permissionMode ?? 'normal') === mode) return false
    pane.permissionMode = mode
    return true
  }

  /**
   * Set focus state on a pane. When a pane is focused, clear its
   * hasUnseenStatusChange flag (user has seen the status).
   */
  setPaneFocused(paneId: string, focused: boolean): PaneState | null {
    const pane = this.panes.get(paneId)
    if (!pane) return null
    pane.isFocused = focused
    if (focused) {
      pane.hasUnseenStatusChange = false
    }
    return pane
  }

  /**
   * Increment the usage count for a specific tool in a pane's metrics.
   * Called on PostToolUse hook events for real-time tool usage display.
   * Creates the toolsUsed Map if it doesn't exist yet.
   */
  incrementToolUsage(paneId: string, toolName: string): void {
    const pane = this.panes.get(paneId)
    if (!pane) return
    if (!pane.metrics.toolsUsed) {
      pane.metrics.toolsUsed = new Map()
    }
    const current = pane.metrics.toolsUsed.get(toolName) ?? 0
    pane.metrics.toolsUsed.set(toolName, current + 1)
  }

  // ---------------------------------------------------------------------------
  // Git status updates
  // ---------------------------------------------------------------------------

  /** Update the git status for a pane's worktree */
  updatePaneGitStatus(paneId: string, gitStatus: GitStatus): PaneState | null {
    const pane = this.panes.get(paneId)
    if (!pane) return null
    pane.gitStatus = gitStatus
    return pane
  }

  // ---------------------------------------------------------------------------
  // Completion action status
  // ---------------------------------------------------------------------------

  /** Update the completion action status for a pane (merge/PR flow) */
  updatePaneCompletionStatus(paneId: string, status: CompletionActionStatus | null): PaneState | null {
    const pane = this.panes.get(paneId)
    if (!pane) return null
    pane.completionActionStatus = status
    return pane
  }

  /**
   * Set the "resolving conflict" flag on a pane. Used by the completion
   * executor to surface a distinct "Resolving Conflict" label in the status
   * overlay while Claude is working through merge conflicts.
   */
  setResolvingConflict(paneId: string, isResolvingConflict: boolean): PaneState | null {
    const pane = this.panes.get(paneId)
    if (!pane) return null
    pane.isResolvingConflict = isResolvingConflict
    return pane
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Returns the full panes map as read-only */
  getAllPanes(): ReadonlyMap<string, PaneState> {
    return this.panes
  }

  /** Number of registered panes */
  get size(): number {
    return this.panes.size
  }
}
