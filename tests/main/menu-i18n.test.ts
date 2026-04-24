/**
 * menu-strings — verifies the main-process OS menu bar resolves to the
 * correct bundle per language and that pt-BR has every key en defines.
 */
import { describe, it, expect } from 'vitest'
import { getMenuStrings, type MenuStrings } from '../../src/main/menu-strings'

describe('getMenuStrings', () => {
  it('returns translated File menu label for pt-BR', () => {
    expect(getMenuStrings('pt-BR').fileMenu).toBe('Arquivo')
  })

  it('returns the English File menu label for "en"', () => {
    expect(getMenuStrings('en').fileMenu).toBe('File')
  })

  it('falls back to English for an unknown language', () => {
    // Defensive — buildMenu is gated by the validated AppConfig.language, but
    // a future extension might pass a stale value.
    expect(getMenuStrings('xx' as unknown as 'en').fileMenu).toBe('File')
  })

  it('en and pt-BR expose the same set of keys', () => {
    const enKeys = Object.keys(getMenuStrings('en') as unknown as MenuStrings).sort()
    const ptKeys = Object.keys(getMenuStrings('pt-BR') as unknown as MenuStrings).sort()
    expect(ptKeys).toEqual(enKeys)
  })

  it('every value is a non-empty string or callable in both bundles', () => {
    for (const lang of ['en', 'pt-BR'] as const) {
      const bundle = getMenuStrings(lang)
      for (const [key, value] of Object.entries(bundle)) {
        if (typeof value === 'function') {
          // Function-typed entries (e.g. updateAvailableMessage) — call with a
          // representative argument and assert the result is a non-empty string.
          // Most templates here take a string or a number; sniff the arg by name.
          const probe = key.toLowerCase().includes('count') || key.toLowerCase().includes('detail')
            ? 1
            : '0.0.0'
          const out = (value as (...args: unknown[]) => unknown)(probe)
          expect(typeof out, `${lang}.${key}() should return a string`).toBe('string')
          expect((out as string).length, `${lang}.${key}() should be non-empty`).toBeGreaterThan(0)
        } else {
          expect(typeof value, `${lang}.${key} should be a string`).toBe('string')
          expect((value as string).length, `${lang}.${key} should be non-empty`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('pt-BR translations differ from English for the substantive labels', () => {
    const en = getMenuStrings('en')
    const pt = getMenuStrings('pt-BR')
    // A handful of labels that must be different to prove translation happened
    // (and not, say, an accidental copy-paste of the en bundle).
    expect(pt.fileMenu).not.toBe(en.fileMenu)
    expect(pt.editMenu).not.toBe(en.editMenu)
    expect(pt.windowMenu).not.toBe(en.windowMenu)
    expect(pt.helpMenu).not.toBe(en.helpMenu)
  })
})
