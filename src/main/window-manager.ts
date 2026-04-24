import { BrowserWindow, app } from 'electron'
import { join } from 'path'

/** Called when a BrowserWindow is closed, with the string window ID */
type WindowCloseCallback = (windowId: string) => void

/**
 * Called before a window is about to close.
 * Return true to allow the close; false to cancel it.
 * The callback may show blocking UI (e.g. a confirmation dialog).
 */
type CloseInterceptor = (windowId: string, win: BrowserWindow) => boolean

/**
 * WindowManager — creates and tracks all BrowserWindows.
 *
 * Responsibilities:
 * - Creating BrowserWindows with consistent settings (preload, title, bg color)
 * - Tracking windows by string ID (String(win.id), matching PRD WindowState.id)
 * - Emitting close callbacks so the IPC handler layer can clean up pane state
 *
 * A single instance is created in index.ts and shared across the app.
 */
/** Options for creating a new BrowserWindow */
export interface CreateWindowOptions {
  /** Window title (defaults to 'Claudinha') */
  title?: string
  /** Window width in pixels (defaults to 1200) */
  width?: number
  /** Window height in pixels (defaults to 800) */
  height?: number
}

export class WindowManager {
  private readonly windows = new Map<string, BrowserWindow>()
  private readonly closeCallbacks: WindowCloseCallback[] = []
  private closeInterceptor: CloseInterceptor | null = null
  /**
   * Tracks windows whose renderer has crashed or gone unresponsive.
   * Used by the close-confirmation flow to fall back to a native dialog
   * when the in-renderer modal cannot be shown.
   */
  private readonly crashedWindows = new Set<string>()
  private readonly unresponsiveWindows = new Set<string>()

  /**
   * Creates a new BrowserWindow, loads the renderer, registers it in the
   * internal map, and wires the 'closed' event for cleanup.
   */
  createWindow(options?: CreateWindowOptions): BrowserWindow {
    const iconPath = join(app.getAppPath(), 'assets', 'icons', 'icon.png')

    const win = new BrowserWindow({
      width: options?.width ?? 1200,
      height: options?.height ?? 800,
      minWidth: 400,
      minHeight: 300,
      title: options?.title ?? 'Claudinha',
      titleBarStyle: 'hidden',
      // Vertically centered in the 32px custom title bar (10px above + 12px button + 10px below)
      trafficLightPosition: { x: 12, y: 10 },
      backgroundColor: '#000000',
      icon: iconPath,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        // Claudinha plays short UI feedback sounds (status:done / needs-input)
        // before the user has interacted with a freshly opened workspace window.
        // The default Chrome autoplay policy blocks those, so playStatusSound
        // silently fails. This is safe — sounds are local UI cues, not media.
        autoplayPolicy: 'no-user-gesture-required'
      }
    })

    const id = String(win.id)
    this.windows.set(id, win)

    // electron-vite injects ELECTRON_RENDERER_URL in dev mode for HMR
    if (process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    // 'close' fires before destruction — can be cancelled by interceptor (B-051)
    win.on('close', (event) => {
      if (this.closeInterceptor && !this.closeInterceptor(id, win)) {
        event.preventDefault()
      }
    })

    // Track renderer health so the close interceptor can fall back to a
    // native dialog when the in-app confirmation modal cannot be shown
    // (e.g. the renderer crashed during dev while editing its own source).
    win.webContents.on('unresponsive', () => this.unresponsiveWindows.add(id))
    win.webContents.on('responsive', () => this.unresponsiveWindows.delete(id))
    win.webContents.on('render-process-gone', () => this.crashedWindows.add(id))

    // 'closed' fires after the window is destroyed — safe to remove from map
    win.on('closed', () => {
      this.windows.delete(id)
      this.crashedWindows.delete(id)
      this.unresponsiveWindows.delete(id)
      for (const cb of this.closeCallbacks) {
        cb(id)
      }
    })

    return win
  }

  /** Returns the BrowserWindow for the given string ID, or undefined */
  getWindow(id: string): BrowserWindow | undefined {
    return this.windows.get(id)
  }

  /**
   * Returns all currently open windows as a read-only Map.
   * Used by IPC handlers to enumerate windows (e.g. for WindowPicker).
   */
  getAllWindows(): ReadonlyMap<string, BrowserWindow> {
    return this.windows
  }

  /**
   * Closes the specified window. If the window is already destroyed, no-ops.
   * This triggers the 'closed' event which removes it from the map.
   */
  closeWindow(id: string): void {
    const win = this.windows.get(id)
    if (win && !win.isDestroyed()) {
      win.close()
    }
  }

  /**
   * Registers a callback to be invoked whenever any window is closed.
   * Used by IPC handlers to clean up pane/PTY state for that window.
   */
  onWindowClose(callback: WindowCloseCallback): void {
    this.closeCallbacks.push(callback)
  }

  /**
   * Set a close interceptor that is called before each window closes.
   * Return true to allow the close, false to cancel it.
   * Only one interceptor is supported; calling again replaces the previous one.
   */
  setCloseInterceptor(interceptor: CloseInterceptor): void {
    this.closeInterceptor = interceptor
  }

  /** Returns the number of currently open windows */
  get count(): number {
    return this.windows.size
  }

  /**
   * Returns true if the window's renderer is alive and responsive.
   *
   * Used by the close-confirmation flow: if the renderer has crashed or
   * hung, sending `CONFIRM_CLOSE_SESSIONS` over IPC will never produce a
   * response and the window becomes uncloseable. Callers fall back to a
   * native OS dialog in that case.
   */
  isRendererHealthy(id: string): boolean {
    if (this.crashedWindows.has(id) || this.unresponsiveWindows.has(id)) return false
    const win = this.windows.get(id)
    if (!win || win.isDestroyed()) return false
    // Belt-and-suspenders: webContents.isCrashed() catches the window created
    // in a crashed state before our 'render-process-gone' listener attached.
    return !win.webContents.isCrashed()
  }
}
