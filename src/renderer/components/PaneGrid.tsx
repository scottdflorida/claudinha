import React from 'react'
import { Pane } from './Pane'

// ---------------------------------------------------------------------------
// Layout calculation
// ---------------------------------------------------------------------------

export interface GridLayout {
  numCols: number
  numRows: number
}

/**
 * Calculate the optimal grid dimensions for N panes (PRD F3).
 *
 * Algorithm: cols = ceil(sqrt(N)), rows = ceil(N / cols)
 * Minimizes aspect-ratio distortion across pane counts.
 *
 * Exported for unit testing.
 */
export function calcGridLayout(n: number): GridLayout {
  if (n <= 0) return { numCols: 0, numRows: 0 }
  const numCols = Math.ceil(Math.sqrt(n))
  const numRows = Math.ceil(n / numCols)
  return { numCols, numRows }
}

// ---------------------------------------------------------------------------
// PaneGrid
// ---------------------------------------------------------------------------

export type PaneGridLayout = 'wall' | 'kanban-stack'

/**
 * Optional active-pane slide-up transition state for kanban-stack mode.
 * Drives Animation A in the Kanban animations plan: a freshly-active terminal
 * slides up from the bottom over the previously-active one. When `slidingLayerPaneId`
 * is non-null, both the base and the sliding pane are visible simultaneously,
 * with the sliding one carrying a translateY transform that ramps from 100% to 0%.
 */
export interface KanbanStackTransition {
  baseLayerPaneId: string | null
  slidingLayerPaneId: string | null
  /** 0 = sliding pane fully off-screen at bottom; 1 = fully landed. */
  slideProgress01: number
}

interface PaneGridProps {
  paneIds: string[]
  onRequestClosePane?: (paneId: string) => void
  /**
   * Which layout strategy to use:
   *   - 'wall' (default): tiled CSS Grid where every pane is visible.
   *   - 'kanban-stack': all panes mounted as absolute-positioned siblings
   *     filling the same box; only the one matching `activePaneId` is
   *     `visibility: visible` and receives input.
   * The same per-pane wrapper divs render in both layouts so panes never
   * move between React parents on mode switches (L-005, L-008).
   */
  layout?: PaneGridLayout
  /** Required when layout === 'kanban-stack'. Null = none visible. */
  activePaneId?: string | null
  /**
   * Optional active-pane slide-up animation state. When provided in
   * `kanban-stack` mode, the grid renders the base + sliding pane on top of
   * each other with a translateY transform on the sliding one. When omitted
   * (or both layer ids are null), falls back to the activePaneId-driven
   * visibility behavior.
   */
  kanbanTransition?: KanbanStackTransition
}

/**
 * PaneGrid — auto-tiling layout container for all panes in a window (PRD F3),
 * plus the Kanban single-active-terminal stack mode.
 *
 * Uses a single outer container with stable per-pane wrapper divs keyed by
 * `paneId`. The wrapper divs never change parent across layout switches; only
 * their CSS positioning differs. This is critical for L-005/L-008 — every
 * `<Pane>` (and its xterm instance) survives mode toggles and pane add/remove
 * without unmount.
 */
