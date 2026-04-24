import { dialog, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getAppConfig } from './app-config-store'
import { getMenuStrings } from './menu-strings'

// ---------------------------------------------------------------------------
// Auto-update (B-073)
// Checks GitHub Releases on launch. No forced updates — user controls install.
// ---------------------------------------------------------------------------

export function initAutoUpdater(): void {
  // Disable automatic download — only download when user confirms
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const m = getMenuStrings(getAppConfig().language)
    dialog
      .showMessageBox({
        type: 'info',
        title: m.updateAvailableTitle,
        message: m.updateAvailableMessage(info.version),
        detail: m.updateAvailableDetail,
        buttons: [m.updateAvailableButtonDownload, m.updateAvailableButtonLater],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate()
        }
      })
  })

  autoUpdater.on('update-downloaded', () => {
    const m = getMenuStrings(getAppConfig().language)
    dialog
      .showMessageBox({
        type: 'info',
        title: m.updateReadyTitle,
        message: m.updateReadyMessage,
        detail: m.updateReadyDetail,
        buttons: [m.updateReadyButtonRestart, m.updateReadyButtonLater],
        defaultId: 0,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] error:', err?.message ?? err)
  })

  // Check after a short delay so the main window has time to appear
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[auto-updater] checkForUpdates failed:', err?.message ?? err)
    })
  }, 5000)
}

// Expose version for the About menu / IPC
export function getAppVersion(): string {
  return app.getVersion()
}
