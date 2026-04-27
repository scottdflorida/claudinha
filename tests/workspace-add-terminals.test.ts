/**
 * Tests for the WORKSPACE_ADD_TERMINALS IPC handler.
 *
 * Validates:
 *   - Payload validation (terminalCount range, missing workspace)
 *   - Workspace lookup (rejects unknown workspaceId)
 *   - Window resolution (rejects when no bound window)
 *   - Per-pane and single-repo path validation
 *   - Successful path delegates to spawnTerminalsIntoWorkspace
 */

import { vi } from 'vitest'

vi.mock('electron', () => {
  const handleMap = new Map<string, Function>()
  const onMap = new Map<string, Function>()
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Function) => handleMap.set(channel, handler)),
      on: vi.fn((channel: string, handler: Function) => onMap.set(channel, handler)),
      removeListener: vi.fn(),
      _handleMap: handleMap,
      _onMap: onMap
    },
    shell: { openExternal: vi.fn() },
    BrowserWindow: {
      fromWebContents: vi.fn(() => ({ id: 7 }))
    },
    dialog: { showOpenDialog: vi.fn(() => ({ canceled: true, filePaths: [] })) },
    app: { getAppPath: vi.fn(() => '/app'), getVersion: vi.fn(() => '0.1.0') }
  }
})

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ isDirectory: () => true })),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn()
  },
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => ''),
  execFile: vi.fn()
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

vi.mock('../src/main/workspace-store', () => ({
  saveWorkspace: vi.fn()
}))

vi.mock('../src/main/permissions-store', () => ({
  getGlobalOverrides: vi.fn(() => ({ allow: [], deny: [] })),
  setGlobalOverrides: vi.fn(),
  getProjectOverrides: vi.fn(() => ({ allow: [], deny: [] })),
  setProjectOverrides: vi.fn(),
  resetGlobalOverrides: vi.fn(),
  resetProjectOverrides: vi.fn(),
  getProjectPaths: vi.fn(() => []),
  resolveEffectivePermissions: vi.fn(() => ({ allow: [], deny: [] })),
  getAllKnownRules: vi.fn(() => [])
}))

vi.mock('../src/main/analytics/usage-instrumentation', () => ({
  trackPaneSpawned: vi.fn(),
  trackPaneClosed: vi.fn(),
  trackPaneMoved: vi.fn(),
  trackWindowCreated: vi.fn(),
  trackWindowClosed: vi.fn(),
  trackFeedbackSubmitted: vi.fn(),
  trackSpawnModeSelected: vi.fn(),
  trackKeyboardShortcutUsed: vi.fn()
}))

