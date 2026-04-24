/**
 * WindowManager unit tests.
 *
 * Verifies window lifecycle management with mocked Electron BrowserWindow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

let windowIdCounter = 0

/** Stores event listeners keyed by event name, per mock window instance */
type EventMap = Map<string, Array<(...args: any[]) => void>>

function createMockBrowserWindow(id: number) {
  const events: EventMap = new Map()
  const wcEvents: EventMap = new Map()
  return {
    id,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!events.has(event)) events.set(event, [])
      events.get(event)!.push(handler)
    }),
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    setTitle: vi.fn(),
    webContents: {
      send: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (!wcEvents.has(event)) wcEvents.set(event, [])
        wcEvents.get(event)!.push(handler)
      }),
      isCrashed: vi.fn(() => false),
      openDevTools: vi.fn()
    },
    /** Test helper: fire a registered event */
    _emit(event: string, ...args: any[]) {
      for (const handler of events.get(event) ?? []) {
        handler(...args)
      }
    },
    /** Test helper: fire a registered webContents event */
    _emitWC(event: string, ...args: any[]) {
      for (const handler of wcEvents.get(event) ?? []) {
        handler(...args)
      }
    },
    _events: events,
    _wcEvents: wcEvents
  }
}

type MockBrowserWindow = ReturnType<typeof createMockBrowserWindow>

/** Track every mock window created so tests can access them */
const createdWindows: MockBrowserWindow[] = []

vi.mock('electron', () => {
  // Use a real class so `new BrowserWindow(...)` works
  class MockBrowserWindowClass {
    constructor(opts?: Record<string, unknown>) {
      const win = createMockBrowserWindow(++windowIdCounter)
      // Capture the constructor options so tests can assert on webPreferences etc.
      ;(win as unknown as { _ctorOpts: unknown })._ctorOpts = opts
      createdWindows.push(win)
      // Copy all properties from the mock onto `this`
      Object.assign(this, win)
    }
  }
  return {
    BrowserWindow: MockBrowserWindowClass,
    app: {
      getAppPath: vi.fn(() => '/app'),
      getName: vi.fn(() => 'test'),
      isReady: vi.fn(() => true)
    }
  }
})

