/**
 * FLIP (First, Last, Invert, Play) helper for animating list reflow.
 *
 * Used by KanbanColumn to animate cards sliding up together when one of their
 * siblings is removed (e.g., a card moved to another column or a pane was
 * closed). React does not animate layout shifts on its own — when an item is
 * removed, the remaining children jump to their new positions instantly. FLIP
 * works around this by:
 *   1. (First) capturing each child's bounding rect on each layout pass.
 *   2. (Last) letting the new layout settle.
 *   3. (Invert) applying a transform that places each child back in its
 *      previous position relative to the new one.
 *   4. (Play) transitioning that transform to identity over `durationMs`.
 *
 * Animation gate: the FLIP pass runs ONLY when at least one previously-present
 * key has been removed since the last render — i.e., the column had a card
 * leave. Per the product rule, intra-column reorders, sibling-height changes,
 * and other non-removal layout shifts must not animate. Skipping FLIP on those
 * cases makes them snap instantly, which is the desired behavior.
 *
 * `prefers-reduced-motion: reduce` short-circuits the play step so the CSS
 * transition never runs.
 */

import { useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from './reducedMotion'

/**
 * Animate the children identified by `keys` whose positions changed between
 * the previous render and this one — but only when at least one key was
 * removed. See header comment for the rationale.
 *
 * @param refMap   Map of stable key → DOM element (provided by callsite via ref callback).
 * @param keys     Stable, ordered list of keys present this render.
 * @param durationMs  How long each child takes to glide into place. Use a single
 *                    duration for the whole list so they move in sync.
 */
export function useFlipChildren(
  refMap: React.MutableRefObject<Map<string, HTMLElement | null>>,
  keys: string[],
  durationMs: number
): void {
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map())

  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current

    // Detect whether a previously-present key disappeared from the current
    // render. That's the sole trigger for FLIP — anything else (reorder,
    // sibling height shift, addition) must NOT animate.
    const newKeySet = new Set(keys)
    let anyRemoved = false
    for (const prevKey of prevRects.keys()) {
      if (!newKeySet.has(prevKey)) {
        anyRemoved = true
        break
      }
    }

    // Always capture this render's rects so the next render's comparison
    // sees an accurate prev — independent of whether we animated this tick.
    const newRects = new Map<string, DOMRect>()
    for (const key of keys) {
      const el = refMap.current.get(key)
      if (!el) continue
      newRects.set(key, el.getBoundingClientRect())
    }

    if (anyRemoved && !prefersReducedMotion()) {
      // For each key present in both old and new, apply the inverted transform.
      for (const key of keys) {
        const oldRect = prevRects.get(key)
        const newRect = newRects.get(key)
        const el = refMap.current.get(key)
        if (!oldRect || !newRect || !el) continue
        const dx = oldRect.left - newRect.left
        const dy = oldRect.top - newRect.top
        if (dx === 0 && dy === 0) continue
        // Snap to old position with no transition, force layout, then transition
        // back to identity. The double rAF guarantees the browser commits the
        // pre-transform style before the transition target is set.
        el.style.transition = 'none'
        el.style.transform = `translate(${dx}px, ${dy}px)`
        // Force layout so the transform is committed before we set the target.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        el.getBoundingClientRect()
        requestAnimationFrame(() => {
          el.style.transition = `transform ${durationMs}ms var(--ease-out)`
          el.style.transform = ''
        })
      }
    }

    prevRectsRef.current = newRects
  })
}
