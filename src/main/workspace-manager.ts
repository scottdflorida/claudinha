import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { Workspace, WorkspaceType, WorkspaceConstraint, WorkspaceStatus, TerminalSnapshot, RendererWorkspace, PaneState, CompletionPolicy } from '../shared/types'
import type { WindowInitPayload } from '../shared/ipc-channels'
import type { WindowManager } from './window-manager'
import type { SessionRegistry } from './session-registry'
import {
  getAllWorkspaces,
  getWorkspace,
  saveWorkspace,
  removeWorkspace as removeWorkspaceFromStore,
  updateWorkspaceStatus as updateWorkspaceStatusInStore,
  addPausedTerminal,
  removePausedTerminal,
  getNextWorkspaceNumber,
  peekNextWorkspaceNumber,
  setNextWorkspaceNumber
} from './workspace-store'
import { getGlobalCompletionPolicy } from './completion-policy-store'

/**
 * WorkspaceManager — central orchestrator for workspace lifecycle.
 *
 * Manages creation, activation, deactivation, and restoration of workspaces.
 * Maintains the window-to-workspace mapping and manager window tracking.
 *
 * Phase 1: skeleton that auto-creates general workspaces for existing windows
 * and provides the foundation for future phases (Manager window, dormancy,
 * type constraints).
 */
export class WorkspaceManager {
  /** windowId → workspaceId */
  private readonly workspaceWindowMap = new Map<string, string>()
  /** workspaceId → Workspace (in-memory mirror of WorkspaceStore) */
  private readonly workspaceMap = new Map<string, Workspace>()
  /** The Manager window's BrowserWindow ID, or null */
  private _managerWindowId: string | null = null
  /** Pending WINDOW_INIT payloads, keyed by BrowserWindow id string */
  private readonly pendingInitMap = new Map<string, WindowInitPayload>()

  constructor(
    private readonly windowManager: WindowManager,
    private readonly sessionRegistry: SessionRegistry
  ) {
    // Load persisted workspaces into memory
    for (const workspace of getAllWorkspaces()) {
      this.workspaceMap.set(workspace.id, workspace)
      if (workspace.status === 'active' && workspace.windowId) {
        this.workspaceWindowMap.set(workspace.windowId, workspace.id)
      }
    }
    this.migrateWorkspaceNumbers()
  }

  /**
   * One-shot migration: assign `workspaceNumber` to any persisted workspace that predates
   * the field, and rewrite legacy auto-generated names (`Workspace N`, `foo (Repo)`,
   * `foo/branch`) to `Workspace N`. Custom names are preserved.
   */
  private migrateWorkspaceNumbers(): void {
    const all = Array.from(this.workspaceMap.values())
    const needsNumber = all.filter((h) => typeof h.workspaceNumber !== 'number' || !Number.isFinite(h.workspaceNumber))
    if (needsNumber.length === 0) return

    // Assign numbers in creation order so oldest workspace = Workspace 1.
    needsNumber.sort((a, b) => a.createdAt - b.createdAt)
    let next = peekNextWorkspaceNumber()
    for (const workspace of needsNumber) {
      workspace.workspaceNumber = next
      next += 1
      if (isLegacyAutoName(workspace)) {
        workspace.name = `Workspace ${workspace.workspaceNumber}`
      }
      saveWorkspace(workspace)
    }
    setNextWorkspaceNumber(next)
  }

  // ---------------------------------------------------------------------------
  // Manager window
  // ---------------------------------------------------------------------------

  get managerWindowId(): string | null {
    return this._managerWindowId
  }

  setManagerWindowId(windowId: string): void {
    this._managerWindowId = windowId
  }

  isManagerWindow(windowId: string): boolean {
    return windowId === this._managerWindowId
  }

  // ---------------------------------------------------------------------------
  // Pending WINDOW_INIT payloads
  // ---------------------------------------------------------------------------

  /**
   * Register a WINDOW_INIT payload to be sent when the window's renderer
   * signals RENDERER_READY. Consumed by the RENDERER_READY handler in index.ts.
   */
  setPendingInit(windowId: string, payload: WindowInitPayload): void {
    this.pendingInitMap.set(windowId, payload)
  }

  /**
   * Retrieve and remove the pending init payload for a window.
   * Returns undefined if no pending init exists.
   */
  consumePendingInit(windowId: string): WindowInitPayload | undefined {
    const payload = this.pendingInitMap.get(windowId)
    if (payload) this.pendingInitMap.delete(windowId)
    return payload
  }

