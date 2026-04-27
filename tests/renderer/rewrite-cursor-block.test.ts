import { describe, it, expect } from 'vitest'
import { rewriteCursorBlock } from '../../src/renderer/lib/rewrite-cursor-block'

const CURSOR = '\x1b[7m \x1b[27m'
const DARK_GOLD  = '\x1b[38;2;232;184;75m█\x1b[39m'
const LIGHT_GOLD = '\x1b[38;2;184;135;46m█\x1b[39m'

describe('rewriteCursorBlock', () => {
  it('replaces ink-text-input cursor pattern with dark-mode gold block', () => {
    const out = rewriteCursorBlock(`❯ ${CURSOR}`, 'dark')
    expect(out).toBe(`❯ ${DARK_GOLD}`)
  })

  it('replaces with the light-mode bronze block when theme is light', () => {
    const out = rewriteCursorBlock(`❯ ${CURSOR}`, 'light')
    expect(out).toBe(`❯ ${LIGHT_GOLD}`)
  })

  it('passes data through untouched when the pattern is absent', () => {
    const data = '\x1b[38;2;215;119;87m▗ Claude Code\x1b[39m\n'
    expect(rewriteCursorBlock(data, 'dark')).toBe(data)
  })

  it('replaces multiple occurrences in one chunk', () => {
    const out = rewriteCursorBlock(`${CURSOR}foo${CURSOR}`, 'dark')
    expect(out).toBe(`${DARK_GOLD}foo${DARK_GOLD}`)
  })

  it('handles the pattern at the start of a chunk', () => {
    const out = rewriteCursorBlock(`${CURSOR}rest`, 'dark')
    expect(out).toBe(`${DARK_GOLD}rest`)
  })

  it('handles the pattern at the end of a chunk', () => {
    const out = rewriteCursorBlock(`prefix${CURSOR}`, 'dark')
    expect(out).toBe(`prefix${DARK_GOLD}`)
  })

  it('does not match similar inverse sequences with non-space content', () => {
    // `[7mEnter` is a help-footer keyboard badge (inverse "Enter" text);
    // it must NOT be rewritten — only the bare-space cursor pattern is.
    const data = `\x1b[7mEnter\x1b[27m to confirm`
    expect(rewriteCursorBlock(data, 'dark')).toBe(data)
  })

  it('does not match an inverse sequence with multiple spaces', () => {
    const data = `\x1b[7m  \x1b[27m`
    expect(rewriteCursorBlock(data, 'dark')).toBe(data)
  })

  it('returns the same string reference when no rewrite happens (cheap fast-path)', () => {
    const data = 'no escapes here at all'
    expect(rewriteCursorBlock(data, 'dark')).toBe(data)
  })
})
