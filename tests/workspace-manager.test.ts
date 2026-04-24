/**
 * WorkspaceManager unit tests.
 *
 * Verifies workspace lifecycle management with mocked dependencies.
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

// Mock crypto.randomUUID
let uuidCounter = 0
vi.mock('crypto', () => ({
  randomUUID: () => `uuid-${++uuidCounter}`
}))

import { WorkspaceManager } from '../src/main/workspace-manager'
import { createMockRegistry } from './helpers/mock-registry'
import { createMockWindowManager } from './helpers/mock-window-manager'
import type { PaneState } from '../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics() {
  return {
    totalTokens: null,
    contextPercent: null,
    toolsUsed: null,
    totalCostUsd: null,
    durationMs: null,
    modelDisplayName: null,
    linesAdded: null,
    linesRemoved: null,
    sessionTitle: null
  }
}

function makePaneState(overrides: Partial<PaneState> = {}): PaneState {
  return {
    id: 'pane-1',
    windowId: 'win-1',
    workspaceId: 'workspace-1',
    ptyId: 'pty-1',
    sessionId: 'sess-1',
    transcriptPath: null,
    contextWindowSize: null,
    repoName: 'my-repo',
    worktreeName: 'main',
    worktreePath: '/path/to/worktree',
    status: 'awaiting-prompt',
    activeToolName: null,
    statusChangedAt: 0,
    statusSource: 'hook',
    isFocused: false,
    hasUnseenStatusChange: false,
    isApiBilling: false,
    effort: 'medium',
    model: 'opus',
    metrics: makeMetrics(),
    createdAt: 0,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceManager', () => {
  let workspaceManager: WorkspaceManager
  let mockRegistry: ReturnType<typeof createMockRegistry>
  let mockWindowManager: ReturnType<typeof createMockWindowManager>

  beforeEach(() => {
    mockStoreData.clear()
    uuidCounter = 0
    mockRegistry = createMockRegistry()
    mockWindowManager = createMockWindowManager()
    workspaceManager = new WorkspaceManager(
      mockWindowManager as any,
      mockRegistry as any
    )
  })

  describe('createWorkspace', () => {
    it('creates a general workspace with default Workspace N name and assigns a workspaceNumber', () => {
      const workspace = workspaceManager.createWorkspace({
        type: 'general',
        constraint: {},
        windowId: 'win-1'
      })

      expect(workspace.id).toBe('uuid-1')
      expect(workspace.type).toBe('general')
      expect(workspace.status).toBe('active')
      expect(workspace.windowId).toBe('win-1')
      expect(workspace.workspaceNumber).toBe(1)
      expect(workspace.name).toBe('Workspace 1')
    })

    it('assigns monotonically increasing workspace numbers', () => {
      const a = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      const b = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-2' })
      const c = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-3' })

      expect([a.workspaceNumber, b.workspaceNumber, c.workspaceNumber]).toEqual([1, 2, 3])
      expect(a.name).toBe('Workspace 1')
      expect(b.name).toBe('Workspace 2')
      expect(c.name).toBe('Workspace 3')
    })

    it('repo and worktree-branch workspaces also default to Workspace N', () => {
      const repo = workspaceManager.createWorkspace({
        type: 'repo',
        constraint: { repoPath: '/home/user/claudio' },
        windowId: 'win-1'
      })
      const branch = workspaceManager.createWorkspace({
        type: 'worktree-branch',
        constraint: { repoPath: '/home/user/repo', branchName: 'feature/auth' },
        windowId: 'win-2'
      })

      expect(repo.name).toBe('Workspace 1')
      expect(branch.name).toBe('Workspace 2')
    })

    it('uses custom name when provided', () => {
      const workspace = workspaceManager.createWorkspace({
        type: 'general',
        name: 'My Custom Workspace',
        constraint: {},
        windowId: 'win-1'
      })

      expect(workspace.name).toBe('My Custom Workspace')
      expect(workspace.workspaceNumber).toBe(1)
    })

    it('creates dormant workspace when no windowId provided', () => {
      const workspace = workspaceManager.createWorkspace({
        type: 'general',
        constraint: {}
      })

      expect(workspace.status).toBe('dormant')
      expect(workspace.windowId).toBeNull()
    })

    it('initializes viewMode to "kanban" and activePaneId to null (Kanban default)', () => {
      const workspace = workspaceManager.createWorkspace({
        type: 'general',
        constraint: {},
        windowId: 'win-1'
      })

      expect(workspace.viewMode).toBe('kanban')
      expect(workspace.activePaneId).toBeNull()
    })
  })

  describe('computeWorkspaceTitle', () => {
    it('returns "Claudinha: <name>" for a bound workspace', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      expect(workspaceManager.computeWorkspaceTitle(workspace.id)).toBe(`Claudinha: ${workspace.name}`)
    })

    it('returns "Claudinha: <name>" for a repo-constrained workspace, ignoring repo path', () => {
      const workspace = workspaceManager.createWorkspace({
        type: 'repo',
        constraint: { repoPath: '/home/user/some-repo' },
        windowId: 'win-1'
      })
      expect(workspaceManager.computeWorkspaceTitle(workspace.id)).toBe(`Claudinha: ${workspace.name}`)
    })

    it('falls back to "Claudinha" when the workspace is missing', () => {
      expect(workspaceManager.computeWorkspaceTitle('does-not-exist')).toBe('Claudinha')
    })
  })

  describe('renameWorkspace', () => {
    it('persists a trimmed new name', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      expect(workspaceManager.renameWorkspace(workspace.id, '  Scratch  ')).toBe(true)
      expect(workspaceManager.getWorkspace(workspace.id)?.name).toBe('Scratch')
    })

    it('reverts to the default Workspace N when the name is blank', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.renameWorkspace(workspace.id, 'Scratch')
      workspaceManager.renameWorkspace(workspace.id, '   ')
      expect(workspaceManager.getWorkspace(workspace.id)?.name).toBe(`Workspace ${workspace.workspaceNumber}`)
    })

    it('caps the name at 64 characters', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.renameWorkspace(workspace.id, 'x'.repeat(200))
      expect(workspaceManager.getWorkspace(workspace.id)?.name.length).toBe(64)
    })
  })

  describe('workspace number migration (on construction)', () => {
    it('assigns workspaceNumber to legacy workspaces in createdAt order and rewrites legacy auto-names', () => {
      // Seed the mock store with workspaces that predate workspaceNumber. The fields are
      // deliberately missing `workspaceNumber` to simulate an older persisted record.
      const legacy = [
        { id: 'legacy-b', name: 'Workspace 2', type: 'general', constraint: {},
          status: 'dormant', windowId: null, activePaneIds: [], pausedTerminals: [],
          createdAt: 2000, lastActiveAt: 2000 },
        { id: 'legacy-a', name: 'My Custom Name', type: 'general', constraint: {},
          status: 'dormant', windowId: null, activePaneIds: [], pausedTerminals: [],
          createdAt: 1000, lastActiveAt: 1000 },
        { id: 'legacy-c', name: 'claudio (Repo)', type: 'repo',
          constraint: { repoPath: '/u/claudio' }, status: 'dormant', windowId: null,
          activePaneIds: [], pausedTerminals: [], createdAt: 3000, lastActiveAt: 3000 },
        { id: 'legacy-d', name: 'claudio/main', type: 'worktree-branch',
          constraint: { repoPath: '/u/claudio', branchName: 'main' }, status: 'dormant',
          windowId: null, activePaneIds: [], pausedTerminals: [],
          createdAt: 4000, lastActiveAt: 4000 }
      ]
      mockStoreData.set('workspaces.all', legacy)

      const migrated = new WorkspaceManager(mockWindowManager as any, mockRegistry as any)

      // Oldest first → 1, 2, 3, 4 in createdAt order
      expect(migrated.getWorkspace('legacy-a')?.workspaceNumber).toBe(1)
      expect(migrated.getWorkspace('legacy-b')?.workspaceNumber).toBe(2)
      expect(migrated.getWorkspace('legacy-c')?.workspaceNumber).toBe(3)
      expect(migrated.getWorkspace('legacy-d')?.workspaceNumber).toBe(4)

      // Custom name preserved
      expect(migrated.getWorkspace('legacy-a')?.name).toBe('My Custom Name')
      // Legacy auto-names rewritten
      expect(migrated.getWorkspace('legacy-b')?.name).toBe('Workspace 2')
      expect(migrated.getWorkspace('legacy-c')?.name).toBe('Workspace 3')
      expect(migrated.getWorkspace('legacy-d')?.name).toBe('Workspace 4')
    })

    it('is idempotent: running the migration again leaves numbers unchanged', () => {
      const legacy = [
        { id: 'legacy-x', name: 'Workspace 1', type: 'general', constraint: {},
          status: 'dormant', windowId: null, activePaneIds: [], pausedTerminals: [],
          createdAt: 1000, lastActiveAt: 1000 }
      ]
      mockStoreData.set('workspaces.all', legacy)

      const first = new WorkspaceManager(mockWindowManager as any, mockRegistry as any)
      const firstNumber = first.getWorkspace('legacy-x')?.workspaceNumber
      const firstName = first.getWorkspace('legacy-x')?.name

      // Reconstruct — simulates a second process run against the same store.
      const second = new WorkspaceManager(mockWindowManager as any, mockRegistry as any)
      expect(second.getWorkspace('legacy-x')?.workspaceNumber).toBe(firstNumber)
      expect(second.getWorkspace('legacy-x')?.name).toBe(firstName)
    })
  })

  describe('getWorkspace / getWorkspaceForWindow', () => {
    it('retrieves workspace by ID', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      expect(workspaceManager.getWorkspace(workspace.id)).toBe(workspace)
    })

    it('retrieves workspace by window ID', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      expect(workspaceManager.getWorkspaceForWindow('win-1')).toBe(workspace)
    })

    it('returns undefined for unknown window ID', () => {
      expect(workspaceManager.getWorkspaceForWindow('nonexistent')).toBeUndefined()
    })
  })

  describe('getActiveWorkspaces / getDormantWorkspaces', () => {
    it('separates active and dormant workspaces', () => {
      workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.createWorkspace({ type: 'general', constraint: {} }) // dormant

      expect(workspaceManager.getActiveWorkspaces()).toHaveLength(1)
      expect(workspaceManager.getDormantWorkspaces()).toHaveLength(1)
    })
  })

  describe('addDroneToHive / removeDroneFromHive', () => {
    it('tracks active terminals', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })

      workspaceManager.addDroneToHive(workspace.id, 'pane-1')
      workspaceManager.addDroneToHive(workspace.id, 'pane-2')

      expect(workspace.activePaneIds).toEqual(['pane-1', 'pane-2'])
    })

    it('does not add duplicate terminal IDs', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })

      workspaceManager.addDroneToHive(workspace.id, 'pane-1')
      workspaceManager.addDroneToHive(workspace.id, 'pane-1')

      expect(workspace.activePaneIds).toEqual(['pane-1'])
    })

    it('removes terminal and creates dormant snapshot', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.addDroneToHive(workspace.id, 'pane-1')

      const pane = makePaneState({ id: 'pane-1', workspaceId: workspace.id })
      workspaceManager.removeDroneFromHive(workspace.id, pane)

      expect(workspace.activePaneIds).toEqual([])
      expect(workspace.pausedTerminals).toHaveLength(1)
      expect(workspace.pausedTerminals[0].paneId).toBe('pane-1')
      expect(workspace.pausedTerminals[0].wasActiveAtClose).toBe(false)
      expect(workspace.pausedTerminals[0].sessionId).toBe('sess-1')
    })
  })

  describe('deactivateWorkspace', () => {
    it('snapshots active terminals and marks workspace dormant', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.addDroneToHive(workspace.id, 'pane-1')
      workspaceManager.addDroneToHive(workspace.id, 'pane-2')

      const pane1 = makePaneState({ id: 'pane-1', workspaceId: workspace.id })
      const pane2 = makePaneState({ id: 'pane-2', workspaceId: workspace.id, sessionId: 'sess-2' })

      mockRegistry.getPane
        .mockImplementation((id: string) => id === 'pane-1' ? pane1 : id === 'pane-2' ? pane2 : undefined)

      workspaceManager.deactivateWorkspace(workspace.id)

      expect(workspace.status).toBe('dormant')
      expect(workspace.windowId).toBeNull()
      expect(workspace.activePaneIds).toEqual([])
      expect(workspace.pausedTerminals).toHaveLength(2)
      expect(workspace.pausedTerminals[0].wasActiveAtClose).toBe(true)
      expect(workspace.pausedTerminals[1].wasActiveAtClose).toBe(true)
    })

    it('is a no-op for already dormant workspaces', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      expect(workspace.status).toBe('dormant')

      workspaceManager.deactivateWorkspace(workspace.id)
      expect(workspace.status).toBe('dormant')
    })
  })

  describe('activateWorkspace', () => {
    // Build a dormant workspace with two dormant terminals: one was active at close,
    // one was closed individually by the user (e.g., completion/merge).
    function makeDormantHiveWithTwoDrones() {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.addDroneToHive(workspace.id, 'pane-active')
      workspaceManager.addDroneToHive(workspace.id, 'pane-closed')

      const paneActive = makePaneState({ id: 'pane-active', workspaceId: workspace.id, sessionId: 'sess-active' })
      const paneClosed = makePaneState({ id: 'pane-closed', workspaceId: workspace.id, sessionId: 'sess-closed' })

      // Simulate individual user close of pane-closed (wasActiveAtClose=false)
      workspaceManager.removeDroneFromHive(workspace.id, paneClosed)

      // Then deactivate the workspace — pane-active becomes wasActiveAtClose=true
      mockRegistry.getPane.mockImplementation((id: string) => id === 'pane-active' ? paneActive : undefined)
      workspaceManager.deactivateWorkspace(workspace.id)

      return workspace
    }

    it('resumes all dormant terminals when no terminalIdFilter is passed (Tend workspace)', () => {
      const workspace = makeDormantHiveWithTwoDrones()

      const result = workspaceManager.activateWorkspace(workspace.id)

      expect(result).not.toBeNull()
      const ids = result!.terminalsToResume.map((d) => d.paneId).sort()
      expect(ids).toEqual(['pane-active', 'pane-closed'])
      expect(workspace.status).toBe('active')
    })

    it('resumes a terminal with wasActiveAtClose=false (regression for empty Tend workspace)', () => {
      const workspace = makeDormantHiveWithTwoDrones()

      const result = workspaceManager.activateWorkspace(workspace.id)

      expect(result).not.toBeNull()
      const closed = result!.terminalsToResume.find((d) => d.paneId === 'pane-closed')
      expect(closed).toBeDefined()
      expect(closed!.wasActiveAtClose).toBe(false)
    })

    it('restricts resume to terminalIdFilter when provided (individual Tend)', () => {
      const workspace = makeDormantHiveWithTwoDrones()

      const result = workspaceManager.activateWorkspace(workspace.id, ['pane-closed'])

      expect(result).not.toBeNull()
      expect(result!.terminalsToResume).toHaveLength(1)
      expect(result!.terminalsToResume[0].paneId).toBe('pane-closed')
    })

    it('returns null when activating a non-dormant workspace', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      // workspace is active (has windowId)

      const result = workspaceManager.activateWorkspace(workspace.id)

      expect(result).toBeNull()
    })
  })

  describe('deleteWorkspace', () => {
    it('deletes a dormant workspace', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      expect(workspaceManager.deleteWorkspace(workspace.id)).toBe(true)
      expect(workspaceManager.getWorkspace(workspace.id)).toBeUndefined()
    })

    it('refuses to delete an active workspace', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      expect(workspaceManager.deleteWorkspace(workspace.id)).toBe(false)
      expect(workspaceManager.getWorkspace(workspace.id)).toBeDefined()
    })

    it('refuses to delete an archived workspace (use deleteArchivedWorkspace instead)', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      workspaceManager.archiveWorkspace(workspace.id)
      expect(workspaceManager.deleteWorkspace(workspace.id)).toBe(false)
      expect(workspaceManager.getWorkspace(workspace.id)).toBeDefined()
    })
  })

  describe('archive lifecycle', () => {
    it('archives a dormant workspace', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      expect(workspace.status).toBe('dormant')
      expect(workspaceManager.archiveWorkspace(workspace.id)).toBe(true)
      expect(workspace.status).toBe('archived')
    })

    it('refuses to archive an active workspace', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      expect(workspaceManager.archiveWorkspace(workspace.id)).toBe(false)
      expect(workspace.status).toBe('active')
    })

    it('refuses to archive an already-archived workspace', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      workspaceManager.archiveWorkspace(workspace.id)
      expect(workspaceManager.archiveWorkspace(workspace.id)).toBe(false)
      expect(workspace.status).toBe('archived')
    })

    it('unarchives an archived workspace back to dormant and bumps lastActiveAt', async () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      workspaceManager.archiveWorkspace(workspace.id)
      const before = workspace.lastActiveAt
      await new Promise((r) => setTimeout(r, 5))
      expect(workspaceManager.unarchiveWorkspace(workspace.id)).toBe(true)
      expect(workspace.status).toBe('dormant')
      expect(workspace.lastActiveAt).toBeGreaterThan(before)
    })

    it('refuses to unarchive a non-archived workspace', () => {
      const dormant = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      expect(workspaceManager.unarchiveWorkspace(dormant.id)).toBe(false)
      expect(dormant.status).toBe('dormant')

      const active = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      expect(workspaceManager.unarchiveWorkspace(active.id)).toBe(false)
      expect(active.status).toBe('active')
    })

    it('deleteArchivedWorkspace removes an archived workspace permanently', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      workspaceManager.archiveWorkspace(workspace.id)
      expect(workspaceManager.deleteArchivedWorkspace(workspace.id)).toBe(true)
      expect(workspaceManager.getWorkspace(workspace.id)).toBeUndefined()
    })

    it('deleteArchivedWorkspace refuses non-archived workspaces', () => {
      const dormant = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      expect(workspaceManager.deleteArchivedWorkspace(dormant.id)).toBe(false)
      expect(workspaceManager.getWorkspace(dormant.id)).toBeDefined()

      const active = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      expect(workspaceManager.deleteArchivedWorkspace(active.id)).toBe(false)
      expect(workspaceManager.getWorkspace(active.id)).toBeDefined()
    })

    it('getArchivedWorkspaces returns only archived workspaces', () => {
      const a = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      const b = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.archiveWorkspace(a.id)
      workspaceManager.archiveWorkspace(b.id)

      const archived = workspaceManager.getArchivedWorkspaces()
      expect(archived).toHaveLength(2)
      expect(archived.every((h) => h.status === 'archived')).toBe(true)
    })

    it('archived workspaces are excluded from getDormantWorkspaces and getActiveWorkspaces', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      workspaceManager.archiveWorkspace(workspace.id)

      expect(workspaceManager.getDormantWorkspaces()).toHaveLength(0)
      expect(workspaceManager.getActiveWorkspaces()).toHaveLength(0)
      expect(workspaceManager.getArchivedWorkspaces()).toHaveLength(1)
    })
  })

  describe('renameWorkspace', () => {
    it('renames a workspace', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.renameWorkspace(workspace.id, 'New Name')
      expect(workspace.name).toBe('New Name')
    })

    it('returns false for non-existent workspace', () => {
      expect(workspaceManager.renameWorkspace('nonexistent', 'Name')).toBe(false)
    })
  })

  describe('managerWindow', () => {
    it('tracks manager window ID', () => {
      expect(workspaceManager.managerWindowId).toBeNull()
      workspaceManager.setManagerWindowId('win-mgr')
      expect(workspaceManager.managerWindowId).toBe('win-mgr')
      expect(workspaceManager.isManagerWindow('win-mgr')).toBe(true)
      expect(workspaceManager.isManagerWindow('win-other')).toBe(false)
    })
  })

  describe('buildManagerState', () => {
    it('returns active, dormant, and archived workspaces as RendererWorkspace objects', () => {
      workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.createWorkspace({ type: 'repo', constraint: { repoPath: '/repo' } })
      const toArchive = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
      workspaceManager.archiveWorkspace(toArchive.id)

      const state = workspaceManager.buildManagerState()
      expect(state.activeWorkspaces).toHaveLength(1)
      expect(state.dormantWorkspaces).toHaveLength(1)
      expect(state.archivedWorkspaces).toHaveLength(1)
      expect(state.activeWorkspaces[0].type).toBe('general')
      expect(state.dormantWorkspaces[0].type).toBe('repo')
      expect(state.archivedWorkspaces[0].status).toBe('archived')
    })

    it('exposes lastActiveAt on every renderer workspace', () => {
      const created = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      const state = workspaceManager.buildManagerState()
      expect(state.activeWorkspaces[0].lastActiveAt).toBe(created.lastActiveAt)
      expect(typeof state.activeWorkspaces[0].lastActiveAt).toBe('number')
    })

    it('exposes nextWorkspaceNumber (used to prefill the Workspace Name field)', () => {
      // Fresh store — next number is 1
      expect(workspaceManager.buildManagerState().nextWorkspaceNumber).toBe(1)
      workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      // One workspace created — next number is 2
      expect(workspaceManager.buildManagerState().nextWorkspaceNumber).toBe(2)
      workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-2' })
      expect(workspaceManager.buildManagerState().nextWorkspaceNumber).toBe(3)
    })

    it('bumps lastActiveAt when a workspace transitions to dormant', async () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      const before = workspace.lastActiveAt
      // Wait a tick so Date.now() advances
      await new Promise((r) => setTimeout(r, 5))
      workspaceManager.deactivateWorkspace(workspace.id)
      expect(workspace.status).toBe('dormant')
      expect(workspace.lastActiveAt).toBeGreaterThan(before)
    })
  })

  describe('recoverState', () => {
    it('marks active workspaces without windows as dormant', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      // Mock: window does not exist (simulating crash)
      mockWindowManager.getWindow.mockReturnValue(undefined)

      workspaceManager.recoverState()

      expect(workspace.status).toBe('dormant')
      expect(workspace.windowId).toBeNull()
    })

    it('snapshots active terminals as wasActiveAtClose during recovery', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      workspaceManager.addDroneToHive(workspace.id, 'pane-1')
      workspaceManager.addDroneToHive(workspace.id, 'pane-2')
      mockWindowManager.getWindow.mockReturnValue(undefined)

      workspaceManager.recoverState()

      expect(workspace.pausedTerminals).toHaveLength(2)
      expect(workspace.pausedTerminals[0].wasActiveAtClose).toBe(true)
      expect(workspace.pausedTerminals[1].wasActiveAtClose).toBe(true)
      expect(workspace.activePaneIds).toEqual([])
    })

    it('leaves active workspaces with existing windows untouched', () => {
      const workspace = workspaceManager.createWorkspace({ type: 'general', constraint: {}, windowId: 'win-1' })
      // Mock: window exists
      mockWindowManager.getWindow.mockReturnValue(mockWindowManager._mockWindow)

      workspaceManager.recoverState()

      expect(workspace.status).toBe('active')
      expect(workspace.windowId).toBe('win-1')
    })
  })
})
