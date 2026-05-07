// @vitest-environment jsdom
/**
 * useKanbanActiveTransition — verifies the active-pane slide-up queue
 * (Animation A in the kanban-animations plan). The hook must:
 *   - Skip the slide for the very first activePaneId (no previous pane to
 *     slide over).
 *   - Slide subsequent transitions: while sliding, expose both base + sliding
 *     layer ids and a 0→1 progress.
 *   - Queue rapid clicks: A → B → C with B and C arriving mid-flight should
 *     play three sequential slides, not jump to C.
 *   - Treat clicks on the current target (or queue tail) as no-ops.
 *   - Short-circuit to instant when prefers-reduced-motion is set.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useKanbanActiveTransition } from '../../src/renderer/hooks/useKanbanActiveTransition'
import { KANBAN_SLIDE_MS } from '../../src/renderer/lib/kanbanMotion'

// Helpers ---------------------------------------------------------------------

let rafQueue: Array<(t: number) => void> = []
let now = 1000

function flushRaf(timeMs: number): void {
  // Advance virtual time to `timeMs` and run any pending RAF callbacks once
  // each. The hook re-schedules per frame, so `flushFrames` calls this in a
  // loop.
  now = timeMs
  const callbacks = rafQueue
  rafQueue = []
  for (const cb of callbacks) cb(now)
}

function flushFrames(toMs: number, stepMs = 16): void {
  while (now < toMs && rafQueue.length > 0) {
    flushRaf(Math.min(now + stepMs, toMs))
  }
}

function makeMatchMedia(reduce: boolean): (q: string) => MediaQueryList {
  return (q: string) => ({
    matches: q.includes('reduce') ? reduce : false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  } as unknown as MediaQueryList)
}

beforeEach(() => {
  rafQueue = []
  now = 1000
  ;(window as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
    ((cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    }) as typeof requestAnimationFrame
  ;(window as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame =
    (() => {}) as typeof cancelAnimationFrame
  ;(performance as unknown as { now: () => number }).now = () => now
  ;(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = makeMatchMedia(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Tests -----------------------------------------------------------------------

describe('useKanbanActiveTransition', () => {
  it('first activePaneId is set instantly with no slide', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useKanbanActiveTransition(id),
      { initialProps: { id: null as string | null } }
    )

    expect(result.current.baseLayerPaneId).toBe(null)

    act(() => { rerender({ id: 'p1' }) })

    expect(result.current.baseLayerPaneId).toBe('p1')
    expect(result.current.slidingLayerPaneId).toBe(null)
    expect(result.current.slideProgress01).toBe(0)
  })

  it('slides on subsequent change: exposes both layers + progress', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useKanbanActiveTransition(id),
      { initialProps: { id: 'p1' as string | null } }
    )
    expect(result.current.baseLayerPaneId).toBe('p1')

    act(() => { rerender({ id: 'p2' }) })

    // Initial frame: sliding layer set, progress at 0.
    expect(result.current.baseLayerPaneId).toBe('p1')
    expect(result.current.slidingLayerPaneId).toBe('p2')
    expect(result.current.slideProgress01).toBe(0)

    // Mid-slide: progress should be > 0 and < 1.
    act(() => { flushFrames(now + KANBAN_SLIDE_MS / 2) })
    expect(result.current.slidingLayerPaneId).toBe('p2')
    expect(result.current.slideProgress01).toBeGreaterThan(0)
    expect(result.current.slideProgress01).toBeLessThan(1)

    // After full duration: lands.
    act(() => { flushFrames(now + KANBAN_SLIDE_MS) })
    expect(result.current.baseLayerPaneId).toBe('p2')
    expect(result.current.slidingLayerPaneId).toBe(null)
  })

  it('queues rapid clicks: A→B→C plays three sequential slides', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useKanbanActiveTransition(id),
      { initialProps: { id: 'A' as string | null } }
    )

    // Click B at t=0.
    act(() => { rerender({ id: 'B' }) })
    expect(result.current.baseLayerPaneId).toBe('A')
    expect(result.current.slidingLayerPaneId).toBe('B')

    // Click C mid-slide. Should NOT interrupt — C waits its turn.
    act(() => { flushFrames(now + 200) })
    act(() => { rerender({ id: 'C' }) })
    expect(result.current.baseLayerPaneId).toBe('A')
    expect(result.current.slidingLayerPaneId).toBe('B')

    // Finish A→B slide. Should land on B and immediately start B→C.
    act(() => { flushFrames(now + KANBAN_SLIDE_MS) })
    expect(result.current.baseLayerPaneId).toBe('B')
    expect(result.current.slidingLayerPaneId).toBe('C')

    // Finish B→C.
    act(() => { flushFrames(now + KANBAN_SLIDE_MS) })
    expect(result.current.baseLayerPaneId).toBe('C')
    expect(result.current.slidingLayerPaneId).toBe(null)
  })

  it('clicking the current active is a no-op', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useKanbanActiveTransition(id),
      { initialProps: { id: 'A' as string | null } }
    )
    // Re-pass A — should not start a slide.
    act(() => { rerender({ id: 'A' }) })
    expect(result.current.baseLayerPaneId).toBe('A')
    expect(result.current.slidingLayerPaneId).toBe(null)
  })

  it('clicking the queue tail is a no-op (deduped)', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useKanbanActiveTransition(id),
      { initialProps: { id: 'A' as string | null } }
    )
    act(() => { rerender({ id: 'B' }) })
    // B is mid-slide. Re-passing B should not enqueue a duplicate.
    act(() => { rerender({ id: 'B' }) })
    // After the slide, we should land on B and the queue should be empty.
    act(() => { flushFrames(now + KANBAN_SLIDE_MS) })
    expect(result.current.baseLayerPaneId).toBe('B')
    expect(result.current.slidingLayerPaneId).toBe(null)
  })

  it('respects prefers-reduced-motion: jumps without animating', () => {
    ;(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = makeMatchMedia(true)

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useKanbanActiveTransition(id),
      { initialProps: { id: 'A' as string | null } }
    )
    act(() => { rerender({ id: 'B' }) })

    // No slide layer, base jumps directly to B. RAF is never used.
    expect(result.current.baseLayerPaneId).toBe('B')
    expect(result.current.slidingLayerPaneId).toBe(null)
    expect(rafQueue.length).toBe(0)
  })

  it('disableTransitions=true: sequential changes snap, never animate', () => {
    // Initial-spawn-overlay scenario: while disableTransitions is true, each
    // activePaneId update from per-PANE_SPAWNED listeners must snap. When
    // the overlay clears (disableTransitions → false) and the user later
    // clicks a different pane, the next slide is the first real animation.
    const { result, rerender } = renderHook(
      ({ id, disabled }: { id: string | null; disabled: boolean }) =>
        useKanbanActiveTransition(id, disabled),
      { initialProps: { id: null as string | null, disabled: true } }
    )

    // Three sequential active-pane updates while disabled. Each must snap;
    // none should ever populate slidingLayerPaneId.
    act(() => { rerender({ id: 'p1', disabled: true }) })
    expect(result.current.baseLayerPaneId).toBe('p1')
    expect(result.current.slidingLayerPaneId).toBe(null)

    act(() => { rerender({ id: 'p2', disabled: true }) })
    expect(result.current.baseLayerPaneId).toBe('p2')
    expect(result.current.slidingLayerPaneId).toBe(null)

    act(() => { rerender({ id: 'p3', disabled: true }) })
    expect(result.current.baseLayerPaneId).toBe('p3')
    expect(result.current.slidingLayerPaneId).toBe(null)
    // No RAF was scheduled across the entire disabled run.
    expect(rafQueue.length).toBe(0)

    // Overlay clears with the same activePaneId still selected. No
    // animation should fire — baseRef already matches the latest input.
    act(() => { rerender({ id: 'p3', disabled: false }) })
    expect(result.current.baseLayerPaneId).toBe('p3')
    expect(result.current.slidingLayerPaneId).toBe(null)
    expect(rafQueue.length).toBe(0)

    // The next user click is the first real animation.
    act(() => { rerender({ id: 'p4', disabled: false }) })
    expect(result.current.baseLayerPaneId).toBe('p3')
    expect(result.current.slidingLayerPaneId).toBe('p4')
  })
})