  // ---------------------------------------------------------------------------
  // Workspace CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new workspace and optionally open a window for it.
   * In Phase 1, this is called internally to auto-create general workspaces.
   */
  createWorkspace(opts: {
    type: WorkspaceType
    name?: string
    constraint: WorkspaceConstraint
    windowId?: string
  }): Workspace {
    const id = randomUUID()
    const now = Date.now()
    const workspaceNumber = getNextWorkspaceNumber()
    const name = opts.name?.trim() || `Workspace ${workspaceNumber}`

    const workspace: Workspace = {
      id,
      name,
      workspaceNumber,
      type: opts.type,
      constraint: opts.constraint,
      status: opts.windowId ? 'active' : 'dormant',
      windowId: opts.windowId ?? null,
      activePaneIds: [],
      pausedTerminals: [],
      createdAt: now,
      lastActiveAt: now,
      // null = inherit global completion policy
      completionPolicy: null,
      // Default to Kanban; users can switch to Wall via the title-bar toggle or LaunchForm
      viewMode: 'kanban',
      activePaneId: null
    }

    this.workspaceMap.set(id, workspace)
    if (opts.windowId) {
      this.workspaceWindowMap.set(opts.windowId, id)
    }
    saveWorkspace(workspace)
    return workspace
  }

  /**
   * Get a workspace by ID (from in-memory map).
   */
  getWorkspace(workspaceId: string): Workspace | undefined {
    return this.workspaceMap.get(workspaceId)
  }

  /**
   * Get the workspace associated with a window.
   */
  getWorkspaceForWindow(windowId: string): Workspace | undefined {
    const workspaceId = this.workspaceWindowMap.get(windowId)
    if (!workspaceId) return undefined
    return this.workspaceMap.get(workspaceId)
  }

  /**
   * Get the workspace ID bound to a window, or null if the window is not bound
   * to any workspace (e.g., manager window).
   */
  getWorkspaceIdForWindow(windowId: string): string | null {
    return this.workspaceWindowMap.get(windowId) ?? null
  }

  /**
   * Get all active workspaces.
   */
  getActiveWorkspaces(): Workspace[] {
    return Array.from(this.workspaceMap.values()).filter((h) => h.status === 'active')
  }

  /**
   * Get all dormant workspaces.
   */
  getDormantWorkspaces(): Workspace[] {
    return Array.from(this.workspaceMap.values()).filter((h) => h.status === 'dormant')
  }

  /**
   * Get all archived workspaces.
   */
  getArchivedWorkspaces(): Workspace[] {
    return Array.from(this.workspaceMap.values()).filter((h) => h.status === 'archived')
  }

  /**
   * Get all workspaces.
   */
  getAllWorkspaces(): Workspace[] {
    return Array.from(this.workspaceMap.values())
  }

