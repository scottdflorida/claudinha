import { vi } from 'vitest'
import { createMockRegistry } from './mock-registry'
import { createMockWindowManager } from './mock-window-manager'

/**
 * Factory returning all 11 singleton mocks needed by registerIpcHandlers().
 * Reuses createMockRegistry() and createMockWindowManager() for the two
 * complex dependencies; lightweight vi.fn() stubs for the rest.
 */
export function createMockIpcDeps() {
  const registry = createMockRegistry()
  const windowManager = createMockWindowManager()

  return {
    windowManager,
    sessionRegistry: registry,
    ptyPool: {
      spawn: vi.fn(() => ({ ptyId: 'mock-pty-id', isApiBilling: false })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      killAll: vi.fn(),
      isAlive: vi.fn(() => true),
      getPty: vi.fn()
    },
    hookListener: {
      registerPane: vi.fn(),
      deregisterPane: vi.fn()
    },
    permissionsManager: {
      writeForPane: vi.fn(),
      getDefaults: vi.fn(() => ({ allow: [], deny: [] })),
      getEffective: vi.fn(() => ({ allow: [], deny: [] })),
      setScope: vi.fn(),
      resetScope: vi.fn(),
      getProjectPaths: vi.fn(() => [])
    },
    statusDetector: {
      watchPane: vi.fn(),
      unwatchPane: vi.fn()
    },
    metricsCollector: {
      watchPane: vi.fn(),
      unwatchPane: vi.fn()
    },
    transitionBuffer: {
      push: vi.fn(),
      drain: vi.fn(() => [])
    },
    workspaceManager: {
      createWorkspace: vi.fn(() => ({ workspaceId: 'mock-workspace', error: null })),
      getWorkspace: vi.fn(),
      listWorkspaces: vi.fn(() => []),
      activateWorkspace: vi.fn(),
      deactivateWorkspace: vi.fn(),
      deleteWorkspace: vi.fn(),
      addPaneToHive: vi.fn(),
      removePaneFromHive: vi.fn(),
      getPausedTerminals: vi.fn(() => []),
      recoverState: vi.fn(),
      getHiveForPane: vi.fn()
    },
    gitStatusPoller: {
      watchPane: vi.fn(),
      unwatchPane: vi.fn(),
      triggerCheck: vi.fn(),
      dispose: vi.fn()
    },
    completionExecutor: {
      executeMerge: vi.fn(() => ({ error: null })),
      executePr: vi.fn(() => ({ error: null })),
      abortOperation: vi.fn(() => ({ error: null })),
      dismiss: vi.fn()
    }
  }
}
