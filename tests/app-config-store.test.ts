/**
 * app-config-store unit tests.
 *
 * Verifies get/set/reset behavior, partial patch merging, default
 * fallback for unseen fields, and soundVolume clamping at the store
 * boundary (defense in depth for invalid IPC payloads).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

const mockStore = new Map<string, unknown>()

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      get(key: string, defaultValue?: unknown): unknown {
        return mockStore.has(key) ? mockStore.get(key) : defaultValue
      }
      set(key: string, value: unknown): void {
        mockStore.set(key, value)
      }
      has(key: string): boolean {
        return mockStore.has(key)
      }
    }
  }
})

// Mock electron's `app.getLocale()` so first-launch language seeding is
// deterministic across the suite. Individual tests can override the locale by
// calling `mockGetLocale.mockReturnValueOnce(...)` before triggering a fresh
// getAppConfig() against an empty store.
const mockGetLocale = vi.fn(() => 'en-US')
vi.mock('electron', () => ({
  app: {
    getLocale: () => mockGetLocale()
  }
}))

import { getAppConfig, setAppConfig, resetAppConfig } from '../src/main/app-config-store'
import {
  DEFAULT_APP_CONFIG,
  DEFAULT_RAIL_CONFIG,
  KANBAN_DEFAULT_HEIGHT_PX,
  KANBAN_MIN_HEIGHT_PX,
  RAIL_DEFAULT_WIDTH_PX,
  RAIL_MAX_WIDTH_PX,
  RAIL_MIN_WIDTH_PX
} from '../src/shared/types'

describe('app-config-store', () => {
  beforeEach(() => {
    mockStore.clear()
  })

  it('returns DEFAULT_APP_CONFIG before any writes', () => {
    expect(getAppConfig()).toEqual(DEFAULT_APP_CONFIG)
  })

  it('persists and returns a partial patch merged onto defaults', () => {
    const result = setAppConfig({ soundsEnabled: false })
    expect(result.soundsEnabled).toBe(false)
    // Unpatched fields still reflect defaults.
    expect(result.soundVolume).toBe(DEFAULT_APP_CONFIG.soundVolume)
    expect(result.autoRestoreLastSession).toBe(DEFAULT_APP_CONFIG.autoRestoreLastSession)

    // A fresh get returns the same merged view.
    expect(getAppConfig().soundsEnabled).toBe(false)
  })

  it('merges successive partial patches cumulatively', () => {
    setAppConfig({ soundsEnabled: false })
    setAppConfig({ defaultModel: 'opus' })

    const cfg = getAppConfig()
    expect(cfg.soundsEnabled).toBe(false)
    expect(cfg.defaultModel).toBe('opus')
    // Untouched fields still default.
    expect(cfg.soundVolume).toBe(DEFAULT_APP_CONFIG.soundVolume)
  })

  it('clamps soundVolume below 0 and above 1', () => {
    const low = setAppConfig({ soundVolume: -0.5 })
    expect(low.soundVolume).toBe(0)

    const high = setAppConfig({ soundVolume: 2 })
    expect(high.soundVolume).toBe(1)
  })

  it('resets every field back to DEFAULT_APP_CONFIG', () => {
    setAppConfig({
      soundsEnabled: false,
      soundVolume: 0.1,
      autoRestoreLastSession: true,
      defaultModel: 'haiku'
    })
    const cleared = resetAppConfig()
    expect(cleared).toEqual(DEFAULT_APP_CONFIG)
    expect(getAppConfig()).toEqual(DEFAULT_APP_CONFIG)
  })

  it('fills in missing fields when the stored value predates a new default', () => {
    // Simulate an older stored object that lacks a field added later.
    mockStore.set('app.config', { soundsEnabled: false })
    const cfg = getAppConfig()
    expect(cfg.soundsEnabled).toBe(false)
    expect(cfg.defaultModel).toBe(DEFAULT_APP_CONFIG.defaultModel)
    expect(cfg.autoRestoreLastSession).toBe(DEFAULT_APP_CONFIG.autoRestoreLastSession)
    expect(cfg.showToolCountsBar).toBe(DEFAULT_APP_CONFIG.showToolCountsBar)
  })

  it('round-trips showToolCountsBar without affecting other fields', () => {
    const off = setAppConfig({ showToolCountsBar: false })
    expect(off.showToolCountsBar).toBe(false)
    // Other fields still default.
    expect(off.soundsEnabled).toBe(DEFAULT_APP_CONFIG.soundsEnabled)
    expect(off.autoRestoreLastSession).toBe(DEFAULT_APP_CONFIG.autoRestoreLastSession)

    const on = setAppConfig({ showToolCountsBar: true })
    expect(on.showToolCountsBar).toBe(true)
  })

  it('round-trips defaultViewMode without affecting other fields (Kanban v1)', () => {
    const kanban = setAppConfig({ defaultViewMode: 'kanban' })
    expect(kanban.defaultViewMode).toBe('kanban')
    // Other fields still default.
    expect(kanban.soundsEnabled).toBe(DEFAULT_APP_CONFIG.soundsEnabled)
    expect(kanban.defaultModel).toBe(DEFAULT_APP_CONFIG.defaultModel)

    const wall = setAppConfig({ defaultViewMode: 'wall' })
    expect(wall.defaultViewMode).toBe('wall')
  })

  it('legacy stored config without defaultViewMode falls back to "kanban"', () => {
    // Pre-Kanban app builds wrote AppConfig without `defaultViewMode`. Reading
    // such a record should not crash and should normalize to the current
    // factory default, which is now 'kanban'.
    mockStore.set('app.config', { soundsEnabled: true, defaultModel: null })
    const cfg = getAppConfig()
    expect(cfg.defaultViewMode).toBe('kanban')
  })

  it('round-trips theme without affecting other fields', () => {
    const light = setAppConfig({ theme: 'light' })
    expect(light.theme).toBe('light')
    expect(light.soundsEnabled).toBe(DEFAULT_APP_CONFIG.soundsEnabled)
    expect(light.defaultViewMode).toBe(DEFAULT_APP_CONFIG.defaultViewMode)

    const dark = setAppConfig({ theme: 'dark' })
    expect(dark.theme).toBe('dark')

    const systemAgain = setAppConfig({ theme: 'system' })
    expect(systemAgain.theme).toBe('system')
  })

  it('legacy stored config without theme falls back to "system"', () => {
    // Pre-theme-toggle app builds wrote AppConfig without `theme`. Reading
    // such a record should not crash and should normalize to 'system'.
    mockStore.set('app.config', { soundsEnabled: true, defaultModel: null })
    const cfg = getAppConfig()
    expect(cfg.theme).toBe('system')
  })

  it('clamps an invalid theme value back to the default at the store boundary', () => {
    // Defense in depth — even though only our own renderer sets this field, a
    // malformed IPC payload must not poison the store.
    const cfg = setAppConfig({ theme: 'neon' as unknown as 'dark' })
    expect(cfg.theme).toBe(DEFAULT_APP_CONFIG.theme)
  })

  it('seeds Kanban height to KANBAN_DEFAULT_HEIGHT_PX before any writes', () => {
    const cfg = getAppConfig()
    expect(cfg.kanban).toEqual({ heightPx: KANBAN_DEFAULT_HEIGHT_PX })
  })

  it('round-trips kanban.heightPx without affecting other fields', () => {
    const updated = setAppConfig({ kanban: { heightPx: 420 } })
    expect(updated.kanban.heightPx).toBe(420)
    // Untouched fields still default.
    expect(updated.soundsEnabled).toBe(DEFAULT_APP_CONFIG.soundsEnabled)
    expect(updated.defaultViewMode).toBe(DEFAULT_APP_CONFIG.defaultViewMode)
    expect(updated.inspector).toEqual(DEFAULT_APP_CONFIG.inspector)
  })

  it('clamps kanban.heightPx below the absolute minimum', () => {
    // Defense in depth — the resize handle already clamps on drag, but a bad
    // IPC payload (or a manual edit to the electron-store file) must not be
    // able to persist an impossibly-small board.
    const cfg = setAppConfig({ kanban: { heightPx: 40 } })
    expect(cfg.kanban.heightPx).toBe(KANBAN_MIN_HEIGHT_PX)
  })

  it('preserves kanban.heightPx when another field is patched separately', () => {
    setAppConfig({ kanban: { heightPx: 280 } })
    const after = setAppConfig({ soundsEnabled: false })
    // Shallow merge: kanban survives across an unrelated patch.
    expect(after.kanban.heightPx).toBe(280)
    expect(after.soundsEnabled).toBe(false)
  })

  it('legacy stored config without kanban falls back to the default', () => {
    // Pre-draggable-kanban app builds wrote AppConfig without `kanban`. Reading
    // such a record should not crash and should normalize to the factory
    // default so the board opens at its designed 4-card height.
    mockStore.set('app.config', { soundsEnabled: true, defaultViewMode: 'kanban' })
    const cfg = getAppConfig()
    expect(cfg.kanban).toEqual({ heightPx: KANBAN_DEFAULT_HEIGHT_PX })
  })

  // -----------------------------------------------------------------
  // Repo rail (widthPx + groupBy)
  // -----------------------------------------------------------------

  it('seeds rail to DEFAULT_RAIL_CONFIG before any writes', () => {
    const cfg = getAppConfig()
    expect(cfg.rail).toEqual(DEFAULT_RAIL_CONFIG)
  })

  it('round-trips rail.widthPx without affecting other fields', () => {
    const updated = setAppConfig({ rail: { widthPx: 360, groupBy: 'repo' } })
    expect(updated.rail.widthPx).toBe(360)
    expect(updated.rail.groupBy).toBe('repo')
    expect(updated.kanban.heightPx).toBe(KANBAN_DEFAULT_HEIGHT_PX)
    expect(updated.soundsEnabled).toBe(DEFAULT_APP_CONFIG.soundsEnabled)
  })

  it('round-trips rail.groupBy', () => {
    const updated = setAppConfig({ rail: { widthPx: RAIL_DEFAULT_WIDTH_PX, groupBy: 'status' } })
    expect(updated.rail.groupBy).toBe('status')
  })

  it('clamps rail.widthPx below RAIL_MIN_WIDTH_PX', () => {
    const cfg = setAppConfig({ rail: { widthPx: 40, groupBy: 'repo' } })
    expect(cfg.rail.widthPx).toBe(RAIL_MIN_WIDTH_PX)
  })

  it('clamps rail.widthPx above RAIL_MAX_WIDTH_PX', () => {
    const cfg = setAppConfig({ rail: { widthPx: 9999, groupBy: 'repo' } })
    expect(cfg.rail.widthPx).toBe(RAIL_MAX_WIDTH_PX)
  })

  it('falls back rail.groupBy when an unknown value is patched', () => {
    const cfg = setAppConfig({
      rail: { widthPx: RAIL_DEFAULT_WIDTH_PX, groupBy: 'mystery' as unknown as 'repo' }
    })
    expect(cfg.rail.groupBy).toBe(DEFAULT_RAIL_CONFIG.groupBy)
  })

  it('preserves rail across unrelated patches', () => {
    setAppConfig({ rail: { widthPx: 320, groupBy: 'status' } })
    const after = setAppConfig({ soundsEnabled: false })
    expect(after.rail).toEqual({ widthPx: 320, groupBy: 'status' })
    expect(after.soundsEnabled).toBe(false)
  })

  it('legacy stored config without rail falls back to the default', () => {
    mockStore.set('app.config', { soundsEnabled: true, defaultViewMode: 'kanban' })
    const cfg = getAppConfig()
    expect(cfg.rail).toEqual(DEFAULT_RAIL_CONFIG)
  })

  it('round-trips language without affecting other fields', () => {
    const pt = setAppConfig({ language: 'pt-BR' })
    expect(pt.language).toBe('pt-BR')
    expect(pt.soundsEnabled).toBe(DEFAULT_APP_CONFIG.soundsEnabled)
    expect(pt.theme).toBe(DEFAULT_APP_CONFIG.theme)

    const en = setAppConfig({ language: 'en' })
    expect(en.language).toBe('en')
  })

  it('clamps an invalid language value back to the default at the store boundary', () => {
    // Defense in depth — only our own renderer sets this field, but a
    // malformed IPC payload must not poison the store.
    const cfg = setAppConfig({ language: 'fr' as unknown as 'en' })
    expect(cfg.language).toBe(DEFAULT_APP_CONFIG.language)
  })

  it('legacy stored config without language falls back to "en"', () => {
    // Pre-i18n app builds wrote AppConfig without `language`. Reading such a
    // record should not crash and should normalize to English.
    mockStore.set('app.config', { soundsEnabled: true, theme: 'dark' })
    const cfg = getAppConfig()
    expect(cfg.language).toBe('en')
  })

  it('seeds language from OS locale on true first launch (pt-BR system)', () => {
    mockGetLocale.mockReturnValueOnce('pt-BR')
    const cfg = getAppConfig()
    expect(cfg.language).toBe('pt-BR')
    // The seeded value should also be persisted, so a second read returns the
    // same value without re-detecting from OS locale.
    mockGetLocale.mockReturnValue('en-US')
    expect(getAppConfig().language).toBe('pt-BR')
  })

  it('seeds language to "en" on first launch when OS locale is English', () => {
    mockGetLocale.mockReturnValueOnce('en-US')
    const cfg = getAppConfig()
    expect(cfg.language).toBe('en')
  })

  it('honors the user-stored language even if OS locale changes later', () => {
    // User explicitly chose English on a Brazilian system.
    setAppConfig({ language: 'en' })
    mockGetLocale.mockReturnValue('pt-BR')
    expect(getAppConfig().language).toBe('en')
  })

  it('round-trips claudeMdPushDefaults per repo (Phase 7 — push memory)', () => {
    const updated = setAppConfig({
      claudeMdPushDefaults: {
        '/repos/demo/.worktrees': true,
        '/repos/other/.worktrees': false
      }
    })
    expect(updated.claudeMdPushDefaults).toEqual({
      '/repos/demo/.worktrees': true,
      '/repos/other/.worktrees': false
    })

    // Subsequent partial patch merges with existing map (top-level merge).
    const more = setAppConfig({
      claudeMdPushDefaults: { '/repos/third': true }
    })
    // The Set call replaces the whole map; that's fine for our use case
    // (renderer always sends the merged map). Document the behavior here.
    expect(more.claudeMdPushDefaults).toEqual({ '/repos/third': true })
  })
})
