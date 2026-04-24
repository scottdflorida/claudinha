// @vitest-environment jsdom
/**
 * Tests for useIpc hooks — ipcSend, ipcInvoke, and useIpcListener.
 */

import { renderHook, act, cleanup } from '@testing-library/react'
import { createMockApi } from './helpers/mock-api'
import { ipcSend, ipcInvoke, useIpcListener } from '../../src/renderer/hooks/useIpc'
import { IPC } from '../../src/shared/ipc-channels'

let mockApi: ReturnType<typeof createMockApi>

beforeEach(() => {
  mockApi = createMockApi()
  ;(window as any).api = mockApi
})

afterEach(() => {
  // cleanup MUST happen while window.api still exists (React effects call window.api.off)
  cleanup()
  delete (window as any).api
})

// ---------------------------------------------------------------------------
// ipcSend
// ---------------------------------------------------------------------------

describe('ipcSend', () => {
  it('delegates to window.api.send', () => {
    ipcSend(IPC.PANE_INPUT, { paneId: 'p1', data: 'hello' })
    expect(mockApi.send).toHaveBeenCalledWith(IPC.PANE_INPUT, { paneId: 'p1', data: 'hello' })
  })

  it('works without a payload', () => {
    ipcSend(IPC.RENDERER_READY)
    expect(mockApi.send).toHaveBeenCalledWith(IPC.RENDERER_READY, undefined)
  })
})

// ---------------------------------------------------------------------------
// ipcInvoke
// ---------------------------------------------------------------------------

describe('ipcInvoke', () => {
  it('delegates to window.api.invoke and returns promise', async () => {
    mockApi.invoke.mockResolvedValue({ result: 'ok' })
    const result = await ipcInvoke(IPC.WORKSPACE_LIST, {})
    expect(mockApi.invoke).toHaveBeenCalledWith(IPC.WORKSPACE_LIST, {})
    expect(result).toEqual({ result: 'ok' })
  })
})

// ---------------------------------------------------------------------------
// useIpcListener
// ---------------------------------------------------------------------------

describe('useIpcListener', () => {
  it('registers listener on mount via window.api.on', () => {
    const listener = vi.fn()
    renderHook(() => useIpcListener(IPC.PANE_STATUS, listener))
    expect(mockApi.on).toHaveBeenCalledWith(IPC.PANE_STATUS, expect.any(Function))
  })

  it('deregisters listener on unmount via window.api.off', () => {
    const listener = vi.fn()
    const { unmount } = renderHook(() => useIpcListener(IPC.PANE_STATUS, listener))
    const registeredStable = mockApi.on.mock.calls[0][1]
    unmount()
    expect(mockApi.off).toHaveBeenCalledWith(IPC.PANE_STATUS, registeredStable)
  })

  it('calls listener when payload arrives', () => {
    const listener = vi.fn()
    renderHook(() => useIpcListener(IPC.PANE_STATUS, listener))

    // Simulate main process sending a message
    const stable = mockApi.on.mock.calls[0][1]
    act(() => {
      stable({ paneId: 'p1', status: 'done' })
    })

    expect(listener).toHaveBeenCalledWith({ paneId: 'p1', status: 'done' })
  })

  it('does not re-register when inline listener changes', () => {
    const { rerender } = renderHook(() => {
      useIpcListener(IPC.PANE_STATUS, () => {})
    })

    expect(mockApi.on).toHaveBeenCalledTimes(1)
    rerender()
    expect(mockApi.on).toHaveBeenCalledTimes(1)
  })
})