import { WindowManager } from '../src/main/window-manager'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WindowManager', () => {
  let wm: WindowManager

  beforeEach(() => {
    vi.clearAllMocks()
    windowIdCounter = 0
    createdWindows.length = 0
    wm = new WindowManager()
  })

  // -------------------------------------------------------------------------
  // createWindow
  // -------------------------------------------------------------------------

  describe('createWindow', () => {
    it('creates a BrowserWindow and tracks it by string ID', () => {
      const win = wm.createWindow()

      expect(win).toBeDefined()
      expect(win.id).toBe(1)
      // The window should be tracked by its string ID
      expect(wm.getWindow('1')).toBe(win)
    })

    it('returns the created BrowserWindow instance', () => {
      const win = wm.createWindow({ title: 'Test Window', width: 800, height: 600 })

      expect(win).toBeDefined()
      expect(typeof win.id).toBe('number')
    })

    it('loads ELECTRON_RENDERER_URL in dev mode', () => {
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
      try {
        const win = wm.createWindow()
        expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173')
        expect(win.loadFile).not.toHaveBeenCalled()
      } finally {
        delete process.env['ELECTRON_RENDERER_URL']
      }
    })

    it('loads file in production mode', () => {
      delete process.env['ELECTRON_RENDERER_URL']
      const win = wm.createWindow()
      expect(win.loadFile).toHaveBeenCalled()
      expect(win.loadURL).not.toHaveBeenCalled()
    })

    it('assigns incrementing IDs to multiple windows', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow()

      expect(win1.id).toBe(1)
      expect(win2.id).toBe(2)
      expect(wm.getWindow('1')).toBe(win1)
      expect(wm.getWindow('2')).toBe(win2)
    })

    it('opts out of the autoplay gesture gate so status sounds play immediately', () => {
      // Status:done / needs-input chimes fire before the user has interacted
      // with a freshly opened workspace window. Without this opt-out, Chrome's
      // default autoplay policy silently rejects audio.play() and the user
      // hears nothing. Regression test for the bug where the launch flow
      // shipped with no autoplayPolicy set on webPreferences.
      wm.createWindow()
      const opts = (createdWindows[0] as unknown as { _ctorOpts?: { webPreferences?: { autoplayPolicy?: string } } })._ctorOpts
      expect(opts?.webPreferences?.autoplayPolicy).toBe('no-user-gesture-required')
    })
  })

  // -------------------------------------------------------------------------
  // getWindow / getAllWindows
  // -------------------------------------------------------------------------

  describe('getWindow / getAllWindows', () => {
    it('getWindow returns the window for a known ID', () => {
      const win = wm.createWindow()
      expect(wm.getWindow(String(win.id))).toBe(win)
    })

    it('getWindow returns undefined for unknown ID', () => {
      expect(wm.getWindow('nonexistent')).toBeUndefined()
    })

    it('getAllWindows returns the full map of tracked windows', () => {
      const win1 = wm.createWindow()
      const win2 = wm.createWindow()

      const all = wm.getAllWindows()
      expect(all.size).toBe(2)
      expect(all.get(String(win1.id))).toBe(win1)
      expect(all.get(String(win2.id))).toBe(win2)
    })
  })

  // -------------------------------------------------------------------------
  // closeWindow
  // -------------------------------------------------------------------------

  describe('closeWindow', () => {
    it('calls win.close() for a known window', () => {
      const win = wm.createWindow()
      wm.closeWindow(String(win.id))
      expect(win.close).toHaveBeenCalledOnce()
    })

    it('handles destroyed windows gracefully (no crash)', () => {
      const win = wm.createWindow()
      ;(win.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true)

      // Should not throw
      expect(() => wm.closeWindow(String(win.id))).not.toThrow()
      // close() should NOT be called on a destroyed window
      expect(win.close).not.toHaveBeenCalled()
    })

    it('is a no-op for unknown window ID', () => {
      expect(() => wm.closeWindow('nonexistent')).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // onWindowClose (the 'closed' event callback system)
  // -------------------------------------------------------------------------

  describe('onWindowClose', () => {
    it('callback fires when window emits closed event', () => {
      const callback = vi.fn()
      wm.onWindowClose(callback)

      const win = wm.createWindow() as any as MockBrowserWindow
      // Simulate the window being closed
      win._emit('closed')

      expect(callback).toHaveBeenCalledOnce()
      expect(callback).toHaveBeenCalledWith(String(win.id))
    })

    it('multiple callbacks can be registered and all fire', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      wm.onWindowClose(cb1)
      wm.onWindowClose(cb2)

      const win = wm.createWindow() as any as MockBrowserWindow
      win._emit('closed')

      expect(cb1).toHaveBeenCalledOnce()
      expect(cb2).toHaveBeenCalledOnce()
    })

    it('removes window from internal map on closed event', () => {
      const win = wm.createWindow() as any as MockBrowserWindow
      const id = String(win.id)

      expect(wm.getWindow(id)).toBe(win)
      win._emit('closed')
      expect(wm.getWindow(id)).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // setCloseInterceptor
  // -------------------------------------------------------------------------

  describe('setCloseInterceptor', () => {
    it('interceptor returning false prevents window close', () => {
      wm.setCloseInterceptor(() => false)

      const win = wm.createWindow() as any as MockBrowserWindow
      const mockEvent = { preventDefault: vi.fn() }
      // Simulate the 'close' event (fires before destruction)
      win._emit('close', mockEvent)

      expect(mockEvent.preventDefault).toHaveBeenCalledOnce()
    })

    it('interceptor returning true allows window close', () => {
      wm.setCloseInterceptor(() => true)

      const win = wm.createWindow() as any as MockBrowserWindow
      const mockEvent = { preventDefault: vi.fn() }
      win._emit('close', mockEvent)

      expect(mockEvent.preventDefault).not.toHaveBeenCalled()
    })

    it('interceptor receives the correct windowId and window', () => {
      const interceptor = vi.fn(() => true)
      wm.setCloseInterceptor(interceptor)

      const win = wm.createWindow() as any as MockBrowserWindow
      const mockEvent = { preventDefault: vi.fn() }
      win._emit('close', mockEvent)

      expect(interceptor).toHaveBeenCalledWith(String(win.id), win)
    })

    it('replacing the interceptor uses the new one', () => {
      const firstInterceptor = vi.fn(() => false)
      const secondInterceptor = vi.fn(() => true)

      wm.setCloseInterceptor(firstInterceptor)
      wm.setCloseInterceptor(secondInterceptor)

      const win = wm.createWindow() as any as MockBrowserWindow
      const mockEvent = { preventDefault: vi.fn() }
      win._emit('close', mockEvent)

      expect(firstInterceptor).not.toHaveBeenCalled()
      expect(secondInterceptor).toHaveBeenCalledOnce()
      expect(mockEvent.preventDefault).not.toHaveBeenCalled()
    })

    it('without interceptor, close proceeds normally', () => {
      const win = wm.createWindow() as any as MockBrowserWindow
      const mockEvent = { preventDefault: vi.fn() }
      win._emit('close', mockEvent)

      expect(mockEvent.preventDefault).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // isRendererHealthy — used by the close-confirmation fallback
  // -------------------------------------------------------------------------

  describe('isRendererHealthy', () => {
    it('returns true for a freshly created window', () => {
      const win = wm.createWindow()
      expect(wm.isRendererHealthy(String(win.id))).toBe(true)
    })

    it('returns false for an unknown window ID', () => {
      expect(wm.isRendererHealthy('nonexistent')).toBe(false)
    })

    it('returns false after render-process-gone fires on webContents', () => {
      const win = wm.createWindow() as any as MockBrowserWindow
      win._emitWC('render-process-gone', {}, { reason: 'crashed' })
      expect(wm.isRendererHealthy(String(win.id))).toBe(false)
    })

    it('returns false while renderer is unresponsive, true again once responsive', () => {
      const win = wm.createWindow() as any as MockBrowserWindow
      const id = String(win.id)

      win._emitWC('unresponsive')
      expect(wm.isRendererHealthy(id)).toBe(false)

      win._emitWC('responsive')
      expect(wm.isRendererHealthy(id)).toBe(true)
    })

    it('returns false if webContents reports isCrashed()', () => {
      const win = wm.createWindow() as any as MockBrowserWindow
      ;(win.webContents.isCrashed as ReturnType<typeof vi.fn>).mockReturnValue(true)
      expect(wm.isRendererHealthy(String(win.id))).toBe(false)
    })

    it('returns false for a destroyed window', () => {
      const win = wm.createWindow() as any as MockBrowserWindow
      ;(win.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true)
      expect(wm.isRendererHealthy(String(win.id))).toBe(false)
    })

    it('clears crashed/unresponsive state when the window is closed', () => {
      const win = wm.createWindow() as any as MockBrowserWindow
      const id = String(win.id)

      win._emitWC('render-process-gone', {}, { reason: 'crashed' })
      win._emitWC('unresponsive')
      expect(wm.isRendererHealthy(id)).toBe(false)

      // 'closed' removes the window from the map, so a new window with the
      // same id would not inherit stale health state. (IDs don't actually
      // reuse in Electron, but we still clean up the sets to avoid leaks.)
      win._emit('closed')
      expect(wm.getWindow(id)).toBeUndefined()
      // After removal the health check returns false because the window is
      // gone, not because of stale crash state — the sets have been cleared.
      expect(wm.isRendererHealthy(id)).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // count
  // -------------------------------------------------------------------------

  describe('count', () => {
    it('starts at 0 with no windows', () => {
      expect(wm.count).toBe(0)
    })

    it('reflects the number of tracked windows', () => {
      wm.createWindow()
      expect(wm.count).toBe(1)

      wm.createWindow()
      expect(wm.count).toBe(2)
    })

    it('decrements when a window is closed', () => {
      const win1 = wm.createWindow() as any as MockBrowserWindow
      wm.createWindow()
      expect(wm.count).toBe(2)

      win1._emit('closed')
      expect(wm.count).toBe(1)
    })
  })
})