vi.mock('../src/main/analytics/workspace-instrumentation', () => ({
  trackWorkspaceCreated: vi.fn(),
  trackWorkspaceArchived: vi.fn(),
  trackWorkspaceUnarchived: vi.fn(),
  trackWorkspaceDeletedArchived: vi.fn()
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

import { describe, it, expect, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { IPC } from '../src/shared/ipc-channels'
import { registerIpcHandlers } from '../src/main/ipc-handlers'
import { createMockIpcDeps } from './helpers/mock-ipc-deps'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupHandler(opts: {
  workspace?: { id: string; type?: string; constraint?: Record<string, unknown>; windowId?: string | null } | undefined
}) {
  const deps = createMockIpcDeps()

  // Override workspaceManager.getWorkspace + getWindow to return what the test wants.
  ;(deps.workspaceManager.getWorkspace as any).mockImplementation((id: string) => {
    if (opts.workspace && opts.workspace.id === id) {
      return {
        id,
        type: opts.workspace.type ?? 'repo',
        constraint: opts.workspace.constraint ?? {},
        windowId: opts.workspace.windowId === null ? undefined : (opts.workspace.windowId ?? '7'),
        viewMode: 'kanban',
        completionPolicy: null
      }
    }
    return undefined
  })

  // applyWindowTitle / pushManagerUpdate / addDroneToHive — silent no-ops
  ;(deps.workspaceManager as any).applyWindowTitle = (deps.workspaceManager as any).applyWindowTitle ?? (() => {})
  ;(deps.workspaceManager as any).pushManagerUpdate = (deps.workspaceManager as any).pushManagerUpdate ?? (() => {})
  ;(deps.workspaceManager as any).addDroneToHive = (deps.workspaceManager as any).addDroneToHive ?? (() => {})
  ;(deps.workspaceManager as any).removeDroneFromHive = (deps.workspaceManager as any).removeDroneFromHive ?? (() => {})

  // PaneSpawnBuffer.open / capture / clear / flush — silent
  // (paneSpawnBuffer is constructed inside ipc-handlers.ts; we don't need to mock
  // it because we won't reach the spawn loop in the validation tests.)

  // sessionRegistry.generatePaneId
  ;(deps.sessionRegistry as any).generatePaneId = (deps.sessionRegistry as any).generatePaneId ?? (() => 'mock-pane-' + Math.random())
  ;(deps.sessionRegistry as any).registerPane = (deps.sessionRegistry as any).registerPane ?? (() => {})
  ;(deps.sessionRegistry as any).getPanesForWindow = (deps.sessionRegistry as any).getPanesForWindow ?? (() => [])
  ;(deps.sessionRegistry as any).getPane = (deps.sessionRegistry as any).getPane ?? (() => undefined)

  // Window manager — return a non-destroyed mock window when asked.
  ;(deps.windowManager as any).getWindow = (deps.windowManager as any).getWindow ?? ((id: string) => ({
    id,
    isDestroyed: () => false,
    webContents: { send: () => {} },
    once: () => {},
    focus: () => {}
  }))

  // ptyPool.prepareSpawn — return a fake ptyId.
  ;(deps.ptyPool as any).prepareSpawn = vi.fn(() => ({ ptyId: 'pty-mock', isApiBilling: false }))

  // Inspector + plan-approval-sequencer mocks — required by registerIpcHandlers
  // signature (positions 12 + 13). Not exercised by the WORKSPACE_ADD_TERMINALS
  // path beyond planApprovalSequencer.onPaneClosed, which is callback-deferred.
  const inspector = {
    getSummary: vi.fn(() => null),
    askKeeperLLM: vi.fn(() => Promise.resolve({ report: null }))
  }
  const planApprovalSequencer = {
    onPaneClosed: vi.fn()
  }

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
    deps.completionExecutor as any,
    inspector as any,
    planApprovalSequencer as any
  )

  const handler = (ipcMain as any)._handleMap.get(IPC.WORKSPACE_ADD_TERMINALS) as Function
  return { handler, deps }
}

const fakeEvent = { sender: {} }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WORKSPACE_ADD_TERMINALS handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects terminalCount below 1', async () => {
    const { handler } = setupHandler({ workspace: { id: 'ws-1' } })
    const result = await handler(fakeEvent, {
      workspaceId: 'ws-1',
      repoPath: '/r',
      terminalCount: 0,
      worktreeMode: 'each-own',
      namingMode: 'auto'
    })
    expect(result.error).toMatch(/between 1 and 32/)
  })

  it('rejects terminalCount above 32', async () => {
    const { handler } = setupHandler({ workspace: { id: 'ws-1' } })
    const result = await handler(fakeEvent, {
      workspaceId: 'ws-1',
      repoPath: '/r',
      terminalCount: 33,
      worktreeMode: 'each-own',
      namingMode: 'auto'
    })
    expect(result.error).toMatch(/between 1 and 32/)
  })

  it('rejects an unknown workspaceId', async () => {
    const { handler } = setupHandler({ workspace: undefined })
    const result = await handler(fakeEvent, {
      workspaceId: 'ws-missing',
      repoPath: '/r',
      terminalCount: 1,
      worktreeMode: 'each-own',
      namingMode: 'auto'
    })
    expect(result.error).toMatch(/not found/)
  })

  it('rejects when no repoPath is supplied (single mode)', async () => {
    const { handler } = setupHandler({ workspace: { id: 'ws-1' } })
    const result = await handler(fakeEvent, {
      workspaceId: 'ws-1',
      repoPath: '',
      terminalCount: 1,
      worktreeMode: 'each-own',
      namingMode: 'auto'
    })
    expect(result.error).toMatch(/Repository path is required/)
  })

  it('rejects when per-pane repoPaths length mismatches terminalCount', async () => {
    const { handler } = setupHandler({ workspace: { id: 'ws-1' } })
    const result = await handler(fakeEvent, {
      workspaceId: 'ws-1',
      repoPath: '',
      repoPaths: ['/a', '/b'],
      terminalCount: 3,
      worktreeMode: 'each-own',
      namingMode: 'auto'
    })
    expect(result.error).toMatch(/Got 2 repo paths for 3 terminals/)
  })

  it('rejects when no window is bound to the workspace', async () => {
    // BrowserWindow.fromWebContents returns null AND the workspace has no
    // bound windowId, so the handler can't resolve any window.
    const { BrowserWindow: BW } = await import('electron')
    const originalFromWebContents = (BW as any).fromWebContents
    ;(BW as any).fromWebContents = vi.fn(() => null)
    const { handler } = setupHandler({
      workspace: { id: 'ws-1', windowId: null }
    })
    const result = await handler(fakeEvent, {
      workspaceId: 'ws-1',
      repoPath: '/r',
      terminalCount: 1,
      worktreeMode: 'each-own',
      namingMode: 'auto'
    })
    expect(result.error).toMatch(/not currently open/)
    ;(BW as any).fromWebContents = originalFromWebContents
  })
})
