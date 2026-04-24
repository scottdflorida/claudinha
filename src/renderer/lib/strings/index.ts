/**
 * Translation engine for the renderer.
 *
 * Per-locale modules live in this directory and all satisfy the same
 * `Strings` shape (defined by en.ts), so TypeScript fails the build if a
 * locale ever drifts out of sync.
 *
 * Components consume strings via the `useStrings()` hook, which reads the
 * current language from `useAppConfig` and returns the active bundle.
 * Because the hook piggybacks on the existing `AppConfigProvider` listener,
 * language changes propagate to every renderer surface for free — no new
 * IPC channel and no per-component listener.
 *
 * The legacy named export `strings` is kept as an alias for the English
 * bundle so any consumer that hasn't migrated to `useStrings` yet continues
 * to compile and render English.
 */

import { useAppConfig } from '../../hooks/useAppConfig'
import { en, type Strings } from './en'
import { ptBR } from './pt-BR'

export type { Strings }
export type Language = 'en' | 'pt-BR'

const BUNDLES: Record<Language, Strings> = {
  en,
  'pt-BR': ptBR
}

/**
 * Pure lookup: given a language code, return the matching bundle. Falls
 * back to English for unknown codes (defense in depth — the IPC boundary
 * already validates the language field, but this keeps `getStrings` total).
 */
export function getStrings(lang: Language | string | null | undefined): Strings {
  if (lang === 'pt-BR') return ptBR
  return en
}

/**
 * React hook returning the active locale's bundle. Re-renders the calling
 * component whenever the user changes language because `useAppConfig` is
 * itself reactive (subscribes to APP_CONFIG_CHANGED via AppConfigProvider).
 */
export function useStrings(): Strings {
  const { config } = useAppConfig()
  return getStrings(config.language)
}

// Legacy compat: `import { strings } from '../lib/strings'` keeps working
// during the component refactor and resolves to the English bundle.
export const strings: Strings = en
