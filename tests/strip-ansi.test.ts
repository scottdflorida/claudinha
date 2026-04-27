import { describe, it, expect } from 'vitest'
import { stripAnsi } from '../src/shared/strip-ansi'

describe('stripAnsi', () => {
  it('strips OSC title-set sequences (the spawn-overlay regression)', () => {
    // Claude Code emits ESC ] 0 ; <title> BEL during init, long before the
    // visible banner. The title contains "Claude Code", so any naive
    // substring scan over raw bytes would trip on this and lift the spawn
    // overlay before the user sees anything painted.
    const raw = '\x1b]0;Claude Code\x07'
    expect(stripAnsi(raw)).toBe('')
  })

  it('strips OSC sequences with the ESC \\ string-terminator variant', () => {
    const raw = '\x1b]0;Claude Code\x1b\\some visible text'
    expect(stripAnsi(raw)).toBe('some visible text')
  })

  it('strips CSI color and cursor-positioning sequences', () => {
    const raw = '\x1b[31mhello\x1b[0m \x1b[2J\x1b[H world'
    expect(stripAnsi(raw)).toBe('hello  world')
  })

  it('strips character-set selection sequences', () => {
    const raw = '\x1b(B\x1b)0plain'
    expect(stripAnsi(raw)).toBe('plain')
  })

  it('does NOT eat lowercase letters after a stray ESC (the plan-mode footer fix)', () => {
    // Lowercase ASCII never terminates a real ECMA-48 escape — earlier
    // versions of stripAnsi used [A-Za-z] and chewed real text bytes.
    // Regression guard for the "shift+tab to cycle" → "shift+tab o cycle"
    // bug from the original status-detector comment.
    const raw = 'shift+tab to cycle'
    expect(stripAnsi(raw)).toBe('shift+tab to cycle')
  })

  it('strips simple 2-byte escapes with C1-set finals', () => {
    // ESC = sets keypad mode (`=` is in the C1-final set).
    const raw = '\x1b=text\x1b>more'
    expect(stripAnsi(raw)).toBe('textmore')
  })

  it('passes plain text through unchanged', () => {
    const raw = 'no escapes here, just words.'
    expect(stripAnsi(raw)).toBe(raw)
  })

  it('handles a realistic Claude Code prompt-arrow line', () => {
    // ANSI-decorated prompt arrow at the end of a line — the marker the
    // spawn overlay watches for. After stripping, the trailing `❯` is
    // visible and the prompt regex can match.
    const raw = '\x1b[?25h\x1b[2K\x1b[1G❯ '
    expect(stripAnsi(raw)).toBe('❯ ')
  })
})