  /**
   * Bind a window to a workspace, marking it active.
   * Used when a window is created after the workspace (e.g., workspace:create IPC).
   */
  bindWindow(workspaceId: string, windowId: string): void {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace) return
    workspace.windowId = windowId
    workspace.status = 'active'
    workspace.lastActiveAt = Date.now()
    this.workspaceWindowMap.set(windowId, workspaceId)
    saveWorkspace(workspace)
  }

  // ---------------------------------------------------------------------------
  // Pane tracking
  // ---------------------------------------------------------------------------

  /**
   * Record that a terminal has been spawned in a workspace.
   */
  addDroneToHive(workspaceId: string, paneId: string): void {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace) return
    if (!workspace.activePaneIds.includes(paneId)) {
      workspace.activePaneIds.push(paneId)
      saveWorkspace(workspace)
    }
  }

  /**
   * Record that a terminal has been closed/removed from a workspace.
   * Creates a TerminalSnapshot with wasActiveAtClose: false.
   */
  removeDroneFromHive(workspaceId: string, pane: PaneState): void {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace) return
    workspace.activePaneIds = workspace.activePaneIds.filter((id) => id !== pane.id)

    // Create dormant terminal snapshot
    const snapshot: TerminalSnapshot = {
      paneId: pane.id,
      sessionId: pane.sessionId,
      worktreePath: pane.worktreePath,
      repoName: pane.repoName,
      worktreeName: pane.worktreeName,
      sessionTitle: pane.metrics.sessionTitle,
      wasActiveAtClose: false,
      snapshotAt: Date.now(),
      gitStatus: pane.gitStatus ?? null,
      userName: pane.userName ?? null,
      initialPrompt: pane.metrics.initialPrompt ?? null
    }
    workspace.pausedTerminals.push(snapshot)
    saveWorkspace(workspace)
    addPausedTerminal(workspaceId, snapshot)

    // Push updated dormant list to the workspace window
    this.pushDormantUpdate(workspace)
  }

  /**
   * Push dormant terminals list update to a workspace's window.
   */
  private pushDormantUpdate(workspace: Workspace): void {
    if (!workspace.windowId) return
    const win = this.windowManager.getWindow(workspace.windowId)
    if (!win || win.isDestroyed()) return
    win.webContents.send('workspace:paused-update', {
      workspaceId: workspace.id,
      pausedTerminals: workspace.pausedTerminals
    })
  }

  // ---------------------------------------------------------------------------
  // Workspace lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Activate a dormant workspace — open a new window for it.
   * Returns the list of TerminalSnapshots that should be auto-resumed
   * (wasActiveAtClose=true, or filtered by terminalIds).
   * The caller (IPC handler) is responsible for actually spawning the terminals.
   */
  activateWorkspace(
    workspaceId: string,
    terminalIdFilter?: string[]
  ): { windowId: string; terminalsToResume: TerminalSnapshot[] } | null {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace || workspace.status !== 'dormant') return null

    // Create a new window for the workspace
    const win = this.windowManager.createWindow()
    const windowId = String(win.id)

    // Bind window to workspace
    workspace.windowId = windowId
    workspace.status = 'active'
    workspace.lastActiveAt = Date.now()
    this.workspaceWindowMap.set(windowId, workspaceId)
    this.applyWindowTitle(windowId)

    // Register pending WINDOW_INIT
    this.setPendingInit(windowId, {
      windowType: 'workspace',
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceType: workspace.type,
      workspaceConstraint: workspace.constraint,
      workspaceCompletionPolicy: workspace.completionPolicy ?? null,
      workspaceViewMode: workspace.viewMode ?? 'kanban',
      workspaceActivePaneId: workspace.activePaneId ?? null,
      globalCompletionPolicy: getGlobalCompletionPolicy()
    })

    // Determine which terminals to auto-resume
    let terminalsToResume: TerminalSnapshot[]
    if (terminalIdFilter && terminalIdFilter.length > 0) {
      // Specific terminals requested (e.g., clicking a single dormant terminal)
      terminalsToResume = workspace.pausedTerminals.filter((d) => terminalIdFilter.includes(d.paneId))
    } else {
      // Reactivating full workspace — resume all dormant terminals. Downstream filters
      // (sessionId check in IPC handler, and per-terminal sessionId guard in
      // WindowShell) will skip any terminal that isn't actually resumable.
      terminalsToResume = workspace.pausedTerminals.slice()
    }

    saveWorkspace(workspace)
    win.focus()
    return { windowId, terminalsToResume }
  }

  /**
   * Called after terminals are successfully resumed in an activated workspace.
   * Removes the resumed terminals from the dormant list and adds them to active.
   */
  markDronesResumed(workspaceId: string, resumedPaneIds: string[], newPaneIds: string[]): void {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace) return
    // Remove resumed snapshots from dormant list
    workspace.pausedTerminals = workspace.pausedTerminals.filter(
      (d) => !resumedPaneIds.includes(d.paneId)
    )
    // Add new pane IDs to active list
    for (const paneId of newPaneIds) {
      if (!workspace.activePaneIds.includes(paneId)) {
        workspace.activePaneIds.push(paneId)
      }
    }
    saveWorkspace(workspace)
  }

  /**
   * Deactivate a workspace — snapshot all active terminals and mark workspace dormant.
   */
  deactivateWorkspace(workspaceId: string): void {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace || workspace.status !== 'active') return

    // Snapshot all currently active terminals as wasActiveAtClose: true
    for (const terminalId of workspace.activePaneIds) {
      const pane = this.sessionRegistry.getPane(terminalId)
      if (pane) {
        const snapshot: TerminalSnapshot = {
          paneId: pane.id,
          sessionId: pane.sessionId,
          worktreePath: pane.worktreePath,
          repoName: pane.repoName,
          worktreeName: pane.worktreeName,
          sessionTitle: pane.metrics.sessionTitle,
          wasActiveAtClose: true,
          snapshotAt: Date.now(),
          gitStatus: pane.gitStatus ?? null,
          userName: pane.userName ?? null,
          initialPrompt: pane.metrics.initialPrompt ?? null
        }
        workspace.pausedTerminals.push(snapshot)
        addPausedTerminal(workspaceId, snapshot)
      }
    }
    workspace.activePaneIds = []
    workspace.status = 'dormant'
    workspace.lastActiveAt = Date.now()
    if (workspace.windowId) {
      this.workspaceWindowMap.delete(workspace.windowId)
    }
    workspace.windowId = null
    saveWorkspace(workspace)
  }

  /**
   * Delete a dormant workspace permanently.
   */
  deleteWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace || workspace.status !== 'dormant') return false
    this.workspaceMap.delete(workspaceId)
    removeWorkspaceFromStore(workspaceId)
    return true
  }

  /**
   * Archive a dormant workspace — move it from the dormant list into the
   * archived state. Archived workspaces are excluded from the main workspace lists
   * and from auto-pruning, but are otherwise preserved on disk.
   */
  archiveWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace || workspace.status !== 'dormant') return false
    workspace.status = 'archived'
    saveWorkspace(workspace)
    return true
  }

  /**
   * Restore an archived workspace back to dormant. The workspace becomes eligible
   * to be re-activated from the manager's dormant list again.
   */
  unarchiveWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace || workspace.status !== 'archived') return false
    workspace.status = 'dormant'
    workspace.lastActiveAt = Date.now()
    saveWorkspace(workspace)
    return true
  }

  /**
   * Permanently delete an archived workspace. Distinct verb from `deleteWorkspace`
   * to keep the dormant-only contract on the original delete channel.
   */
  deleteArchivedWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace || workspace.status !== 'archived') return false
    this.workspaceMap.delete(workspaceId)
    removeWorkspaceFromStore(workspaceId)
    return true
  }

  /**
   * Rename a workspace. A blank/whitespace-only name reverts to the default
   * `Workspace ${workspaceNumber}`. Names are trimmed and capped at 64 characters.
   */
  renameWorkspace(workspaceId: string, name: string): boolean {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace) return false
    const trimmed = name.trim().slice(0, 64)
    workspace.name = trimmed.length > 0 ? trimmed : `Workspace ${workspace.workspaceNumber}`
    saveWorkspace(workspace)
    this.applyWindowTitle(workspace.windowId)
    return true
  }

  // ---------------------------------------------------------------------------
  // Window title computation
  // ---------------------------------------------------------------------------

  /**
   * Return the OS-native window title for a workspace window: `Claudinha: <workspace.name>`.
   * Falls back to `Claudinha` when the workspace isn't found (e.g. during
   * window creation before binding).
   */
  computeWorkspaceTitle(workspaceId: string): string {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace) return 'Claudinha'
    return `Claudinha: ${workspace.name}`
  }

  /**
   * Apply the computed workspace title to a window. No-op if the window is
   * missing, destroyed, or not bound to a workspace.
   */
  applyWindowTitle(windowId: string | null | undefined): void {
    if (!windowId) return
    const workspaceId = this.workspaceWindowMap.get(windowId)
    if (!workspaceId) return
    const win = this.windowManager.getWindow(windowId)
    if (!win || win.isDestroyed()) return
    win.setTitle(this.computeWorkspaceTitle(workspaceId))
  }

  // ---------------------------------------------------------------------------
  // Completion policy (Phase 3)
  // ---------------------------------------------------------------------------

  /**
   * Update a workspace's completion policy override. Pass `null` to clear the
   * override (workspace will inherit the global policy).
   */
  setHiveCompletionPolicy(workspaceId: string, policy: CompletionPolicy | null): boolean {
    const workspace = this.workspaceMap.get(workspaceId)
    if (!workspace) return false
    workspace.completionPolicy = policy
    saveWorkspace(workspace)
    return true
  }

  /**
   * Read a workspace's completion policy override. Returns null if the workspace has
   * no override or does not exist.
   */
  getHiveCompletionPolicy(workspaceId: string): CompletionPolicy | null {
    const workspace = this.workspaceMap.get(workspaceId)
    return workspace?.completionPolicy ?? null
  }

  // ---------------------------------------------------------------------------
  // Crash recovery
  // ---------------------------------------------------------------------------

  /**
   * Recover state after an app crash or unexpected shutdown.
   * Any workspace marked as 'active' but with no corresponding window should be
   * marked as 'dormant' with all active terminals snapshotted.
   */
  recoverState(): void {
    for (const workspace of this.workspaceMap.values()) {
      if (workspace.status === 'active') {
        const hasWindow = workspace.windowId && this.windowManager.getWindow(workspace.windowId)
        if (!hasWindow) {
          // Workspace was active but window is gone — mark dormant
          // Active terminals become dormant with wasActiveAtClose: true
          for (const terminalId of workspace.activePaneIds) {
            // Since the pane is gone (crash), we can only use stored workspace data
            // The terminal snapshots should already be partially correct from saveWorkspace
            const existingSnapshot = workspace.pausedTerminals.find((d) => d.paneId === terminalId)
            if (!existingSnapshot) {
              // Minimal snapshot — we lost the pane data due to crash
              workspace.pausedTerminals.push({
                paneId: terminalId,
                sessionId: null,
                worktreePath: '',
                repoName: 'Unknown',
                worktreeName: 'Unknown',
                sessionTitle: null,
                wasActiveAtClose: true,
                snapshotAt: Date.now()
              })
            }
          }
          workspace.activePaneIds = []
          workspace.status = 'dormant'
          workspace.lastActiveAt = Date.now()
          if (workspace.windowId) {
            this.workspaceWindowMap.delete(workspace.windowId)
          }
          workspace.windowId = null
          saveWorkspace(workspace)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Manager state (for pushing to Manager window)
  // ---------------------------------------------------------------------------

  /**
   * Build the ManagerStatePayload for sending to the Manager window.
   */
  buildManagerState(): { activeWorkspaces: RendererWorkspace[]; dormantWorkspaces: RendererWorkspace[]; archivedWorkspaces: RendererWorkspace[]; nextWorkspaceNumber: number } {
    const toRendererHive = (workspace: Workspace): RendererWorkspace => ({
      id: workspace.id,
      name: workspace.name,
      workspaceNumber: workspace.workspaceNumber,
      type: workspace.type,
      constraint: workspace.constraint,
      status: workspace.status,
      activePaneCount: workspace.activePaneIds.length,
      pausedTerminals: workspace.pausedTerminals,
      lastActiveAt: workspace.lastActiveAt,
      completionPolicy: workspace.completionPolicy ?? null,
      viewMode: workspace.viewMode ?? 'kanban'
    })

    return {
      activeWorkspaces: this.getActiveWorkspaces().map(toRendererHive),
      dormantWorkspaces: this.getDormantWorkspaces().map(toRendererHive),
      archivedWorkspaces: this.getArchivedWorkspaces().map(toRendererHive),
      nextWorkspaceNumber: peekNextWorkspaceNumber()
    }
  }

  /**
   * Push state update to the Manager window (if it exists).
   * Should be called after any workspace state change.
   */
  pushManagerUpdate(): void {
    if (!this._managerWindowId) return
    const win = this.windowManager.getWindow(this._managerWindowId)
    if (!win || win.isDestroyed()) return
    const state = this.buildManagerState()
    win.webContents.send('manager:state-update', state)
  }

}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

const LEGACY_HIVE_NAME_RE = /^Workspace \d+(?:\s+\([A-Za-z\s-]+\))?$/
const LEGACY_REPO_SUFFIX_RE = /^.+ \(Repo\)$/
const LEGACY_WORKTREE_BRANCH_RE = /^[^/]+\/[^/]+$/

/**
 * True if the workspace's name matches one of the historical auto-generated patterns
 * that predate editable workspace names. Used by the migration to rewrite defaults
 * to `Workspace N` without clobbering user-customized names.
 */
function isLegacyAutoName(workspace: Workspace): boolean {
  const name = workspace.name
  if (!name) return true
  if (LEGACY_HIVE_NAME_RE.test(name)) return true
  if (workspace.type === 'repo' && LEGACY_REPO_SUFFIX_RE.test(name)) return true
  if (workspace.type === 'worktree-branch') {
    const repoBasename = workspace.constraint.repoPath?.split('/').filter(Boolean).pop()
    const branch = workspace.constraint.branchName
    if (repoBasename && branch && name === `${repoBasename}/${branch}`) return true
    if (LEGACY_WORKTREE_BRANCH_RE.test(name)) return true
  }
  return false
}
