// @vitest-environment jsdom
/**
 * useFlipChildren — verifies the animation gate: FLIP runs ONLY when a
 * previously-present key disappears from the current render. Intra-column
 * reorders, additions, and sibling-height shifts must not animate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'

import { useFlipChildren } from '../../src/renderer/lib/flip'

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
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Renders useFlipChildren over a refMap that the test owns. The test
 * mutates the refMap and rerenders with new keys to drive different
 * scenarios.
 */
function renderFlip(initialKeys: string[], rectsByKey: Record<string, { left: number; top: number; width: number; height: number }>): {
  refMap: React.MutableRefObject<Map<string, HTMLElement | null>>
  rerender: (keys: string[], updatedRects?: Record<string, { left: number; top: number; width: number; height: number }>) => void
} {
  const refMap = { current: new Map<string, HTMLElement | null>() }
  for (const [key, rect] of Object.entries(rectsByKey)) {
    refMap.current.set(key, makeRectEl(rect))
  }
  const { rerender: doRerender } = renderHook(
    ({ keys }: { keys: string[] }) => {
      const ref = useRef(refMap.current)
      ref.current = refMap.current
      useFlipChildren(refMap, keys, 300)
    },
    { initialProps: { keys: initialKeys } }
  )
  return {
    refMap,
    rerender: (keys, updatedRects) => {
      if (updatedRects) {
        for (const [key, rect] of Object.entries(updatedRects)) {
          // Replace the element so getBoundingClientRect returns the new rect.
          refMap.current.set(key, makeRectEl(rect))
        }
      }
      doRerender({ keys })
    }
  }
}

describe('useFlipChildren', () => {
  it('does NOT animate when keys are unchanged but a sibling height shifted', () => {
    const { refMap, rerender } = renderFlip(
      ['a', 'b'],
      {
        a: { left: 0, top: 0, width: 100, height: 50 },
        b: { left: 0, top: 58, width: 100, height: 50 }
      }
    )

    // Simulate sibling 'a' growing taller — pushes 'b' down. Same keys,
    // no removal. FLIP must not animate.
    rerender(['a', 'b'], {
      a: { left: 0, top: 0, width: 100, height: 80 },
      b: { left: 0, top: 88, width: 100, height: 50 }
    })

    const elA = refMap.current.get('a') as HTMLElement
    const elB = refMap.current.get('b') as HTMLElement
    expect(elA.style.transform).toBe('')
    expect(elB.style.transform).toBe('')
  })

  it('does NOT animate when the keys reorder without any removal', () => {
    const { refMap, rerender } = renderFlip(
      ['a', 'b'],
      {
        a: { left: 0, top: 0, width: 100, height: 50 },
        b: { left: 0, top: 58, width: 100, height: 50 }
      }
    )

    // Reorder a/b — same set of keys, just swapped. No removal.
    rerender(['b', 'a'], {
      a: { left: 0, top: 58, width: 100, height: 50 },
      b: { left: 0, top: 0, width: 100, height: 50 }
    })

    const elA = refMap.current.get('a') as HTMLElement
    const elB = refMap.current.get('b') as HTMLElement
    expect(elA.style.transform).toBe('')
    expect(elB.style.transform).toBe('')
  })

  it('animates the surviving children when a key is removed', () => {
    const { refMap, rerender } = renderFlip(
      ['a', 'b', 'c'],
      {
        a: { left: 0, top: 0, width: 100, height: 50 },
        b: { left: 0, top: 58, width: 100, height: 50 },
        c: { left: 0, top: 116, width: 100, height: 50 }
      }
    )

    // Remove 'b'. 'c' moves up to where 'b' was. FLIP must animate 'c'.
    rerender(['a', 'c'], {
      a: { left: 0, top: 0, width: 100, height: 50 },
      c: { left: 0, top: 58, width: 100, height: 50 }
    })

    const elC = refMap.current.get('c') as HTMLElement
    // FLIP applies translate(0, oldTop - newTop) = translate(0, +58) initially.
    expect(elC.style.transform).toBe('translate(0px, 58px)')
  })

  it('does NOT animate when a new key is added without any removal', () => {
    const { refMap, rerender } = renderFlip(
      ['a'],
      {
        a: { left: 0, top: 0, width: 100, height: 50 }
      }
    )

    // Add 'b'. No removal.
    rerender(['a', 'b'], {
      a: { left: 0, top: 0, width: 100, height: 50 },
      b: { left: 0, top: 58, width: 100, height: 50 }
    })

    const elA = refMap.current.get('a') as HTMLElement
    expect(elA.style.transform).toBe('')
  })
})
