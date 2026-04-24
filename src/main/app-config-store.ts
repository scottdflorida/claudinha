import Store from 'electron-store'
import { app } from 'electron'
import type { AppConfig } from '../shared/types'
import { DEFAULT_APP_CONFIG, KANBAN_MIN_HEIGHT_PX } from '../shared/types'

// Detect the renderer language to seed on true first launch. Any locale that
// looks Brazilian Portuguese (pt-BR / pt_BR / pt) starts the user in Português;
// every other locale falls through to English. After the first read the choice
// is persisted, so changing the OS locale later does not retroactively flip
// a user who has been running Claudinha in their preferred language.
function detectInitialLanguage(): AppConfig['language'] {
  let locale = ''
  try {
    locale = app.getLocale() ?? ''
  } catch {
    // app.getLocale() throws if called before the 'ready' event. In that case
    // fall back to English; the renderer can still flip the toggle later.
    locale = ''
  }
  return /^pt(-|_|$)/i.test(locale) ? 'pt-BR' : 'en'
}

// ---------------------------------------------------------------------------
// App config persistence
//
// Stores user-facing preferences exposed through the Configuration view
// (sound toggles, startup behavior, default model, etc.). Module-level
// singleton, same pattern as completion-policy-store.ts.
//
// `setAppConfig` accepts a partial patch so every UI control can dispatch
// just the field it owns without having to round-trip the whole object.
// ---------------------------------------------------------------------------

interface AppConfigSchema {
  'app.config': AppConfig
}

const store = new Store<AppConfigSchema>({
  name: 'app-config'
})

/**
 * Return the persisted app config, falling back to DEFAULT_APP_CONFIG for
 * any field the user has never customized. Merges the default on top of the
 * stored value so that fields added in future versions get a sensible
 * default without requiring a migration.
 */
export function getAppConfig(): AppConfig {
  // True first launch: no app.config key has ever been written. Seed the
  // language from the OS locale and persist immediately so subsequent reads
  // stay consistent (and so the renderer's APP_CONFIG_GET sees the seeded
  // value on the very first call).
  if (!store.has('app.config')) {
    const seeded: AppConfig = { ...DEFAULT_APP_CONFIG, language: detectInitialLanguage() }
    store.set('app.config', seeded)
    return seeded
  }
  const stored = store.get('app.config', {} as Partial<AppConfig>)
  return { ...DEFAULT_APP_CONFIG, ...stored }
}

/**
 * Persist a partial patch on top of the current config and return the full
 * merged result. Callers are responsible for broadcasting the change to
 * any open windows.
 */
export function setAppConfig(patch: Partial<AppConfig>): AppConfig {
  const current = getAppConfig()
  const next: AppConfig = { ...current, ...patch }
  // Clamp soundVolume at the store boundary — the UI slider should already
  // stay in range, but we defend in depth so an invalid IPC payload can't
  // poison the stored value.
  if (typeof next.soundVolume === 'number') {
    if (next.soundVolume < 0) next.soundVolume = 0
    if (next.soundVolume > 1) next.soundVolume = 1
  }
  // Clamp workspace-keeper drawer width to the designed 200..500 range so a bad
  // patch can't push the drawer off-screen or collapse it invisibly.
  if (next.inspector && typeof next.inspector.widthPx === 'number') {
    next.inspector = { ...next.inspector }
    if (next.inspector.widthPx < 200) next.inspector.widthPx = 200
    if (next.inspector.widthPx > 500) next.inspector.widthPx = 500
  }
  // Clamp Kanban board height to its absolute minimum. The maximum is
  // window-dependent (must leave room for the active terminal's 6 rows) and is
  // enforced live in the renderer during the drag — we can't enforce it here
  // because the store has no notion of viewport height.
  if (next.kanban && typeof next.kanban.heightPx === 'number') {
    next.kanban = { ...next.kanban }
    if (next.kanban.heightPx < KANBAN_MIN_HEIGHT_PX) next.kanban.heightPx = KANBAN_MIN_HEIGHT_PX
  }
  // Validate theme at the IPC boundary (L-016) — only accept the three known
  // string values; anything else falls back to the default.
  if (next.theme !== 'dark' && next.theme !== 'light' && next.theme !== 'system') {
    next.theme = DEFAULT_APP_CONFIG.theme
  }
  // Validate language at the IPC boundary — same defense-in-depth pattern.
  if (next.language !== 'en' && next.language !== 'pt-BR') {
    next.language = DEFAULT_APP_CONFIG.language
  }
  store.set('app.config', next)
  return next
}

/**
 * Reset the config back to DEFAULT_APP_CONFIG.
 */
export function resetAppConfig(): AppConfig {
  const next: AppConfig = { ...DEFAULT_APP_CONFIG }
  store.set('app.config', next)
  return next
}
