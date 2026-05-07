/**
 * Active-pane slide-up transition queue (Animation A in the Kanban
 * animations plan).
 *
 * Each time `activePaneId` changes, the new pane should slide up from the
 * bottom over the previously-active pane over KANBAN_SLIDE_MS. Rapid clicks
 * queue rather than interrupt: clicking A then B then C plays three
 * sequential 500ms slides, not a single jump-to-C.
 *
 * The hook is purely visual — `WindowShell` still owns the canonical
 * `activePaneId` and dispatches focus + IPC immediately on every click.
 * Keystrokes route to the new pane the moment the user clicks; the slide is
 * decoration on top of that.
 *
 * Output:
 *   - baseLayerPaneId:    the pane currently filling the pane area.
 *   - slidingLayerPaneId: the pane currently sliding up over the base
 *                         (null when no animation is in flight).
 *   - slideProgress01:    0 = sliding pane fully off-screen (bottom);
 *                         1 = fully landed.
 *
 * Notes:
 *   - The very first selection (when baseLayerPaneId is still null) is
 *     instant, with no slide. The plan: animate only when there is a
 *     previously-active pane to slide over.
 *   - Clicking the same pane that is already at the tail of the queue (or
 *     is the current base when the queue is empty) is a no-op.
 *   - prefers-reduced-motion: reduce short-circuits the duration to 0 so
 *     queued targets land instantly while still being drained in order.
 */

import { useEffect, useRef, useState } from 'react'
import { KANBAN_SLIDE_MS } from '../lib/kanbanMotion'
import { prefersReducedMotion } from '../lib/reducedMotion'

export interface KanbanActiveTransitionState {
  baseLayerPaneId: string | null
  slidingLayerPaneId: string | null
  /** 0 → 1 over the slide. Only meaningful when slidingLayerPaneId !== null. */
  slideProgress01: number
}

/** Cubic ease-out — visually matches --ease-out (cubic-bezier(0.2,0.8,0.2,1)). */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function useKanbanActiveTransition(
  activePaneId: string | null,
  disableTransitions: boolean = false
): KanbanActiveTransitionState {
  const [state, setState] = useState<KanbanActiveTransitionState>({
    baseLayerPaneId: null,
    slidingLayerPaneId: null,
    slideProgress01: 0
  })

  // Mutable refs hold the queue + animation state so they don't trigger
  // re-renders. The hook publishes a render-visible snapshot via setState.
  const queueRef = useRef<string[]>([])
  const runningRef = useRef(false)
  const baseRef = useRef<string | null>(null)
  const rafRef = useRef<number | null>(null)

  // Drive the queue when activePaneId changes.
  useEffect(() => {
    if (activePaneId === null) return

    if (disableTransitions) {
      // Snap mode — used during the initial-spawn overlay and any other
      // window where the caller declares this hook should not animate.
      // Drain the queue, abort any in-flight RAF, and update base directly.
      // When disableTransitions later flips to false, this effect re-runs
      // with the latest activePaneId; baseRef will already match it (we
      // snapped to it), so the tail check returns no-op.
      queueRef.current = []
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      runningRef.current = false
      if (baseRef.current !== activePaneId) {
        baseRef.current = activePaneId
        setState({ baseLayerPaneId: activePaneId, slidingLayerPaneId: null, slideProgress01: 0 })
      }
      return
    }

    const queue = queueRef.current
    const tail = queue.length > 0 ? queue[queue.length - 1] : baseRef.current
    if (tail === activePaneId) return

    queue.push(activePaneId)
    if (!runningRef.current) {
      processNext()
    }
    // baseRef is intentionally not a dep — it's a ref. activePaneId and
    // disableTransitions are the inputs; re-running on either covers
    // every click and every overlay transition.
  }, [activePaneId, disableTransitions])

  // Cleanup any in-flight RAF on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  function processNext(): void {
    const queue = queueRef.current
    if (queue.length === 0) {
      runningRef.current = false
      return
    }
    runningRef.current = true
    const target = queue[0]

    // First-pane case OR target already matches base: jump in place.
    if (baseRef.current === null || baseRef.current === target) {
      baseRef.current = target
      setState({ baseLayerPaneId: target, slidingLayerPaneId: null, slideProgress01: 0 })
      queue.shift()
      processNext()
      return
    }

    if (prefersReducedMotion()) {
      baseRef.current = target
      setState({ baseLayerPaneId: target, slidingLayerPaneId: null, slideProgress01: 0 })
      queue.shift()
      processNext()
      return
    }

    // Start a real slide.
    const startBase = baseRef.current
    const startedAt = performance.now()
    setState({ baseLayerPaneId: startBase, slidingLayerPaneId: target, slideProgress01: 0 })

    const animate = (now: number): void => {
      const t = Math.min(1, (now - startedAt) / KANBAN_SLIDE_MS)
      const progress = easeOut(t)
      if (t >= 1) {
        rafRef.current = null
        baseRef.current = target
        setState({ baseLayerPaneId: target, slidingLayerPaneId: null, slideProgress01: 0 })
        queue.shift()
        processNext()
        return
      }
      setState({ baseLayerPaneId: startBase, slidingLayerPaneId: target, slideProgress01: progress })
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
  }

  return state
}
