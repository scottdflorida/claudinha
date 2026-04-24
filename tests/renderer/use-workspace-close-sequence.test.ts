// @vitest-environment jsdom
/**
 * Tests for useWorkspaceCloseSequence — drives the renderer side of the
 * main-process CLOSE_WORKSPACE_SEQUENCE_* flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { installMockApi, uninstallMockApi } from './helpers/mock-api'
import { useWorkspaceCloseSequence } from '../../src/renderer/hooks/useWorkspaceCloseSequence'
import { IPC } from '../../src/shared/ipc-channels'
import type { CloseSequencePaneDescriptor, CloseWorkspaceSequenceStartPayload } from '../../src/shared/ipc-channels'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePane(overrides: Partial<CloseSequencePaneDescriptor> = {}): CloseSequencePaneDescriptor {
  return {
    paneId: 'p1',
    status: 'working',
    isWorktree: true,
    repoName: 'claudinha',
    agentName: 'feature-x',
    worktreeName: 'wt-featx',
    branchName: 'feature-x',
    hasUncommittedChanges: false,
    changedFileCount: 0,
    commitsAhead: 0,
    isUntouched: false,
    ...overrides
  }
}

function makeSequence(panes: CloseSequencePaneDescriptor[], overrides: Partial<CloseWorkspaceSequenceStartPayload> = {}): CloseWorkspaceSequenceStartPayload {
  return {
    workspaceId: 'w1',
    workspaceName: 'My Workspace',
    panes,
    isManagerInitiated: false,
    managerProgress: null,
    ...overrides
  }
}

let api: ReturnType<typeof installMockApi>
let startListener: ((payload: unknown) => void) | null

beforeEach(() => {
  api = installMockApi()
  startListener = null
  api.on.mockImplementation((channel: string, handler: (payload: unknown) => void) => {
    if (channel === IPC.CLOSE_WORKSPACE_SEQUENCE_START) startListener = handler
  })
})

afterEach(() => {
  cleanup()
  uninstallMockApi()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkspaceCloseSequence', () => {
  it('begins empty — no sequence, empty queue, index 0', () => {
    const { result } = renderHook(() =>
      useWorkspaceCloseSequence({
        resolveBypass: () => ({ kind: 'needs-modal' }),
        onBypass: vi.fn()
      })
    )
    expect(result.current.sequence).toBeNull()
    expect(result.current.queue).toHaveLength(0)
    expect(result.current.currentIndex).toBe(0)
  })

  it('on SEQUENCE_START: acks main + populates queue with panes needing a modal', () => {
    const panes = [makePane({ paneId: 'a' }), makePane({ paneId: 'b' })]
    const { result } = renderHook(() =>
      useWorkspaceCloseSequence({
        resolveBypass: () => ({ kind: 'needs-modal' }),
        onBypass: vi.fn()
      })
    )

    act(() => startListener!(makeSequence(panes)))

    expect(api.send).toHaveBeenCalledWith(IPC.CLOSE_WORKSPACE_SEQUENCE_ACK, { workspaceId: 'w1' })
    expect(result.current.queue.map((p) => p.paneId)).toEqual(['a', 'b'])
    expect(result.current.currentIndex).toBe(0)
    expect(result.current.sequence?.workspaceId).toBe('w1')
  })

  it('filters bypass panes out of the queue and fires onBypass for each', () => {
    const panes = [
      makePane({ paneId: 'untouched', isUntouched: true }),
      makePane({ paneId: 'busy' })
    ]
    const onBypass = vi.fn()
    const { result } = renderHook(() =>
      useWorkspaceCloseSequence({
        resolveBypass: (p) =>
          p.isUntouched
            ? { kind: 'bypass', action: 'prune-close' }
            : { kind: 'needs-modal' },
        onBypass
      })
    )

    act(() => startListener!(makeSequence(panes)))

    expect(result.current.queue.map((p) => p.paneId)).toEqual(['busy'])
    expect(result.current.bypassed.map((p) => p.paneId)).toEqual(['untouched'])
    expect(onBypass).toHaveBeenCalledTimes(1)
    expect(onBypass).toHaveBeenCalledWith(expect.objectContaining({ paneId: 'untouched' }), 'prune-close')
  })

  it('if every pane bypasses, immediately sends complete response and clears state', () => {
    const panes = [
      makePane({ paneId: 'a', isUntouched: true }),
      makePane({ paneId: 'b', isUntouched: true })
    ]
    const { result } = renderHook(() =>
      useWorkspaceCloseSequence({
        resolveBypass: () => ({ kind: 'bypass', action: 'prune-close' }),
        onBypass: vi.fn()
      })
    )

    act(() => startListener!(makeSequence(panes)))

    const completeCall = api.send.mock.calls.find(([ch]) => ch === IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE)
    expect(completeCall).toBeDefined()
    expect(completeCall![1]).toEqual({ workspaceId: 'w1', action: 'complete' })
    expect(result.current.sequence).toBeNull()
  })

  it('advance moves through queue and emits complete at the end', () => {
    const panes = [makePane({ paneId: 'a' }), makePane({ paneId: 'b' }), makePane({ paneId: 'c' })]
    const { result } = renderHook(() =>
      useWorkspaceCloseSequence({
        resolveBypass: () => ({ kind: 'needs-modal' }),
        onBypass: vi.fn()
      })
    )

    act(() => startListener!(makeSequence(panes)))
    expect(result.current.currentIndex).toBe(0)

    act(() => result.current.advance())
    expect(result.current.currentIndex).toBe(1)

    act(() => result.current.advance())
    expect(result.current.currentIndex).toBe(2)

    act(() => result.current.advance())
    // Finished — response sent, state cleared.
    expect(result.current.sequence).toBeNull()
    const responses = api.send.mock.calls.filter(([ch]) => ch === IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE)
    expect(responses[responses.length - 1][1]).toEqual({ workspaceId: 'w1', action: 'complete' })
  })

  it('cancel emits cancel response and clears state', () => {
    const { result } = renderHook(() =>
      useWorkspaceCloseSequence({
        resolveBypass: () => ({ kind: 'needs-modal' }),
        onBypass: vi.fn()
      })
    )

    act(() => startListener!(makeSequence([makePane(), makePane({ paneId: 'b' })])))

    act(() => result.current.cancel())

    const responses = api.send.mock.calls.filter(([ch]) => ch === IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE)
    expect(responses[responses.length - 1][1]).toEqual({ workspaceId: 'w1', action: 'cancel' })
    expect(result.current.sequence).toBeNull()
  })

  it('overrideAll emits override-all response and clears state', () => {
    const { result } = renderHook(() =>
      useWorkspaceCloseSequence({
        resolveBypass: () => ({ kind: 'needs-modal' }),
        onBypass: vi.fn()
      })
    )

    act(() => startListener!(makeSequence([makePane(), makePane({ paneId: 'b' })])))

    act(() => result.current.overrideAll())

    const responses = api.send.mock.calls.filter(([ch]) => ch === IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE)
    expect(responses[responses.length - 1][1]).toEqual({ workspaceId: 'w1', action: 'override-all' })
    expect(result.current.sequence).toBeNull()
  })

  it('advance before a sequence has arrived is a no-op', () => {
    const { result } = renderHook(() =>
      useWorkspaceCloseSequence({
        resolveBypass: () => ({ kind: 'needs-modal' }),
        onBypass: vi.fn()
      })
    )
    act(() => result.current.advance())
    expect(api.send).not.toHaveBeenCalledWith(IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE, expect.anything())
  })
})
