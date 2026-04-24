/**
 * Auto-updater tests — verify configuration and event handler registration.
 */

const mockAutoUpdater = vi.hoisted(() => ({
  autoDownload: true,
  autoInstallOnAppQuit: false,
  on: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve()),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: vi.fn(() => Promise.resolve({ response: 1 }))
  },
  app: {
    getVersion: vi.fn(() => '0.1.0')
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater
}))

import { initAutoUpdater, getAppVersion } from '../src/main/auto-updater'
import { dialog } from 'electron'

describe('initAutoUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockAutoUpdater.autoDownload = true
    mockAutoUpdater.autoInstallOnAppQuit = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('disables autoDownload and enables autoInstallOnAppQuit', () => {
    initAutoUpdater()
    expect(mockAutoUpdater.autoDownload).toBe(false)
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('registers handlers for update-available, update-downloaded, and error', () => {
    initAutoUpdater()
    const events = mockAutoUpdater.on.mock.calls.map(([event]: [string]) => event)
    expect(events).toContain('update-available')
    expect(events).toContain('update-downloaded')
    expect(events).toContain('error')
  })

  it('checks for updates after 5 second delay', () => {
    initAutoUpdater()
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('update-available shows dialog and downloads on confirm', async () => {
    ;(dialog.showMessageBox as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ response: 0 })
    initAutoUpdater()

    const updateAvailableCall = mockAutoUpdater.on.mock.calls.find(
      ([event]: [string]) => event === 'update-available'
    )
    const handler = updateAvailableCall[1]
    await handler({ version: '1.0.0' })

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Update Available',
        message: 'Claudinha 1.0.0 is available.'
      })
    )
    expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled()
  })

  it('update-available does not download when user clicks Later', async () => {
    ;(dialog.showMessageBox as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ response: 1 })
    initAutoUpdater()

    const updateAvailableCall = mockAutoUpdater.on.mock.calls.find(
      ([event]: [string]) => event === 'update-available'
    )
    await updateAvailableCall[1]({ version: '1.0.0' })

    expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })
})

describe('getAppVersion', () => {
  it('returns the app version', () => {
    expect(getAppVersion()).toBe('0.1.0')
  })
})
