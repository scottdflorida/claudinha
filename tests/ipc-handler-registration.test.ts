/**
 * IPC Handler Registration Tests — verify that registerIpcHandlers()
 * registers a handler for every channel the renderer can send/invoke.
 */

// Mock all external dependencies BEFORE importing the module under test.
// This is the heaviest mock setup in the test suite because ipc-handlers.ts
// imports many modules at the top level.

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
    BrowserWindow: {
      fromWebContents: vi.fn(() => ({ id: 1 }))
    },
    dialog: { showOpenDialog: vi.fn(() => ({ canceled: true, filePaths: [] })) },
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

// ---------------------------------------------------------------------------
// Channels that need handlers in main process
// ---------------------------------------------------------------------------

/** Fire-and-forget channels (ipcMain.on) — renderer sends, main handles */
const SEND_CHANNELS = [
  IPC.PANE_CLOSE,
  IPC.PANE_INPUT,
  IPC.PANE_RESIZE,
  IPC.PANE_MOVE,
  IPC.PANE_RESPAWN,
  IPC.PANE_EFFORT,
  IPC.PANE_MODEL,
  IPC.PANE_SET_USER_NAME,
  IPC.GLOBAL_EFFORT,
  IPC.WINDOW_NEW,
  IPC.FEEDBACK_SEND,
  IPC.PANE_READY,
  // CLOSE_WORKSPACE_SEQUENCE_RESPONSE / _ACK are handled dynamically per-window in index.ts, skip
  // RENDERER_READY is registered dynamically inside WINDOW_NEW handler, skip
  IPC.MANAGER_FOCUS_WORKSPACE,
  IPC.MANAGER_FOCUS_TERMINAL,
  IPC.COMPLETION_DISMISS
]

