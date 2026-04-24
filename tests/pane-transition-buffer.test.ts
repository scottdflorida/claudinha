/**
 * PaneTransitionBuffer unit tests.
 *
 * Verifies buffering, flushing, clearing, and safety timeout behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PaneTransitionBuffer } from '../src/main/pane-transition-buffer'

describe('PaneTransitionBuffer', () => {
  let buffer: PaneTransitionBuffer

  beforeEach(() => {
    vi.useFakeTimers()
    buffer = new PaneTransitionBuffer()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ---------------------------------------------------------------------------
  // write() when not buffering
  // ---------------------------------------------------------------------------

  it('write() returns false when pane is not being buffered', () => {
    expect(buffer.write('pane-1', 'hello')).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Basic buffering lifecycle
  // ---------------------------------------------------------------------------

  it('startBuffering + write captures data', () => {
    buffer.startBuffering('pane-1')
    expect(buffer.write('pane-1', 'chunk1')).toBe(true)
    expect(buffer.write('pane-1', 'chunk2')).toBe(true)
    expect(buffer.isBuffering('pane-1')).toBe(true)
  })

  it('flush returns concatenated data and stops buffering', () => {
    buffer.startBuffering('pane-1')
    buffer.write('pane-1', 'A')
    buffer.write('pane-1', 'B')
    buffer.write('pane-1', 'C')

    const result = buffer.flush('pane-1')
    expect(result).toBe('ABC')
    expect(buffer.isBuffering('pane-1')).toBe(false)
  })

  it('flush on non-buffering pane returns empty string', () => {
    expect(buffer.flush('nonexistent')).toBe('')
  })

  it('flush with no data returns empty string', () => {
    buffer.startBuffering('pane-1')
    expect(buffer.flush('pane-1')).toBe('')
  })

  // ---------------------------------------------------------------------------
  // Multiple panes buffered independently
  // ---------------------------------------------------------------------------

  it('buffers multiple panes independently', () => {
    buffer.startBuffering('pane-1')
    buffer.startBuffering('pane-2')

    buffer.write('pane-1', 'one-')
    buffer.write('pane-2', 'two-')
    buffer.write('pane-1', 'A')
    buffer.write('pane-2', 'B')

    expect(buffer.flush('pane-1')).toBe('one-A')
    expect(buffer.flush('pane-2')).toBe('two-B')
  })

  // ---------------------------------------------------------------------------
  // clear()
  // ---------------------------------------------------------------------------

  it('clear discards buffer without flushing', () => {
    buffer.startBuffering('pane-1')
    buffer.write('pane-1', 'data')

    buffer.clear('pane-1')
    expect(buffer.isBuffering('pane-1')).toBe(false)
    expect(buffer.flush('pane-1')).toBe('')
  })

  it('clear on non-buffering pane is a no-op', () => {
    expect(() => buffer.clear('nonexistent')).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // Safety timeout
  // ---------------------------------------------------------------------------

  it('safety timeout auto-clears the buffer', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    buffer.startBuffering('pane-1', 5_000)
    buffer.write('pane-1', 'data')

    expect(buffer.isBuffering('pane-1')).toBe(true)

    vi.advanceTimersByTime(5_000)

    expect(buffer.isBuffering('pane-1')).toBe(false)
    expect(buffer.flush('pane-1')).toBe('')
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[transition-buffer]'),
      expect.any(String)
    )

    consoleSpy.mockRestore()
  })

  it('flush before timeout cancels the timer', () => {
    buffer.startBuffering('pane-1', 5_000)
    buffer.write('pane-1', 'data')
    buffer.flush('pane-1')

    // Advance past timeout — should not warn
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.advanceTimersByTime(10_000)
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  // ---------------------------------------------------------------------------
  // startBuffering replaces existing buffer
  // ---------------------------------------------------------------------------

  it('startBuffering replaces existing buffer for same pane', () => {
    buffer.startBuffering('pane-1')
    buffer.write('pane-1', 'old-data')

    buffer.startBuffering('pane-1')
    buffer.write('pane-1', 'new-data')

    expect(buffer.flush('pane-1')).toBe('new-data')
  })

  // ---------------------------------------------------------------------------
  // isBuffering
  // ---------------------------------------------------------------------------

  it('isBuffering returns false for unknown pane', () => {
    expect(buffer.isBuffering('unknown')).toBe(false)
  })

  it('isBuffering returns true during buffering, false after flush', () => {
    buffer.startBuffering('pane-1')
    expect(buffer.isBuffering('pane-1')).toBe(true)
    buffer.flush('pane-1')
    expect(buffer.isBuffering('pane-1')).toBe(false)
  })
})
