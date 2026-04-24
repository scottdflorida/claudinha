import { vi } from 'vitest'

export function createMockWindowManager() {
  const sendSpy = vi.fn()
  const focusSpy = vi.fn()
  const setTitleSpy = vi.fn()
  const mockWindow = {
    id: 'win-1',
    isDestroyed: vi.fn(() => false),
    focus: focusSpy,
    setTitle: setTitleSpy,
    webContents: { send: sendSpy }
  }
  const windowsMap = new Map([['win-1', mockWindow]])
  let nextWindowId = 2
  return {
    getWindow: vi.fn(() => mockWindow),
    getAllWindows: vi.fn(() => windowsMap),
    createWindow: vi.fn(() => {
      const id = `win-${nextWindowId++}`
      const win = {
        id,
        isDestroyed: vi.fn(() => false),
        focus: vi.fn(),
        setTitle: vi.fn(),
        webContents: { send: vi.fn() }
      }
      windowsMap.set(id, win as any)
      return win
    }),
    get count() { return windowsMap.size },
    _sendSpy: sendSpy,
    _focusSpy: focusSpy,
    _setTitleSpy: setTitleSpy,
    _mockWindow: mockWindow,
    _windowsMap: windowsMap
  }
}
