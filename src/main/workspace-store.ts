import Store from 'electron-store'
import type { Workspace, WorkspaceStatus, TerminalSnapshot } from '../shared/types'

// ---------------------------------------------------------------------------
// Workspace persistence (Claudinha — workspace lifecycle)
//
// Module-level singleton following the session-history-store.ts pattern.
// Stores workspace records so they survive app restarts and can be resumed.
// ---------------------------------------------------------------------------

const MAX_WORKSPACES = 100

interface WorkspaceStoreSchema {
  'workspaces.all': Workspace[]
  /**
   * Monotonic counter for assigning persistent workspace ordinals.
   * Increments on each new workspace; never reused, even when workspaces are removed.
   */
  'workspaces.nextNumber': number
  // Legacy keys. Read-only from this module — kept on disk for
  // one release so users can roll back. migrateLegacyKeys() copies the
  // values across on first boot.
  'hives.all'?: Workspace[]
  'hives.nextGroveNumber'?: number
}

const store = new Store<WorkspaceStoreSchema>({
  name: 'workspace-store'
})

/**
 * One-time migration from electron-store keys (`hives.all`,
 * `hives.nextGroveNumber`) to Claudinha's Workspace schema. Idempotent: if the
 * new keys already hold data, the legacy values are not copied. Called from
 * main/index.ts at app startup before any other workspace-store consumer.
 *
 * Legacy keys are left on disk for one release so users can roll back.
 */
export function migrateLegacyKeys(): void {
  const existing = store.get('workspaces.all', [] as Workspace[])
  if (existing.length === 0) {
    const legacy = store.get('hives.all', [] as Workspace[])
    if (legacy.length > 0) {
      store.set('workspaces.all', legacy)
    }
  }
  const existingNum = store.get('workspaces.nextNumber', 0)
  if (existingNum === 0) {
    const legacyNum = store.get('hives.nextGroveNumber', 0)
    if (legacyNum > 0) {
      store.set('workspaces.nextNumber', legacyNum)
    }
  }
}

/**
 * Returns the next workspace ordinal to assign, then increments and persists the
 * counter. Call exactly once per new workspace at creation time.
 */
export function getNextWorkspaceNumber(): number {
  const n = store.get('workspaces.nextNumber', 1)
  store.set('workspaces.nextNumber', n + 1)
  return n
}

/** Read-only peek at the next workspace ordinal (for tests). */
export function peekNextWorkspaceNumber(): number {
  return store.get('workspaces.nextNumber', 1)
}

/** Set the next workspace ordinal (used by migration on boot). */
export function setNextWorkspaceNumber(n: number): void {
  store.set('workspaces.nextNumber', n)
}

/**
 * Returns all workspace records.
 */
export function getAllWorkspaces(): Workspace[] {
  return store.get('workspaces.all', [])
}

/**
 * Returns a single workspace by ID, or undefined if not found.
 */
export function getWorkspace(workspaceId: string): Workspace | undefined {
  const workspaces = getAllWorkspaces()
  return workspaces.find((w) => w.id === workspaceId)
}

/**
 * Upsert a workspace record. If a workspace with the same ID exists, it is replaced.
 * Caps total workspaces at MAX_WORKSPACES by pruning oldest dormant workspaces first.
 */
export function saveWorkspace(workspace: Workspace): void {
  const workspaces = getAllWorkspaces()
  const idx = workspaces.findIndex((w) => w.id === workspace.id)
  if (idx >= 0) {
    workspaces[idx] = workspace
  } else {
    workspaces.push(workspace)
  }
  // Prune oldest dormant workspaces if over cap
  while (workspaces.length > MAX_WORKSPACES) {
    const oldestDormantIdx = findOldestDormantIndex(workspaces)
    if (oldestDormantIdx >= 0) {
      workspaces.splice(oldestDormantIdx, 1)
    } else {
      // All workspaces are active — can't prune, just break
      break
    }
  }
  store.set('workspaces.all', workspaces)
}

/**
 * Remove a workspace by ID.
 */
export function removeWorkspace(workspaceId: string): void {
  const workspaces = getAllWorkspaces().filter((w) => w.id !== workspaceId)
  store.set('workspaces.all', workspaces)
}

/**
 * Update a workspace's status and windowId.
 */
export function updateWorkspaceStatus(workspaceId: string, status: WorkspaceStatus, windowId: string | null): void {
  const workspaces = getAllWorkspaces()
  const workspace = workspaces.find((w) => w.id === workspaceId)
  if (!workspace) return
  workspace.status = status
  workspace.windowId = windowId
  if (status === 'active') {
    workspace.lastActiveAt = Date.now()
  }
  store.set('workspaces.all', workspaces)
}

/**
 * Add a paused terminal snapshot to a workspace's pausedTerminals list.
 * Deduplicates by paneId (replaces existing if present).
 */
export function addPausedTerminal(workspaceId: string, terminal: TerminalSnapshot): void {
  const workspaces = getAllWorkspaces()
  const workspace = workspaces.find((w) => w.id === workspaceId)
  if (!workspace) return
  // Remove existing snapshot with same paneId
  workspace.pausedTerminals = workspace.pausedTerminals.filter((t) => t.paneId !== terminal.paneId)
  workspace.pausedTerminals.push(terminal)
  store.set('workspaces.all', workspaces)
}

/**
 * Remove a paused terminal from a workspace by original paneId.
 */
export function removePausedTerminal(workspaceId: string, originalPaneId: string): void {
  const workspaces = getAllWorkspaces()
  const workspace = workspaces.find((w) => w.id === workspaceId)
  if (!workspace) return
  workspace.pausedTerminals = workspace.pausedTerminals.filter((t) => t.paneId !== originalPaneId)
  store.set('workspaces.all', workspaces)
}

/**
 * Clear all paused terminals from a workspace.
 */
export function clearPausedTerminals(workspaceId: string): void {
  const workspaces = getAllWorkspaces()
  const workspace = workspaces.find((w) => w.id === workspaceId)
  if (!workspace) return
  workspace.pausedTerminals = []
  store.set('workspaces.all', workspaces)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findOldestDormantIndex(workspaces: Workspace[]): number {
  let oldestIdx = -1
  let oldestTime = Infinity
  for (let i = 0; i < workspaces.length; i++) {
    if (workspaces[i].status === 'dormant' && workspaces[i].lastActiveAt < oldestTime) {
      oldestTime = workspaces[i].lastActiveAt
      oldestIdx = i
    }
  }
  return oldestIdx
}
