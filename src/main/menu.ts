import { app, BrowserWindow, Menu } from 'electron'
import type { WindowManager } from './window-manager'
import type { SessionRegistry } from './session-registry'
import type { WorkspaceManager } from './workspace-manager'
import { IPC } from '../shared/ipc-channels'
import { getAppConfig } from './app-config-store'
import { getMenuStrings } from './menu-strings'

// ---------------------------------------------------------------------------
// Application menu bar (B-066)
// ---------------------------------------------------------------------------

/**
 * Build and set the application menu.
 *
 * Called once after app.whenReady(). Must be rebuilt whenever the window list
 * changes (for the Window submenu) — call buildMenu() again in that case.
 *
 * Menu structure:
 *   [macOS app menu] (name, About, Quit)
 *   File            — New Pane, New Window, ─, Close Pane, Close Window, ─, Quit
 *   Edit            — Copy, Paste, Select All
 *   View            — Reload, Developer Tools, ─, Zoom, ─, Fullscreen
 *   Window          — Minimize, Zoom, ─, [open windows]
 *   Help            — Feedback, ─, About, Website
 */
export function buildMenu(
  windowManager: WindowManager,
  sessionRegistry: SessionRegistry,
  workspaceManager?: WorkspaceManager
): void {
  const isMac = process.platform === 'darwin'
  const m = getMenuStrings(getAppConfig().language)

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS application menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),

    // File
    {
      label: m.fileMenu,
      submenu: [
        {
          label: m.newTerminal,
          accelerator: isMac ? 'CmdOrCtrl+Shift+N' : 'Alt+Shift+N',
          click: (_item, browserWindow) => {
            if (browserWindow instanceof BrowserWindow) {
              browserWindow.webContents.send(IPC.MENU_NEW_PANE)
            }
          }
        },
        {
          label: m.newWorkspace,
          accelerator: isMac ? 'CmdOrCtrl+Shift+T' : 'Alt+Shift+T',
          click: (_item, browserWindow) => {
            // Send window:new which now creates a general workspace
            if (browserWindow instanceof BrowserWindow) {
              browserWindow.webContents.send(IPC.WINDOW_NEW, {})
            }
          }
        },
        { type: 'separator' },
        {
          label: m.clearPane,
          accelerator: isMac ? 'CmdOrCtrl+Shift+W' : 'Alt+Shift+W',
          click: (_item, browserWindow) => {
            if (browserWindow instanceof BrowserWindow) {
              browserWindow.webContents.send(IPC.MENU_CLOSE_PANE)
            }
          }
        },
        {
          label: m.closeWorkspace,
          accelerator: isMac ? 'CmdOrCtrl+W' : 'Alt+F4',
          click: (_item, browserWindow) => {
            if (browserWindow instanceof BrowserWindow) {
              browserWindow.close()
            }
          }
        },
        { type: 'separator' },
        isMac
          ? { role: 'quit' as const }
          : {
              label: m.quit,
              accelerator: 'CmdOrCtrl+Q',
              click: () => app.quit()
            }
      ]
    },

    // Edit
    {
      label: m.editMenu,
      submenu: [
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },

    // View
    {
      label: m.viewMenu,
      submenu: [
        { role: 'reload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' },
        { role: 'togglefullscreen' as const }
      ]
    },

    // Window
    {
      label: m.windowMenu,
      submenu: [
        {
          label: m.showManagement,
          click: () => {
            if (workspaceManager?.managerWindowId) {
              const win = windowManager.getWindow(workspaceManager.managerWindowId)
              if (win && !win.isDestroyed()) {
                if (win.isMinimized()) win.restore()
                win.focus()
              }
            }
          }
        },
        { type: 'separator' },
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        { type: 'separator' },
        ...(isMac
          ? [
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ]
          : [])
      ]
    },

    // Help
    {
      label: m.helpMenu,
      submenu: [
        {
          label: m.sendFeedback,
          accelerator: isMac ? 'CmdOrCtrl+Shift+I' : 'Alt+Shift+I',
          click: (_item, browserWindow) => {
            if (browserWindow instanceof BrowserWindow) {
              browserWindow.webContents.send(IPC.MENU_FEEDBACK)
            }
          }
        },
        {
          label: m.analytics,
          click: (_item, browserWindow) => {
            if (browserWindow instanceof BrowserWindow) {
              browserWindow.webContents.send(IPC.MENU_ANALYTICS)
            }
          }
        },
        { type: 'separator' },
        {
          label: m.aboutClaudinha,
          click: () => {
            app.showAboutPanel()
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

