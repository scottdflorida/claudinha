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
  activePaneId = null
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
    return (
      <div className="w-full h-full relative">
        {paneIds.map((paneId) => {
          const isVisible = paneId === activePaneId
          return (
            <div
              key={paneId}
              style={{
                position: 'absolute',
                inset: 0,
                visibility: isVisible ? 'visible' : 'hidden',
                pointerEvents: isVisible ? 'auto' : 'none'
              }}
              aria-hidden={!isVisible}
            >
              <Pane paneId={paneId} onRequestClose={onRequestClosePane} chromeMode="kanban" />
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
