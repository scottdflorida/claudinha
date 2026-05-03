// @vitest-environment jsdom
/**
 * useKanbanCardMoves — verifies the card-move queue (Animation B) and the
 * displayedColumn lag that drives Animation C as a side-effect.
 *
 * Tests use a fake setTimeout via vi.useFakeTimers so we can advance time
 * deterministically through animation completion. DOM ref maps are populated
 * with stub elements whose `getBoundingClientRect` returns synthesized rects
 * matching whatever fromBucket / toBucket the test expects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useKanbanCardMoves } from '../../src/renderer/hooks/useKanbanCardMoves'
import type { RendererPane } from '../../src/renderer/hooks/usePaneState'
import type { PaneStatus } from '../../src/shared/types'
import type { KanbanCardMovesRefs } from '../../src/renderer/hooks/useKanbanCardMoves'

// Helpers ---------------------------------------------------------------------

function makePane(overrides: Partial<RendererPane> = {}): RendererPane {
  return {
    id: 'p1',
    repoName: 'demo',
    worktreeName: 'feature',
    worktreePath: '/tmp/demo/feature',
    isApiBilling: false,
    effort: 'high',
    model: 'opus',
    status: 'awaiting-prompt',
    activeToolName: null,
    statusSource: 'hook',
    metrics: {
      totalTokens: null,
      contextPercent: null,
      toolsUsed: null,
      totalCostUsd: null,
      durationMs: null,
      modelDisplayName: null,
      linesAdded: null,
      linesRemoved: null,
      sessionTitle: null
    },
    terminated: false,
    hasUnseenStatusChange: false,
    initialBuffer: null,
    gitStatus: null,
    isWorktree: true,
    completionStatus: null,
    isResolvingConflict: false,
    userName: null,
    permissionMode: 'normal',
    ...overrides
  }
}

function makeRectEl(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = (() => ({
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({})
  })) as () => DOMRect
  return el
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
  ;(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = makeMatchMedia(false)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * Renders the hook with a wrapper that owns the cardRefs / dropTargetRefs
 * and exposes them for direct manipulation. Also seeds the refs with stub
 * elements so getBoundingClientRect returns deterministic values.
 */
function renderMovesHook(initialPanes: RendererPane[]): {
  result: { current: ReturnType<typeof useKanbanCardMoves> }
  cardRefs: React.MutableRefObject<Map<string, HTMLElement | null>>
  dropTargetRefs: React.MutableRefObject<Map<PaneStatus, HTMLElement | null>>
  rerender: (panes: RendererPane[]) => void
} {
  const cardRefs = { current: new Map<string, HTMLElement | null>() }
  const dropTargetRefs = { current: new Map<PaneStatus, HTMLElement | null>() }
  // Seed every column drop target so the hook can always measure toRect.
  const allCols: PaneStatus[] = ['awaiting-prompt', 'working', 'needs-input', 'done', 'error']
  for (const c of allCols) {
    // Place each column's drop target at a distinct x so distance is non-zero.
    const idx = allCols.indexOf(c)
    dropTargetRefs.current.set(c, makeRectEl({ left: idx * 200, top: 500, width: 0, height: 0 }))
  }
  const refs: KanbanCardMovesRefs = { cardRefs, dropTargetRefs }
  const { result, rerender: doRerender } = renderHook(
    ({ panes }: { panes: RendererPane[] }) => useKanbanCardMoves(panes, refs),
    { initialProps: { panes: initialPanes } }
  )
  return {
    result,
    cardRefs,
    dropTargetRefs,
    rerender: (panes: RendererPane[]) => doRerender({ panes })
  }
}

// Tests -----------------------------------------------------------------------

