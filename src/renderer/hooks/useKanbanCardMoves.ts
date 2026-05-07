/**
 * Card column-move queue (Animation B in the Kanban animations plan), with
 * the side-effect compaction of source columns (Animation C is wired in
 * KanbanColumn via the FLIP helper, driven by the displayedPanes shape
 * change this hook produces).
 *
 * Source of truth: `panes[].status` (the bucketed column).
 * Display layer: `displayedPanes` lags the source while a card is in flight.
 *
 *   - When a pane's real bucket changes such that its column would change,
 *     enqueue a move from the displayed column to the real one.
 *   - Process the queue serially: only one card slides at a time. Mid-flight
 *     status changes for other panes wait their turn; mid-flight changes for
 *     the *currently moving* pane re-queue from the landed column to the new
 *     real column once the in-flight animation lands.
 *   - Rects are tracked FLIP-style: each render captures the live positions
 *     of every card and drop target into a "current" map; the previous
 *     render's map is shifted into "prev". When a move starts (in the same
 *     layout-effect tick that detects the bucket change), `fromRect` reads
 *     from prev — the card's position in its SOURCE column, before React
 *     re-rendered it into the destination — and `toRect` reads the
 *     destination column's drop-target position from before the card joined
 *     it (i.e., the actual landing slot, not the slot below the card).
 *     Measuring against the live refs at this point would put both rects
 *     inside the destination column and the overlay would drift one
 *     card-height instead of crossing source → destination.
 *     Distance → duration via computeMoveDuration so further moves take
 *     longer at constant speed.
 *   - During flight, the moving pane is omitted from `displayedPanes` (so it
 *     does not render in either source or destination column) and the
 *     consumer renders an overlay clone via `movingCard`.
 *   - On landing, the displayed column for that pane updates to the real
 *     status and the overlay clears.
 *
 * Reduced-motion: skips overlay, instantly updates displayedColumn.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PaneStatus } from '../../shared/types'
import type { RendererPane } from './usePaneState'
import { computeMoveDuration } from '../lib/kanbanMotion'
import { prefersReducedMotion } from '../lib/reducedMotion'

/** Column membership rule mirrored from KanbanBoard.bucketFor. */
function bucketFor(pane: RendererPane): PaneStatus {
  // Must stay in lockstep with KanbanBoard.bucketFor — if these disagree, a
  // card-move animation would aim at one column while the card actually lands
  // in another, producing a visible glitch.
  if (pane.status === 'working' && pane.permissionMode === 'plan') {
    return 'planning'
  }
  return pane.status
}

export interface KanbanMovingCard {
  pane: RendererPane
  fromRect: DOMRect
  toRect: DOMRect
  durationMs: number
  startedAt: number
}

export interface KanbanCardMovesState {
  /**
   * Panes with `status` overridden to the displayed column while a move is
   * pending. The currently-moving pane is *omitted* entirely so it doesn't
   * render in either source or destination column (it lives in `movingCard`
   * as an overlay clone).
   */
  displayedPanes: RendererPane[]
  movingCard: KanbanMovingCard | null
}

export interface KanbanCardMovesRefs {
  /** Map of paneId -> current card DOM element (for fromRect measurement). */
  cardRefs: React.MutableRefObject<Map<string, HTMLElement | null>>
  /** Map of column status -> bottom drop-target DOM element (for toRect). */
  dropTargetRefs: React.MutableRefObject<Map<PaneStatus, HTMLElement | null>>
}

interface PendingMove {
  paneId: string
  /**
   * The bucket the card was sitting in when the move was enqueued. We
   * capture it here so the queue runner doesn't have to re-derive it from
   * the (already-updated) real status.
   */
  fromBucket: PaneStatus
  toBucket: PaneStatus
}