/** Invoke channels (ipcMain.handle) — renderer invokes, main responds */
const INVOKE_CHANNELS = [
  IPC.PANE_SPAWN,
  IPC.PANE_CLOSE_WORKTREE,
  IPC.PANE_MERGE_AND_CLOSE,
  IPC.GLOBAL_EFFORT_GET,
  IPC.FOLDER_BROWSE,
  IPC.WORKTREE_LIST,
  IPC.PATH_VALIDATE,
  IPC.WINDOW_LIST,
  // ANALYTICS_GET_CONSENT and ANALYTICS_SET_CONSENT are registered in analytics-config.ts
  IPC.SESSION_HISTORY_LIST,
  IPC.PERMISSIONS_GET_DEFAULTS,
  IPC.PERMISSIONS_GET_EFFECTIVE,
  IPC.PERMISSIONS_SET_SCOPE,
  IPC.PERMISSIONS_RESET_SCOPE,
  IPC.PERMISSIONS_GET_PROJECT_PATHS,
  IPC.PERMISSIONS_GET_KNOWN_RULES,
  IPC.WORKSPACE_CREATE,
  IPC.WORKSPACE_LIST,
  IPC.WORKSPACE_GET,
  IPC.WORKSPACE_ACTIVATE,
  IPC.WORKSPACE_DEACTIVATE,
  IPC.WORKSPACE_DELETE,
  IPC.WORKSPACE_RENAME,
  IPC.WORKSPACE_ARCHIVE,
  IPC.WORKSPACE_UNARCHIVE,
  IPC.WORKSPACE_DELETE_ARCHIVED,
  IPC.WORKSPACE_PAUSED_TERMINALS,
  IPC.WORKSPACE_RESUME_TERMINAL,
  IPC.WORKSPACE_SET_VIEW_MODE,
  IPC.WORKSPACE_SET_ACTIVE_PANE,
  IPC.REPO_PUSH_BASE_BRANCH,
  IPC.REPO_MERGE_AND_PUSH,
  IPC.REPO_RETRY_FAILED_MERGES,
  IPC.REPO_CLAUDE_MD_READ,
  IPC.REPO_CLAUDE_MD_SAVE,
  IPC.REPO_DIFF_GET,
  IPC.GIT_COMMIT_DIRTY_MAIN,
  IPC.GIT_STASH_DIRTY_MAIN,
  IPC.GIT_DISCARD_DIRTY_MAIN,
  IPC.COMPLETION_MERGE,
  IPC.COMPLETION_PR,
  IPC.COMPLETION_ABORT,
  IPC.GH_CLI_CHECK,
  IPC.CLAUDE_CHECK,
  IPC.WORKSPACE_CREATE_WITH_TERMINALS,
  IPC.WORKSPACE_ADD_TERMINALS,
  IPC.WORKSPACE_RESUME_LAST,
  IPC.OPEN_EXTERNAL,
  IPC.PANE_LIST_GET
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const deps = createMockIpcDeps()
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
  })

  describe('fire-and-forget handlers (ipcMain.on)', () => {
    it.each(SEND_CHANNELS)('registers handler for "%s"', (channel) => {
      const onCalls = (ipcMain.on as ReturnType<typeof vi.fn>).mock.calls
      const registered = onCalls.some(([ch]: [string]) => ch === channel)
      expect(registered).withContext(`Missing ipcMain.on("${channel}")`).toBe(true)
    })
  })

  describe('invoke handlers (ipcMain.handle)', () => {
    it.each(INVOKE_CHANNELS)('registers handler for "%s"', (channel) => {
      const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls
      const registered = handleCalls.some(([ch]: [string]) => ch === channel)
      expect(registered).withContext(`Missing ipcMain.handle("${channel}")`).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// PANE_LIST_GET behavior — mount-time seed for usePaneState
//
// Regression guard against the "trees disappeared while PTYs were alive" bug:
// when a workspace renderer remounts (Cmd+R, Fast-Refresh, crash+recover),
// the one-shot PANE_SPAWNED broadcasts are gone and the provider's reducer
// is fresh. The handler must return every live pane for the caller's window
// so the provider can re-seed its state.
// ---------------------------------------------------------------------------

describe('PANE_LIST_GET handler', () => {
  const makePane = (overrides: Record<string, unknown> = {}) => ({
    id: 'p1',
    windowId: '7',
    workspaceId: 'ws-1',
    ptyId: 'pty-1',
    sessionId: null,
    transcriptPath: null,
    contextWindowSize: null,
    repoName: 'repo',
    worktreeName: 'wt',
    worktreePath: '/wt',
    status: 'working',
    activeToolName: 'Read',
    statusChangedAt: Date.now(),
    statusSource: 'hook',
    isFocused: false,
    hasUnseenStatusChange: false,
    isApiBilling: false,
    effort: 'high',
    model: 'opus',
    metrics: {
      totalTokens: 123,
      contextPercent: 5,
      toolsUsed: new Map([['Read', 2]]),
      totalCostUsd: 0.05,
      durationMs: 1000,
      modelDisplayName: 'Opus 4.7',
      linesAdded: 0,
      linesRemoved: 0,
      sessionTitle: null,
      initialPrompt: null
    },
    createdAt: Date.now(),
    terminated: false,
    gitStatus: null,
    isWorktree: true,
    completionActionStatus: null,
    isResolvingConflict: false,
    ...overrides
  })

  it('returns every pane in the caller\'s window, converting metrics to IPC form', async () => {
    const { ipcMain } = await import('electron')
    const deps = createMockIpcDeps()
    // The electron mock returns { id: 1 } from BrowserWindow.fromWebContents,
    // so the handler will look up window "1".
    const paneA = makePane({ id: 'p1', windowId: '1' })
    const paneB = makePane({ id: 'p2', windowId: '1', status: 'done' })
    ;(deps.sessionRegistry.getPanesForWindow as any).mockImplementation((wid: string) =>
      wid === '1' ? [paneA, paneB] : []
    )
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
    const handler = (ipcMain as any)._handleMap.get(IPC.PANE_LIST_GET) as Function
    expect(handler).toBeDefined()
    const result = await handler({ sender: {} as any })
    expect(result.panes).toHaveLength(2)
    expect(result.panes[0].paneId).toBe('p1')
    expect(result.panes[0].status).toBe('working')
    expect(result.panes[0].metrics.toolsUsed).toEqual({ Read: 2 })
    expect(result.panes[1].paneId).toBe('p2')
    expect(result.panes[1].status).toBe('done')
  })

  it('returns an empty list when the caller\'s window has no panes registered', async () => {
    const { ipcMain } = await import('electron')
    const deps = createMockIpcDeps()
    ;(deps.sessionRegistry.getPanesForWindow as any).mockReturnValue([])
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
    const handler = (ipcMain as any)._handleMap.get(IPC.PANE_LIST_GET) as Function
    const result = await handler({ sender: {} as any })
    expect(result.panes).toEqual([])
  })
})

// Custom matcher for better error messages
expect.extend({
  withContext(received: unknown, message: string) {
    return {
      pass: true,
      message: () => message,
      actual: received,
      expected: undefined
    }
  }
})
