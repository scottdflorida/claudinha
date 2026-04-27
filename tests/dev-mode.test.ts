/**
 * dev-mode — when running unpackaged (npm run dev), redirect the app name and
 * userData folder so the dev process does not collide with an installed
 * /Applications/Claudinha.app on the single-instance lock.
 *
 * The lock collision is silent (the loser app.quit()s without showing a
 * window), so this guardrail is easy to remove by accident. These tests pin
 * the conditional and the redirected path so a regression fails loudly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Mock electron.app — record setName/setPath calls and let each test toggle
// isPackaged to drive the dev vs. installed branch
// ---------------------------------------------------------------------------

let isPackagedValue = false
const setNameMock = vi.fn()
const setPathMock = vi.fn()
const APP_DATA = '/tmp/dev-mode-test-appdata'

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackagedValue
    },
    setName: (name: string) => setNameMock(name),
    setPath: (kind: string, p: string) => setPathMock(kind, p),
    getPath: (name: string) => {
      if (name === 'appData') return APP_DATA
      throw new Error(`unexpected getPath: ${name}`)
    }
  }
}))

async function loadDevMode(): Promise<void> {
  vi.resetModules()
  await import('../src/main/dev-mode')
}

describe('dev-mode', () => {
  beforeEach(() => {
    setNameMock.mockClear()
    setPathMock.mockClear()
  })

  it('redirects app name and userData when running unpackaged (npm run dev)', async () => {
    isPackagedValue = false

    await loadDevMode()

    expect(setNameMock).toHaveBeenCalledWith('claudinha-dev')
    expect(setPathMock).toHaveBeenCalledWith('userData', join(APP_DATA, 'claudinha-dev'))
  })

  it('does nothing when running packaged (installed /Applications/Claudinha.app)', async () => {
    isPackagedValue = true

    await loadDevMode()

    expect(setNameMock).not.toHaveBeenCalled()
    expect(setPathMock).not.toHaveBeenCalled()
  })
})