describe('useKanbanCardMoves', () => {
  it('returns panes unchanged when no status has changed', () => {
    const panes = [makePane({ id: 'p1', status: 'working' })]
    const { result } = renderMovesHook(panes)
    expect(result.current.displayedPanes).toEqual(panes)
    expect(result.current.movingCard).toBe(null)
  })

  it('starts an overlay move when a pane changes column', async () => {
    const panes = [makePane({ id: 'p1', status: 'awaiting-prompt' })]
    const { result, cardRefs, rerender } = renderMovesHook(panes)
    // Seed the card's DOM element so the source rect can be measured.
    cardRefs.current.set('p1', makeRectEl({ left: 0, top: 0, width: 100, height: 50 }))

    // Status changes to 'done'. Hook should enqueue and start animating
    // after a microtask flush.
    const newPanes = [makePane({ id: 'p1', status: 'done' })]
    await act(async () => {
      rerender(newPanes)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve() // flush the microtask in the watch effect.
    })

    expect(result.current.movingCard).not.toBe(null)
    expect(result.current.movingCard?.pane.id).toBe('p1')
    // Moving pane is omitted from displayedPanes.
    expect(result.current.displayedPanes.find((p) => p.id === 'p1')).toBeUndefined()
  })

  it('lands the card after durationMs, dropping the override', async () => {
    const panes = [makePane({ id: 'p1', status: 'awaiting-prompt' })]
    const { result, cardRefs, rerender } = renderMovesHook(panes)
    cardRefs.current.set('p1', makeRectEl({ left: 0, top: 0, width: 100, height: 50 }))

    const newPanes = [makePane({ id: 'p1', status: 'done' })]
    await act(async () => {
      rerender(newPanes)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const duration = result.current.movingCard?.durationMs ?? 0
    expect(duration).toBeGreaterThan(0)

    // Advance past the animation.
    await act(async () => {
      vi.advanceTimersByTime(duration + 10)
    })

    expect(result.current.movingCard).toBe(null)
    // Card is back in displayedPanes with the real status.
    const displayed = result.current.displayedPanes.find((p) => p.id === 'p1')
    expect(displayed?.status).toBe('done')
  })

  it('queues a second move during an in-flight animation', async () => {
    const panes = [
      makePane({ id: 'p1', status: 'awaiting-prompt' }),
      makePane({ id: 'p2', status: 'awaiting-prompt' })
    ]
    const { result, cardRefs, rerender } = renderMovesHook(panes)
    cardRefs.current.set('p1', makeRectEl({ left: 0, top: 0, width: 100, height: 50 }))
    cardRefs.current.set('p2', makeRectEl({ left: 0, top: 60, width: 100, height: 50 }))

    // p1: awaiting → working.
    await act(async () => {
      rerender([
        makePane({ id: 'p1', status: 'working' }),
        makePane({ id: 'p2', status: 'awaiting-prompt' })
      ])
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.movingCard?.pane.id).toBe('p1')

    // While p1 is in flight, p2: awaiting → done.
    await act(async () => {
      rerender([
        makePane({ id: 'p1', status: 'working' }),
        makePane({ id: 'p2', status: 'done' })
      ])
      await Promise.resolve()
      await Promise.resolve()
    })
    // Still p1 in flight (queue is serial).
    expect(result.current.movingCard?.pane.id).toBe('p1')

    const dur1 = result.current.movingCard?.durationMs ?? 0
    await act(async () => {
      vi.advanceTimersByTime(dur1 + 10)
    })

    // After p1 lands, p2 should be in flight.
    expect(result.current.movingCard?.pane.id).toBe('p2')
  })

  it('respects prefers-reduced-motion: snaps without overlay', async () => {
    ;(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = makeMatchMedia(true)
    const panes = [makePane({ id: 'p1', status: 'awaiting-prompt' })]
    const { result, cardRefs, rerender } = renderMovesHook(panes)
    cardRefs.current.set('p1', makeRectEl({ left: 0, top: 0, width: 100, height: 50 }))

    await act(async () => {
      rerender([makePane({ id: 'p1', status: 'done' })])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.movingCard).toBe(null)
    // The displayed status reflects the real status without animating.
    expect(result.current.displayedPanes.find((p) => p.id === 'p1')?.status).toBe('done')
  })

  it('mid-flight real-status drift queues a follow-up move', async () => {
    const panes = [makePane({ id: 'p1', status: 'awaiting-prompt' })]
    const { result, cardRefs, rerender } = renderMovesHook(panes)
    cardRefs.current.set('p1', makeRectEl({ left: 0, top: 0, width: 100, height: 50 }))

    // Start a move awaiting → working.
    await act(async () => {
      rerender([makePane({ id: 'p1', status: 'working' })])
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.movingCard?.pane.id).toBe('p1')

    // Mid-flight, real status drifts to 'done'. The watch effect updates the
    // queued target. After the in-flight animation completes, a follow-up
    // working → done move is enqueued.
    await act(async () => {
      rerender([makePane({ id: 'p1', status: 'done' })])
      await Promise.resolve()
      await Promise.resolve()
    })

    const dur1 = result.current.movingCard?.durationMs ?? 0
    await act(async () => {
      vi.advanceTimersByTime(dur1 + 10)
    })

    // After landing, since real='done' and the just-completed move had
    // toBucket='done' (because the queued entry's target was updated), the
    // displayed should be 'done'. Verify either: another move is in flight,
    // or the displayed already matches real.
    const displayedNow = result.current.displayedPanes.find((p) => p.id === 'p1')
    if (result.current.movingCard) {
      // A follow-up is animating to 'done'.
      expect(result.current.movingCard.pane.id).toBe('p1')
    } else {
      expect(displayedNow?.status).toBe('done')
    }
  })
})