export function PaneGrid({
  paneIds,
  onRequestClosePane,
  layout = 'wall',
  activePaneId = null,
  kanbanTransition
}: PaneGridProps): React.JSX.Element {
  if (paneIds.length === 0) {
    return <div className="w-full h-full bg-terminal-bg" />
  }

  if (layout === 'kanban-stack') {
    // Every pane mounts; only the active one is visible. Hidden panes still
    // have layout (visibility: hidden, not display: none) so xterm sizes
    // correctly via ResizeObserver. Per L-005/L-008, the same wrapper div per
    // paneId is used in both 'wall' and 'kanban-stack' layouts, so flipping
    // `layout` never destroys an xterm instance.
    //
    // When a kanban-transition is in flight, two wrappers are visible at once:
    // the base layer holds steady at translateY(0) while the sliding layer
    // animates up from translateY(100%). The non-participating wrappers stay
    // hidden. The map order, keys, and wrapper div identity never change —
    // only inline `style` mutates, preserving the L-005/L-008 invariant.
    const sliding = kanbanTransition?.slidingLayerPaneId ?? null
    const baseLayer = sliding !== null
      ? kanbanTransition?.baseLayerPaneId ?? null
      : null
    const slidingProgress = kanbanTransition?.slideProgress01 ?? 0

    return (
      <div className="w-full h-full relative">
        {paneIds.map((paneId) => {
          const isSliding = sliding !== null && paneId === sliding
          const isBase = baseLayer !== null && paneId === baseLayer
          const isFallbackActive = sliding === null && paneId === activePaneId
          const isVisible = isSliding || isBase || isFallbackActive
          // Pointer events go to the topmost visible layer:
          //   - During a slide: the sliding (incoming) layer captures input.
          //   - Idle: the active pane.
          const acceptsPointer = isSliding || (sliding === null && isFallbackActive)
          // Translate the sliding layer up from the bottom. progress=0 → 100%
          // off-screen, progress=1 → 0 (landed).
          const slidingTransform = isSliding
            ? `translateY(${(1 - slidingProgress) * 100}%)`
            : undefined
          return (
            <div
              key={paneId}
              style={{
                position: 'absolute',
                inset: 0,
                visibility: isVisible ? 'visible' : 'hidden',
                pointerEvents: acceptsPointer ? 'auto' : 'none',
                // Sliding layer sits above the base so it covers it as it rises.
                zIndex: isSliding ? 1 : 0,
                transform: slidingTransform,
                // No CSS transition — transform updates per-frame from RAF.
                willChange: isSliding ? 'transform' : undefined
              }}
              aria-hidden={!isVisible}
            >
              <Pane paneId={paneId} onRequestClose={onRequestClosePane} chromeMode="kanban" isVisible={isVisible} />
            </div>
          )
        })}
      </div>
    )
  }

  // ---- Wall layout (existing behavior) ----------------------------------

  const { numCols, numRows } = calcGridLayout(paneIds.length)

  // When the last row is incomplete, use a finer grid so last-row panes
  // share equal width (matching the old flex-row behavior where each pane
  // in a short row stretched equally). E.g. 3 panes in 2 cols: last pane
  // spans full width. 5 panes in 3 cols: last 2 each get 50%.
  const lastRowCount = paneIds.length % numCols || numCols
  const isLastRowFull = lastRowCount === numCols

  function gcd(a: number, b: number): number {
    while (b !== 0) { const t = b; b = a % t; a = t }
    return a
  }

  const gridCols = isLastRowFull ? numCols : (numCols * lastRowCount) / gcd(numCols, lastRowCount)
  const fullRowSpan = gridCols / numCols
  const lastRowSpan = isLastRowFull ? fullRowSpan : gridCols / lastRowCount
  const lastRowStartIndex = paneIds.length - lastRowCount

  // Row gap: sized so the status pill (top) and metrics pill (bottom) of
  // vertically adjacent panes can both straddle their borders (~11px each)
  // with visible breathing room between them.
  //
  // Column gap: tighter. PaneBorder's focused box-shadow halo extends 10px
  // out on each side, so two (hypothetically) both-focused halos consume
  // 20px of the gap. A 24px column gap leaves ~4px of clean space between
  // the halo edges in that worst case — the intended "just kissing" feel.
  const rowGapPx = 32
  const columnGapPx = 24

  return (
    <div
      className="w-full h-full"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gridTemplateRows: `repeat(${numRows}, 1fr)`,
        rowGap: rowGapPx,
        columnGap: columnGapPx,
        padding: 16
      }}
    >
      {paneIds.map((paneId, index) => {
        const isInLastRow = !isLastRowFull && index >= lastRowStartIndex
        const span = isInLastRow ? lastRowSpan : fullRowSpan
        return (
          <div
            key={paneId}
            style={{
              minWidth: 0,
              minHeight: 0,
              height: '100%',
              gridColumn: `span ${span}`
            }}
          >
            <Pane paneId={paneId} onRequestClose={onRequestClosePane} />
          </div>
        )
      })}
    </div>
  )
}