export function useKanbanCardMoves(
  panes: RendererPane[],
  refs: KanbanCardMovesRefs
): KanbanCardMovesState {
  // displayedColumn[paneId] = the bucket the card is currently rendered in.
  // When undefined, the card uses its real bucket.
  const [displayedColumn, setDisplayedColumn] = useState<Record<string, PaneStatus>>({})
  const [movingCard, setMovingCard] = useState<KanbanMovingCard | null>(null)

  // Mutable queue + scheduling state.
  const queueRef = useRef<PendingMove[]>([])
  const runningRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the last real bucket we observed per pane so we only enqueue on
  // genuine changes (not every re-render).
  const lastSeenRealBucketRef = useRef<Map<string, PaneStatus>>(new Map())
  // Snapshot the latest real panes for use inside the async queue runner.
  const panesRef = useRef<RendererPane[]>(panes)
  panesRef.current = panes

  // Snapshot displayedColumn for use inside the queue runner without being a
  // React-rerender dep there.
  const displayedColumnRef = useRef<Record<string, PaneStatus>>({})
  displayedColumnRef.current = displayedColumn

  // Rect snapshots, FLIP-style. We need fromRect to be the card's position in
  // its SOURCE column (i.e., from the render BEFORE the bucket-changing
  // panes update) and toRect to be the destination drop target's position
  // BEFORE the moving card was inserted there. Measuring at processNext time
  // is too late: by then React has already re-rendered the card into the
  // destination column, so the live cardRef points at the destination wrapper
  // and the live dropTargetRef sits below the card's new slot — which would
  // make the overlay drift inside the destination column instead of
  // crossing source → destination.
  //
  // Each layout-effect tick shifts current → prev, then captures fresh rects
  // into current. By the end of render N's layout effect, prev = render N-1
  // and current = render N. The watcher reads prev to get the source-column
  // rects of the cards that just moved buckets.
  const currentCardRectsRef = useRef<Map<string, DOMRect>>(new Map())
  const prevCardRectsRef = useRef<Map<string, DOMRect>>(new Map())
  const currentDropRectsRef = useRef<Map<PaneStatus, DOMRect>>(new Map())
  const prevDropRectsRef = useRef<Map<PaneStatus, DOMRect>>(new Map())

  useLayoutEffect(() => {
    // Shift current → prev before capturing this render's rects.
    prevCardRectsRef.current = currentCardRectsRef.current
    prevDropRectsRef.current = currentDropRectsRef.current

    const newCardRects = new Map<string, DOMRect>()
    for (const [id, el] of refs.cardRefs.current.entries()) {
      if (el) newCardRects.set(id, el.getBoundingClientRect())
    }
    currentCardRectsRef.current = newCardRects

    const newDropRects = new Map<PaneStatus, DOMRect>()
    for (const [status, el] of refs.dropTargetRefs.current.entries()) {
      if (el) newDropRects.set(status, el.getBoundingClientRect())
    }
    currentDropRectsRef.current = newDropRects
  })

  // ---------------------------------------------------------------------------
  // Watch real status changes -> enqueue moves
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    let touched = false

    // Drop bookkeeping for panes that have disappeared.
    const livePaneIds = new Set(panes.map((p) => p.id))
    for (const id of Array.from(lastSeenRealBucketRef.current.keys())) {
      if (!livePaneIds.has(id)) {
        lastSeenRealBucketRef.current.delete(id)
        // Also drop the displayed override so a future re-spawn with the same
        // id (vanishingly unlikely but cheap) starts clean.
        if (displayedColumnRef.current[id] !== undefined) {
          setDisplayedColumn((prev) => {
            const { [id]: _drop, ...rest } = prev
            return rest
          })
        }
      }
    }

    for (const pane of panes) {
      const realBucket = bucketFor(pane)
      const lastSeen = lastSeenRealBucketRef.current.get(pane.id)
      lastSeenRealBucketRef.current.set(pane.id, realBucket)

      // First time we see this pane (just spawned): no entrance animation
      // per the plan. Falling back to the real bucket is correct, so we
      // don't seed displayedColumn.
      if (lastSeen === undefined) continue

      // No real change → nothing to do.
      if (lastSeen === realBucket) continue

      // Real bucket changed. Enqueue a move.
      //
      // Per the plan: in-flight animations always land at their planned
      // destination. So we never mutate queue[0] when it's running. We
      // mutate the latest pending entry (if any) to absorb additional
      // status drift; otherwise append a fresh entry whose fromBucket is
      // wherever the previous queue entry would land (or the displayed
      // column if no queue entry).
      const queue = queueRef.current
      const runningEntry = runningRef.current && queue.length > 0 ? queue[0] : null
      // The candidate to mutate is the LAST pending entry for this pane
      // (skip queue[0] if running).
      const pendingStartIdx = runningEntry ? 1 : 0
      let lastPending: PendingMove | undefined
      for (let i = queue.length - 1; i >= pendingStartIdx; i--) {
        if (queue[i].paneId === pane.id) {
          lastPending = queue[i]
          break
        }
      }
      if (lastPending) {
        lastPending.toBucket = realBucket
      } else {
        // fromBucket = the bucket the card will be in by the time this
        // entry starts executing. If there's a running entry for this
        // pane, that's its toBucket (the card will have landed there).
        // Otherwise it's the current displayed column (override or
        // previously-seen real bucket).
        const fromBucket =
          runningEntry && runningEntry.paneId === pane.id
            ? runningEntry.toBucket
            : displayedColumnRef.current[pane.id] ?? lastSeen
        queue.push({ paneId: pane.id, fromBucket, toBucket: realBucket })
      }
      touched = true
    }

    if (touched && !runningRef.current) {
      // Layout effect: rect refs already captured this render (the
      // capture useLayoutEffect runs before this one, since it appears
      // first). processNext reads prev rects, which hold the previous
      // render's positions — the source-column position of the card that
      // just moved buckets. Calling synchronously means the overlay is
      // set up inside the same React turn, before paint.
      processNext()
    }
    // panes is the only meaningful input. We use refs for everything else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes])

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Queue runner
  // ---------------------------------------------------------------------------
  function processNext(): void {
    const queue = queueRef.current
    if (queue.length === 0) {
      runningRef.current = false
      return
    }
    runningRef.current = true
    const next = queue[0]

    const pane = panesRef.current.find((p) => p.id === next.paneId)
    if (!pane) {
      // Pane vanished while queued. Drop and continue.
      queue.shift()
      processNext()
      return
    }

    // What column is the card currently rendered in? Prefer the queue
    // entry's fromBucket (captured at enqueue time, before the watch effect
    // updated lastSeen) so we don't accidentally short-circuit when real
    // status has already advanced past displayed.
    const fromBucket = next.fromBucket
    const toBucket = next.toBucket

    if (fromBucket === toBucket) {
      // Real status drifted back to where the card already sits. Just sync.
      setDisplayedColumn((prev) => {
        const { [pane.id]: _drop, ...rest } = prev
        // If the displayed override matched real, drop it.
        if (bucketFor(pane) === toBucket) return rest
        return { ...prev, [pane.id]: toBucket }
      })
      queue.shift()
      processNext()
      return
    }

    // Source-column rects from the previous render: where the card was
    // sitting before this render moved it to its real (destination) bucket,
    // and where the destination's drop target sat before the card joined
    // its column. Live refs would point at the destination column for both
    // (the card's wrapper has just been remounted there, and the drop
    // target sits below the card's new slot), so we MUST use the prev
    // snapshot for the overlay to cross columns instead of drifting
    // inside the destination column.
    const fromRect = prevCardRectsRef.current.get(pane.id) ?? null
    const toRect = prevDropRectsRef.current.get(toBucket) ?? null

    if (!fromRect || !toRect || prefersReducedMotion()) {
      // Prev rect missing (first render, or pane / column wasn't in the DOM
      // last paint) or user opted out of motion. Snap.
      setDisplayedColumn((prev) => {
        // If the move lands on real bucket, drop the override entirely.
        const realBucket = bucketFor(pane)
        if (realBucket === toBucket) {
          const { [pane.id]: _drop, ...rest } = prev
          return rest
        }
        return { ...prev, [pane.id]: toBucket }
      })
      queue.shift()
      processNext()
      return
    }
    const dx = toRect.left - fromRect.left
    const dy = toRect.top - fromRect.top
    const distance = Math.sqrt(dx * dx + dy * dy)
    const durationMs = computeMoveDuration(distance)
    const startedAt = performance.now()

    // Pin this pane to the source column (so it's NOT re-rendered into the
    // destination column) and start the overlay. Since the hook returns
    // `displayedPanes` with the moving pane omitted, the source column
    // simultaneously loses the card — its remaining cards will FLIP-compact
    // (Animation C) on the next render.
    setDisplayedColumn((prev) => ({ ...prev, [pane.id]: fromBucket }))
    setMovingCard({ pane, fromRect, toRect, durationMs, startedAt })

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      // Land: clear overlay, sync displayed column to real (or to toBucket
      // if real has drifted onward — the next queue entry will catch up).
      setMovingCard(null)
      setDisplayedColumn((prev) => {
        const realPane = panesRef.current.find((p) => p.id === pane.id)
        const realBucket = realPane ? bucketFor(realPane) : toBucket
        if (realBucket === toBucket) {
          // Landed on real. Drop the override.
          const { [pane.id]: _drop, ...rest } = prev
          return rest
        }
        // Real has drifted (e.g., another status change happened mid-flight).
        // Pin to the landing bucket; the watch effect will enqueue another
        // move from here to realBucket on its next pass.
        return { ...prev, [pane.id]: toBucket }
      })
      queue.shift()
      // After landing, check if this pane's real bucket diverged from
      // toBucket — if so, the watch effect already added a follow-up entry
      // (or will, on the next paint). Either way, processNext drains it.
      processNext()
    }, durationMs)
  }

  // ---------------------------------------------------------------------------
  // Project displayedPanes
  // ---------------------------------------------------------------------------
  const displayedPanes = useMemo(() => {
    // Omit the in-flight pane entirely (it's rendered in the overlay).
    const movingId = movingCard?.pane.id ?? null
    const out: RendererPane[] = []
    for (const pane of panes) {
      if (pane.id === movingId) continue
      const override = displayedColumn[pane.id]
      if (override !== undefined && override !== bucketFor(pane)) {
        // Project an override by spoofing status. The status field drives
        // KanbanBoard.bucketFor which is the only column-routing input.
        // Note: 'error' bucket is also entered via terminated=true; if the
        // override is 'error', we set status='error' to force it. If the
        // override is something else and the pane is terminated, we still
        // need to keep terminated=true so other UI (PTY exited badge) is
        // accurate — but bucketFor would route to 'error' regardless.
        // Practically: terminated panes can't migrate out of 'error', so
        // an override that disagrees won't happen.
        out.push({ ...pane, status: override })
      } else {
        out.push(pane)
      }
    }
    return out
  }, [panes, displayedColumn, movingCard])

  return { displayedPanes, movingCard }
}
