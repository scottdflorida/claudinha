/**
 * WORKSPACE_SET_VIEW_MODE / WORKSPACE_SET_ACTIVE_PANE handler behavior tests
 * (Kanban Phase 1).
 *
 * Verifies:
 * - mutation is reflected on the in-memory Workspace
 * - saveWorkspace is called (persistence)
 * - workspaceManager.pushManagerUpdate() runs after the mutation (L-027/L-033)
 * - input is validated at the IPC boundary (L-016)
 * - active-pane setter rejects pane IDs that aren't in the workspace
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ----- Mocks (must precede imports of the module under test) ----------------

vi.mock('electron', () => {
  const handleMap = new Map<string, Function>()
  const onMap = new Map<string, Function>()
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Function) => handleMap.set(channel, handler)),
      on: vi.fn((channel: string, handler: Function) => onMap.set(channel, handler)),
      _handleMap: handleMap,
      _onMap: onMap
    },
    shell: { openExternal: vi.fn() },
    BrowserWindow: { fromWebContents: vi.fn(() => ({ id: 1 })) },
    dialog: { showOpenDialog: vi.fn() },
    app: { getAppPath: vi.fn(() => '/app'), getVersion: vi.fn(() => '0.1.0') }
  }
})

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => ''),
  execFile: vi.fn()
}))

const { saveWorkspaceMock } = vi.hoisted(() => ({ saveWorkspaceMock: vi.fn() }))
vi.mock('../src/main/workspace-store', () => ({
  saveWorkspace: saveWorkspaceMock
}))

vi.mock('../src/main/git-status', () => ({
  gitCommitAll: vi.fn(),
  gitWorktreeRemove: vi.fn(),
  ghCliAvailable: vi.fn(() => Promise.resolve(true))
}))

vi.mock('../src/main/session-history-store', () => ({
  getSessionHistory: vi.fn(() => []),
  addSessionHistoryEntry: vi.fn()
}))

vi.mock('../src/main/permissions-store', () => ({
  getGlobalOverrides: vi.fn(() => ({ allow: [], deny: [] })),
  setGlobalOverrides: vi.fn(),
  getProjectOverrides: vi.fn(() => ({ allow: [], deny: [] })),
  setProjectOverrides: vi.fn(),
  resetGlobalOverrides: vi.fn(),
  resetProjectOverrides: vi.fn(),
  getProjectPaths: vi.fn(() => []),
  resolveEffectivePermissions: vi.fn(() => ({ allow: [], deny: [] }))
}))

vi.mock('../src/main/analytics/usage-instrumentation', () => ({
  trackPaneSpawned: vi.fn(),
  trackPaneClosed: vi.fn(),
  trackPaneMoved: vi.fn(),
  trackWindowCreated: vi.fn(),
  trackWindowClosed: vi.fn(),
  trackFeedbackSubmitted: vi.fn()
}))

vi.mock('../src/main/analytics/session-instrumentation', () => ({
  registerPaneSpawnMode: vi.fn(),
  deregisterPaneSession: vi.fn(),
  trackSessionCompleted: vi.fn()
}))

vi.mock('../src/main/analytics/performance-instrumentation', () => ({
  recordPtySpawnStart: vi.fn(),
  recordPtyFirstData: vi.fn(),
  clearPtySpawnTracking: vi.fn()
}))

vi.mock('../src/main/analytics/error-instrumentation', () => ({
  trackPtyCrashed: vi.fn(),
  trackFallbackActivated: vi.fn()
}))

import { ipcMain } from 'electron'
import { IPC } from '../src/shared/ipc-channels'
import { registerIpcHandlers } from '../src/main/ipc-handlers'
import { createMockIpcDeps } from './helpers/mock-ipc-deps'
import type { Workspace } from '../src/shared/types'

// ----- Helpers --------------------------------------------------------------

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'Test Workspace',
    workspaceNumber: 1,
    type: 'general',
    constraint: {},
    status: 'active',
    windowId: 'win-1',
    activePaneIds: ['pane-a', 'pane-b'],
    pausedTerminals: [],
    createdAt: 0,
    lastActiveAt: 0,
    viewMode: 'wall',
    activePaneId: null,
    ...overrides
  }
}

function setupHandlers(workspace: Workspace) {
  const deps = createMockIpcDeps()
  const pushManagerUpdate = vi.fn()
  ;(deps.workspaceManager as any).getWorkspace = vi.fn((id: string) =>
    id === workspace.id ? workspace : undefined
  )
  ;(deps.workspaceManager as any).pushManagerUpdate = pushManagerUpdate
  registerIpcHandlers(
    deps.windowManager as any,
    deps.sessionRegistry as any,
    deps.ptyPool as any,
    deps.hookListener as any,
    deps.permissionsManager as any,
    deps.statusDetector as any,
    deps.metricsCollector as any,
    deps.transitionBuffer as any,
    deps.workspaceManager as any,
    deps.gitStatusPoller as any,
    deps.completionExecutor as any
  )
  return { deps, pushManagerUpdate }
}

// ----- Tests ----------------------------------------------------------------

describe('WORKSPACE_SET_VIEW_MODE handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveWorkspaceMock.mockClear()
  })

  it('flips viewMode, persists, and pushes a manager update', () => {
    const workspace = makeWorkspace({ viewMode: 'wall' })
    const { pushManagerUpdate } = setupHandlers(workspace)

    const handler = (ipcMain as any)._handleMap.get(IPC.WORKSPACE_SET_VIEW_MODE) as Function
    expect(handler).toBeDefined()

    const result = handler({}, { workspaceId: 'ws-1', viewMode: 'kanban' })

    expect(result).toEqual({ error: null })
    expect(workspace.viewMode).toBe('kanban')
    expect(saveWorkspaceMock).toHaveBeenCalledWith(workspace)
    expect(pushManagerUpdate).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown viewMode strings without mutating', () => {
    const workspace = makeWorkspace({ viewMode: 'wall' })
    const { pushManagerUpdate } = setupHandlers(workspace)
    const handler = (ipcMain as any)._handleMap.get(IPC.WORKSPACE_SET_VIEW_MODE) as Function

    const result = handler({}, { workspaceId: 'ws-1', viewMode: 'list' as any })

    expect(result.error).toMatch(/invalid viewMode/i)
    expect(workspace.viewMode).toBe('wall')
    expect(saveWorkspaceMock).not.toHaveBeenCalled()
    expect(pushManagerUpdate).not.toHaveBeenCalled()
  })

  it('returns error when workspace is not found', () => {
    const workspace = makeWorkspace()
    setupHandlers(workspace)
    const handler = (ipcMain as any)._handleMap.get(IPC.WORKSPACE_SET_VIEW_MODE) as Function

    const result = handler({}, { workspaceId: 'does-not-exist', viewMode: 'kanban' })

    expect(result.error).toMatch(/not found/i)
    expect(saveWorkspaceMock).not.toHaveBeenCalled()
  })
})

describe('WORKSPACE_SET_ACTIVE_PANE handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveWorkspaceMock.mockClear()
  })

  it('sets activePaneId for a pane that is active in the workspace', () => {
    const workspace = makeWorkspace({ activePaneIds: ['pane-a', 'pane-b'], activePaneId: null })
    const { pushManagerUpdate } = setupHandlers(workspace)
    const handler = (ipcMain as any)._handleMap.get(IPC.WORKSPACE_SET_ACTIVE_PANE) as Function

    const result = handler({}, { workspaceId: 'ws-1', paneId: 'pane-b' })

    expect(result).toEqual({ error: null })
    expect(workspace.activePaneId).toBe('pane-b')
    expect(saveWorkspaceMock).toHaveBeenCalledWith(workspace)
    expect(pushManagerUpdate).toHaveBeenCalledTimes(1)
  })

  it('clears activePaneId when paneId is null', () => {
    const workspace = makeWorkspace({ activePaneId: 'pane-a' })
    setupHandlers(workspace)
    const handler = (ipcMain as any)._handleMap.get(IPC.WORKSPACE_SET_ACTIVE_PANE) as Function

    const result = handler({}, { workspaceId: 'ws-1', paneId: null })

    expect(result).toEqual({ error: null })
    expect(workspace.activePaneId).toBeNull()
  })

  it('rejects pane IDs that are not in the workspace', () => {
    const workspace = makeWorkspace({ activePaneIds: ['pane-a'], activePaneId: 'pane-a' })
    setupHandlers(workspace)
    const handler = (ipcMain as any)._handleMap.get(IPC.WORKSPACE_SET_ACTIVE_PANE) as Function

    const result = handler({}, { workspaceId: 'ws-1', paneId: 'pane-from-elsewhere' })

    expect(result.error).toMatch(/not active/i)
    expect(workspace.activePaneId).toBe('pane-a') // unchanged
    expect(saveWorkspaceMock).not.toHaveBeenCalled()
  })
})
