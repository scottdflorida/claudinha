/**
 * pane-lifecycle tests — regression coverage for closePaneInternal.
 *
 * Specifically guards L-020 for the close path: closing a pane mutates
 * workspace membership via removeDroneFromHive, so closePaneInternal must also
 * broadcast manager state so the Manager window's pane-count stays live.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: { unlink: vi.fn((_p: string, cb: () => void) => cb()) },
  unlink: vi.fn((_p: string, cb: () => void) => cb())
}))

vi.mock('../src/main/session-history-store', () => ({
  addSessionHistoryEntry: vi.fn()
}))

vi.mock('../src/main/analytics/session-instrumentation', () => ({
  deregisterPaneSession: vi.fn(),
  trackSessionCompleted: vi.fn()
}))

vi.mock('../src/main/analytics/usage-instrumentation', () => ({
  trackPaneClosed: vi.fn()
}))

vi.mock('../src/main/constants', () => ({
  getStatuslineTempDir: () => '/tmp/claudinha-test'
}))

import { closePaneInternal } from '../src/main/pane-lifecycle'
import type { PaneState } from '../src/shared/types'

function makePane(overrides: Partial<PaneState> = {}): PaneState {
  return {
    id: 'pane-1',
    windowId: 1,
    workspaceId: 'ws-1',
    repoName: 'repo',
    worktreeName: 'main',
    worktreePath: '/tmp/repo',
    ptyId: 'pty-1',
    sessionId: null,
    transcriptPath: null,
    contextWindowSize: null,
    resolvingConflict: false,
    terminated: false,
    status: 'awaiting-prompt',
    activeToolName: null,
    statusChangedAt: 0,
    statusSource: 'pty-fallback',
    isFocused: false,
    hasUnseenStatusChange: false,
    isApiBilling: false,
    effort: 'medium',
    model: 'sonnet',
    metrics: {
      totalTokens: null,
      contextPercent: null,
      toolsUsed: null,
      totalCostUsd: null,
      durationMs: null,
      modelDisplayName: null,
      linesAdded: null,
      linesRemoved: null,
      sessionTitle: null,
      initialPrompt: null, lastMessage: null
    },
    createdAt: 0,
    gitStatus: null,
    isWorktree: false,
    completionActionStatus: null,
    ...overrides
  } as PaneState
}

function makeDeps(pane: PaneState | null) {
  const pushManagerUpdate = vi.fn()
  const removeDroneFromHive = vi.fn()
  const applyWindowTitle = vi.fn()
  const getWorkspace = vi.fn(() => ({ pausedTerminals: [] }))
  const removePane = vi.fn(() => pane)

  const deps = {
    sessionRegistry: {
      getPane: vi.fn(() => pane),
      removePane,
      getPanesForWindow: vi.fn(() => [])
    } as any,
    windowManager: {
      getWindow: vi.fn(() => ({
        isDestroyed: () => false,
        webContents: { send: vi.fn() }
      }))
    } as any,
    ptyPool: { kill: vi.fn() } as any,
    statusDetector: { deregisterPane: vi.fn() } as any,
    metricsCollector: { unwatchPane: vi.fn() } as any,
    gitStatusPoller: { unwatchPane: vi.fn() } as any,
    transitionBuffer: { clear: vi.fn() } as any,
    workspaceManager: {
      removeDroneFromHive,
      getWorkspace,
      applyWindowTitle,
      pushManagerUpdate
    } as any,
    inspector: undefined
  }
  return { deps, pushManagerUpdate, removeDroneFromHive }
}

describe('closePaneInternal — manager broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('broadcasts manager state after a successful close', () => {
    const pane = makePane()
    const { deps, pushManagerUpdate, removeDroneFromHive } = makeDeps(pane)

    closePaneInternal(deps, 'pane-1')

    expect(removeDroneFromHive).toHaveBeenCalledWith('ws-1', pane)
    expect(pushManagerUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not broadcast when the pane is already gone from the registry', () => {
    const { deps, pushManagerUpdate } = makeDeps(null)

    closePaneInternal(deps, 'pane-missing')

    expect(pushManagerUpdate).not.toHaveBeenCalled()
  })
})
