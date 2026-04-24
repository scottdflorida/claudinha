/**
 * WorkspaceStore unit tests.
 *
 * Verifies persistence of workspace records with mocked electron-store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock electron-store — in-memory map simulating .get() / .set()
// ---------------------------------------------------------------------------

const mockStoreData = new Map<string, unknown>()

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      get(key: string, defaultValue?: unknown): unknown {
        return mockStoreData.has(key) ? mockStoreData.get(key) : defaultValue
      }
      set(key: string, value: unknown): void {
        mockStoreData.set(key, value)
      }
    }
  }
})

import {
  getAllWorkspaces,
  getWorkspace,
  saveWorkspace,
  removeWorkspace,
  updateWorkspaceStatus,
  addPausedTerminal,
  removePausedTerminal,
  clearPausedTerminals,
  getNextWorkspaceNumber,
  peekNextWorkspaceNumber,
  setNextWorkspaceNumber,
  migrateLegacyKeys
} from '../src/main/workspace-store'
import type { Workspace, TerminalSnapshot } from '../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: `workspace-${Math.random().toString(16).slice(2, 8)}`,
    name: 'Test Workspace',
    workspaceNumber: 1,
    type: 'general',
    constraint: {},
    status: 'active',
    windowId: 'win-1',
    activePaneIds: [],
    pausedTerminals: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides
  }
}

function makeTerminalSnapshot(overrides: Partial<TerminalSnapshot> = {}): TerminalSnapshot {
  return {
    paneId: `pane-${Math.random().toString(16).slice(2, 8)}`,
    sessionId: 'sess-123',
    worktreePath: '/path/to/worktree',
    repoName: 'my-repo',
    worktreeName: 'main',
    sessionTitle: null,
    wasActiveAtClose: false,
    snapshotAt: Date.now(),
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceStore', () => {
  beforeEach(() => {
    mockStoreData.clear()
  })

  describe('migrateLegacyKeys', () => {
    it('copies legacy hives.all → workspaces.all when new key is empty', () => {
      const legacy = [makeWorkspace({ id: 'legacy-1', name: 'Legacy Workspace' })]
      mockStoreData.set('hives.all', legacy)
      mockStoreData.set('hives.nextGroveNumber', 5)

      migrateLegacyKeys()

      expect(getAllWorkspaces()).toHaveLength(1)
      expect(getAllWorkspaces()[0].id).toBe('legacy-1')
      expect(peekNextWorkspaceNumber()).toBe(5)
    })

    it('leaves new keys alone when they already have data', () => {
      const existing = [makeWorkspace({ id: 'new-1', name: 'Already Migrated' })]
      mockStoreData.set('workspaces.all', existing)
      mockStoreData.set('workspaces.nextNumber', 9)
      mockStoreData.set('hives.all', [makeWorkspace({ id: 'legacy-x' })])
      mockStoreData.set('hives.nextGroveNumber', 2)

      migrateLegacyKeys()

      expect(getAllWorkspaces()).toHaveLength(1)
      expect(getAllWorkspaces()[0].id).toBe('new-1')
      expect(peekNextWorkspaceNumber()).toBe(9)
    })

    it('leaves legacy keys on disk after migration (one-release rollback window)', () => {
      const legacy = [makeWorkspace({ id: 'legacy-1' })]
      mockStoreData.set('hives.all', legacy)
      mockStoreData.set('hives.nextGroveNumber', 3)

      migrateLegacyKeys()

      // Legacy keys still present
      expect(mockStoreData.get('hives.all')).toEqual(legacy)
      expect(mockStoreData.get('hives.nextGroveNumber')).toBe(3)
    })

    it('is a no-op when neither legacy nor new data exists', () => {
      migrateLegacyKeys()
      expect(getAllWorkspaces()).toEqual([])
      expect(peekNextWorkspaceNumber()).toBe(1)
    })
  })

  it('returns empty array when no workspaces exist', () => {
    expect(getAllWorkspaces()).toEqual([])
  })

  it('saves and retrieves a workspace', () => {
    const workspace = makeWorkspace({ id: 'workspace-1', name: 'My Workspace' })
    saveWorkspace(workspace)

    const all = getAllWorkspaces()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('workspace-1')
    expect(all[0].name).toBe('My Workspace')
  })

  it('getWorkspace returns a single workspace by ID', () => {
    saveWorkspace(makeWorkspace({ id: 'h1' }))
    saveWorkspace(makeWorkspace({ id: 'h2', name: 'Second' }))

    const h = getWorkspace('h2')
    expect(h).toBeDefined()
    expect(h!.name).toBe('Second')
  })

  it('getWorkspace returns undefined for non-existent ID', () => {
    expect(getWorkspace('nonexistent')).toBeUndefined()
  })

  it('upserts by ID (replaces existing workspace)', () => {
    const workspace = makeWorkspace({ id: 'h1', name: 'Original' })
    saveWorkspace(workspace)

    const updated = { ...workspace, name: 'Updated' }
    saveWorkspace(updated)

    const all = getAllWorkspaces()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('Updated')
  })

  it('removeWorkspace deletes by ID', () => {
    saveWorkspace(makeWorkspace({ id: 'h1' }))
    saveWorkspace(makeWorkspace({ id: 'h2' }))

    removeWorkspace('h1')

    const all = getAllWorkspaces()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('h2')
  })

  it('removeWorkspace is a no-op for non-existent ID', () => {
    saveWorkspace(makeWorkspace({ id: 'h1' }))
    removeWorkspace('nonexistent')
    expect(getAllWorkspaces()).toHaveLength(1)
  })

  it('updateWorkspaceStatus changes status and windowId', () => {
    saveWorkspace(makeWorkspace({ id: 'h1', status: 'active', windowId: 'win-1' }))

    updateWorkspaceStatus('h1', 'dormant', null)

    const h = getWorkspace('h1')
    expect(h!.status).toBe('dormant')
    expect(h!.windowId).toBeNull()
  })

  it('updateWorkspaceStatus updates lastActiveAt when activating', () => {
    const oldTime = Date.now() - 100000
    saveWorkspace(makeWorkspace({ id: 'h1', status: 'dormant', windowId: null, lastActiveAt: oldTime }))

    updateWorkspaceStatus('h1', 'active', 'win-2')

    const h = getWorkspace('h1')
    expect(h!.status).toBe('active')
    expect(h!.windowId).toBe('win-2')
    expect(h!.lastActiveAt).toBeGreaterThan(oldTime)
  })

  it('addPausedTerminal appends a terminal snapshot', () => {
    saveWorkspace(makeWorkspace({ id: 'h1' }))
    const terminal = makeTerminalSnapshot({ paneId: 'p1' })

    addPausedTerminal('h1', terminal)

    const h = getWorkspace('h1')
    expect(h!.pausedTerminals).toHaveLength(1)
    expect(h!.pausedTerminals[0].paneId).toBe('p1')
  })

  it('addPausedTerminal deduplicates by paneId', () => {
    saveWorkspace(makeWorkspace({ id: 'h1' }))
    const terminal1 = makeTerminalSnapshot({ paneId: 'p1', sessionTitle: 'First' })
    const terminal2 = makeTerminalSnapshot({ paneId: 'p1', sessionTitle: 'Second' })

    addPausedTerminal('h1', terminal1)
    addPausedTerminal('h1', terminal2)

    const h = getWorkspace('h1')
    expect(h!.pausedTerminals).toHaveLength(1)
    expect(h!.pausedTerminals[0].sessionTitle).toBe('Second')
  })

  it('removePausedTerminal removes by paneId', () => {
    saveWorkspace(makeWorkspace({ id: 'h1' }))
    addPausedTerminal('h1', makeTerminalSnapshot({ paneId: 'p1' }))
    addPausedTerminal('h1', makeTerminalSnapshot({ paneId: 'p2' }))

    removePausedTerminal('h1', 'p1')

    const h = getWorkspace('h1')
    expect(h!.pausedTerminals).toHaveLength(1)
    expect(h!.pausedTerminals[0].paneId).toBe('p2')
  })

  it('clearPausedTerminals removes all terminals from a workspace', () => {
    saveWorkspace(makeWorkspace({ id: 'h1' }))
    addPausedTerminal('h1', makeTerminalSnapshot({ paneId: 'p1' }))
    addPausedTerminal('h1', makeTerminalSnapshot({ paneId: 'p2' }))

    clearPausedTerminals('h1')

    const h = getWorkspace('h1')
    expect(h!.pausedTerminals).toHaveLength(0)
  })

  it('caps workspaces at 100 by pruning oldest dormant first', () => {
    // Create 100 dormant workspaces
    for (let i = 0; i < 100; i++) {
      saveWorkspace(makeWorkspace({
        id: `h-${i}`,
        status: 'dormant',
        windowId: null,
        lastActiveAt: i * 1000 // oldest first
      }))
    }
    expect(getAllWorkspaces()).toHaveLength(100)

    // Adding one more should prune the oldest dormant
    saveWorkspace(makeWorkspace({ id: 'h-new', status: 'active' }))

    const all = getAllWorkspaces()
    expect(all).toHaveLength(100)
    // The oldest dormant (h-0) should be gone
    expect(all.find((h) => h.id === 'h-0')).toBeUndefined()
    // The new one should be present
    expect(all.find((h) => h.id === 'h-new')).toBeDefined()
  })

  it('archived workspaces are exempt from pruning when the cap is exceeded', () => {
    // 50 archived (oldest, should NOT be touched) + 49 dormant (younger)
    for (let i = 0; i < 50; i++) {
      saveWorkspace(makeWorkspace({
        id: `archived-${i}`,
        status: 'archived',
        windowId: null,
        lastActiveAt: i * 1000 // older than dormant
      }))
    }
    for (let i = 0; i < 49; i++) {
      saveWorkspace(makeWorkspace({
        id: `dormant-${i}`,
        status: 'dormant',
        windowId: null,
        lastActiveAt: 1_000_000 + i * 1000 // younger than archived
      }))
    }
    expect(getAllWorkspaces()).toHaveLength(99)

    // Adding two more should push us over 100 and prune two dormants
    saveWorkspace(makeWorkspace({ id: 'extra-1', status: 'dormant', lastActiveAt: 9_000_000 }))
    saveWorkspace(makeWorkspace({ id: 'extra-2', status: 'dormant', lastActiveAt: 9_000_001 }))

    const all = getAllWorkspaces()
    expect(all).toHaveLength(100)

    // All archived workspaces must still be present — they are exempt from pruning
    for (let i = 0; i < 50; i++) {
      expect(all.find((h) => h.id === `archived-${i}`)).toBeDefined()
    }
    // The oldest dormant (dormant-0) should be the one pruned
    expect(all.find((h) => h.id === 'dormant-0')).toBeUndefined()
  })

  it('preserves all fields through round-trip', () => {
    const workspace: Workspace = {
      id: 'full-test',
      name: 'Full Test Workspace',
      workspaceNumber: 7,
      type: 'repo',
      constraint: { repoPath: '/path/to/repo' },
      status: 'active',
      windowId: 'win-42',
      activePaneIds: ['p1', 'p2'],
      pausedTerminals: [makeTerminalSnapshot({ paneId: 'p0', wasActiveAtClose: true })],
      createdAt: 1710900000000,
      lastActiveAt: 1710900060000
    }
    saveWorkspace(workspace)

    const retrieved = getWorkspace('full-test')
    expect(retrieved).toEqual(workspace)
  })

  it('persists Kanban view-mode fields across round-trip (viewMode + activePaneId)', () => {
    const workspace: Workspace = {
      id: 'kanban-ws',
      name: 'Kanban Workspace',
      workspaceNumber: 9,
      type: 'general',
      constraint: {},
      status: 'active',
      windowId: 'win-kanban',
      activePaneIds: ['pane-a', 'pane-b'],
      pausedTerminals: [],
      createdAt: 1710900000000,
      lastActiveAt: 1710900060000,
      viewMode: 'kanban',
      activePaneId: 'pane-b'
    }
    saveWorkspace(workspace)

    const retrieved = getWorkspace('kanban-ws')
    expect(retrieved?.viewMode).toBe('kanban')
    expect(retrieved?.activePaneId).toBe('pane-b')
  })

  it('treats pre-Kanban workspaces (no viewMode field) as legacy records', () => {
    // Simulate a workspace saved before Kanban was introduced: no viewMode /
    // activePaneId fields on disk. Reading it back should not crash; consumers
    // normalize `viewMode ?? 'kanban'` so legacy records render in Kanban.
    const legacy: Workspace = {
      id: 'legacy-ws',
      name: 'Legacy Workspace',
      workspaceNumber: 1,
      type: 'general',
      constraint: {},
      status: 'dormant',
      windowId: null,
      activePaneIds: [],
      pausedTerminals: [],
      createdAt: 1_600_000_000_000,
      lastActiveAt: 1_600_000_000_000
    }
    saveWorkspace(legacy)

    const retrieved = getWorkspace('legacy-ws')
    expect(retrieved).toBeDefined()
    expect(retrieved?.viewMode).toBeUndefined()
    expect(retrieved?.activePaneId).toBeUndefined()
  })

  describe('workspace number counter', () => {
    it('starts at 1 and increments monotonically', () => {
      expect(peekNextWorkspaceNumber()).toBe(1)
      expect(getNextWorkspaceNumber()).toBe(1)
      expect(getNextWorkspaceNumber()).toBe(2)
      expect(getNextWorkspaceNumber()).toBe(3)
      expect(peekNextWorkspaceNumber()).toBe(4)
    })

    it('persists across reads', () => {
      getNextWorkspaceNumber() // 1
      getNextWorkspaceNumber() // 2
      // Simulate an intervening unrelated store read
      getAllWorkspaces()
      expect(peekNextWorkspaceNumber()).toBe(3)
    })

    it('setNextWorkspaceNumber overrides the counter (migration path)', () => {
      getNextWorkspaceNumber() // 1
      setNextWorkspaceNumber(42)
      expect(getNextWorkspaceNumber()).toBe(42)
      expect(peekNextWorkspaceNumber()).toBe(43)
    })
  })
})
