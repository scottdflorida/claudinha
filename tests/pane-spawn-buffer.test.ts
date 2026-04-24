/**
 * PaneSpawnBuffer unit tests.
 *
 * Verifies the per-pane PTY-output gate that holds early spawn data until the
 * renderer's XTermView signals PANE_READY. See src/main/pane-spawn-buffer.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PaneSpawnBuffer,
  PANE_SPAWN_BUFFER_DEFAULT_TIMEOUT_MS
} from '../src/main/pane-spawn-buffer'

describe('PaneSpawnBuffer', () => {
  let buffer: PaneSpawnBuffer
  let onTimeout: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    buffer = new PaneSpawnBuffer()
    onTimeout = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ---------------------------------------------------------------------------
  // capture() when no gate is open
  // ---------------------------------------------------------------------------

  it('capture returns false when no gate is open for the pane', () => {
    expect(buffer.capture('pane-1', 'hello')).toBe(false)
  })

  it('isOpen returns false for unknown pane', () => {
    expect(buffer.isOpen('unknown')).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Basic gating lifecycle
  // ---------------------------------------------------------------------------

  it('open + capture buffers data while gate is open', () => {
    buffer.open('pane-1', onTimeout)
    expect(buffer.isOpen('pane-1')).toBe(true)
    expect(buffer.capture('pane-1', 'chunk1')).toBe(true)
    expect(buffer.capture('pane-1', 'chunk2')).toBe(true)
  })

  it('flush returns concatenated chunks and closes the gate', () => {
    buffer.open('pane-1', onTimeout)
    buffer.capture('pane-1', 'A')
    buffer.capture('pane-1', 'B')
    buffer.capture('pane-1', 'C')

    expect(buffer.flush('pane-1')).toBe('ABC')
    expect(buffer.isOpen('pane-1')).toBe(false)
  })

  it('flush returns empty string for an open gate with no chunks', () => {
    buffer.open('pane-1', onTimeout)
    expect(buffer.flush('pane-1')).toBe('')
    expect(buffer.isOpen('pane-1')).toBe(false)
  })

  it('flush returns null when no gate was open', () => {
    expect(buffer.flush('pane-1')).toBeNull()
  })

  it('capture returns false after flush (live mode resumed)', () => {
    buffer.open('pane-1', onTimeout)
    buffer.capture('pane-1', 'A')
    buffer.flush('pane-1')

    expect(buffer.capture('pane-1', 'B')).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Multiple panes gated independently
  // ---------------------------------------------------------------------------

  it('gates multiple panes independently', () => {
    buffer.open('pane-1', onTimeout)
    buffer.open('pane-2', onTimeout)

    buffer.capture('pane-1', 'one-')
    buffer.capture('pane-2', 'two-')
    buffer.capture('pane-1', 'A')
    buffer.capture('pane-2', 'B')

    expect(buffer.flush('pane-1')).toBe('one-A')
    expect(buffer.flush('pane-2')).toBe('two-B')
  })

  // ---------------------------------------------------------------------------
  // clear()
  // ---------------------------------------------------------------------------

  it('clear drops the gate without flushing', () => {
    buffer.open('pane-1', onTimeout)
    buffer.capture('pane-1', 'data')

    buffer.clear('pane-1')
    expect(buffer.isOpen('pane-1')).toBe(false)
    expect(buffer.flush('pane-1')).toBeNull()
  })

  it('clear on a pane with no gate is a no-op', () => {
    expect(() => buffer.clear('unknown')).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // Safety timeout
  // ---------------------------------------------------------------------------

  it('fires onTimeout after the default timeout when gate is never flushed', () => {
    buffer.open('pane-1', onTimeout)
    buffer.capture('pane-1', 'data')

    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(PANE_SPAWN_BUFFER_DEFAULT_TIMEOUT_MS)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('respects a custom timeout', () => {
    buffer.open('pane-1', onTimeout, 1_000)

    vi.advanceTimersByTime(999)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('flush before the timeout cancels the timer', () => {
    buffer.open('pane-1', onTimeout, 1_000)
    buffer.capture('pane-1', 'data')
    expect(buffer.flush('pane-1')).toBe('data')

    vi.advanceTimersByTime(5_000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('clear before the timeout cancels the timer', () => {
    buffer.open('pane-1', onTimeout, 1_000)
    buffer.clear('pane-1')

    vi.advanceTimersByTime(5_000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // open() replaces an existing gate
  // ---------------------------------------------------------------------------

  it('re-opening a gate replaces existing buffered data and resets the timer', () => {
    const firstTimeout = vi.fn()
    const secondTimeout = vi.fn()

    buffer.open('pane-1', firstTimeout, 1_000)
    buffer.capture('pane-1', 'old')

    buffer.open('pane-1', secondTimeout, 1_000)
    buffer.capture('pane-1', 'new')

    expect(buffer.flush('pane-1')).toBe('new')

    vi.advanceTimersByTime(5_000)
    expect(firstTimeout).not.toHaveBeenCalled()
    expect(secondTimeout).not.toHaveBeenCalled()
  })
})
