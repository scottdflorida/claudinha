/**
 * Sticky per-column ordering for the Kanban board.
 *
 * Without this hook, KanbanBoard would group panes by their order in the
 * `panes` prop (which reflects pane-creation order). That order is wrong on
 * two counts:
 *   1. A card moving from column A to column B should land at the BOTTOM of
 *      B (it's the new arrival), not at whatever slot pane-creation order
 *      places it. With pane-creation-order grouping, an older pane that
 *      moves into a column with a younger pane will stack ABOVE the younger
 *      pane on landing — which the user perceives as a "swap."
 *   2. While a card is briefly being inserted into the destination column on
 *      the render before the move's overlay activates, FLIP detects the
 *      resident card's slot shifting and animates it. The product rule is
 *      that no card should ever move within a column except as
 *      compaction-from-below when its sibling leaves.
 *
 * The fix is a sticky order: panes that stayed in their column keep their
 * relative position, and panes whose bucket just changed are appended to
 * their new column.
 */

import { useLayoutEffect, useRef } from 'react'
import type { PaneStatus } from '../../shared/types'
import type { RendererPane } from './usePaneState'

/**
 * Return `panes` grouped by column with each column's list ordered as:
 *   [...panes that were already in this column on the previous render,
 *    ...panes whose bucket just changed to this column]
 *
 * Closed panes drop out automatically (they aren't in `panes` so they
 * vanish from every list).
 *
 * @param panes        The currently-displayed panes (post-displayedColumn override).
 * @param columns      The list of column statuses, in board order.
 * @param bucketFor    Map a pane to its column status. Must match the same
 *                     function used elsewhere in the board.
 */
export function useColumnOrder(
  panes: RendererPane[],
  columns: readonly PaneStatus[],
  bucketFor: (pane: RendererPane) => PaneStatus
): Record<PaneStatus, RendererPane[]> {
  const prevColumnOrderRef = useRef<Map<PaneStatus, string[]>>(new Map())

  const grouped = computeOrderedGrouping(panes, columns, bucketFor, prevColumnOrderRef.current)

  // Snapshot this render's order for next render's stickiness. Use a
  // layout effect so the snapshot lines up with FLIP's prevRects (also
  // captured in a layout effect on this render).
  useLayoutEffect(() => {
    const next = new Map<PaneStatus, string[]>()
    for (const status of columns) {
      next.set(status, grouped[status].map((p) => p.id))
    }
    prevColumnOrderRef.current = next
  })

  return grouped
}

/**
 * Pure helper, exported for unit testing. Given the previous render's
 * per-column id lists and the current render's panes, compute the new
 * grouping with sticky ordering.
 */
export function computeOrderedGrouping(
  panes: RendererPane[],
  columns: readonly PaneStatus[],
  bucketFor: (pane: RendererPane) => PaneStatus,
  prevColumnOrder: Map<PaneStatus, string[]>
): Record<PaneStatus, RendererPane[]> {
  const paneById = new Map<string, RendererPane>()
  for (const pane of panes) paneById.set(pane.id, pane)

  const grouped: Record<string, RendererPane[]> = {}
  for (const status of columns) grouped[status] = []

  // Track which panes we've already placed so new-arrival appending
  // doesn't double-count panes that were in this column's prev order.
  const placed = new Set<string>()

  for (const status of columns) {
    const prevIds = prevColumnOrder.get(status) ?? []
    for (const id of prevIds) {
      const pane = paneById.get(id)
      if (pane && bucketFor(pane) === status) {
        grouped[status].push(pane)
        placed.add(id)
      }
    }
  }

  // Append new arrivals (any pane not yet placed). Use the panes-array
  // order as the tiebreak when multiple cards arrive in the same column
  // on the same render — keeps the result stable / deterministic.
  for (const pane of panes) {
    if (placed.has(pane.id)) continue
    const status = bucketFor(pane)
    if (grouped[status]) {
      grouped[status].push(pane)
      placed.add(pane.id)
    }
  }

  return grouped as Record<PaneStatus, RendererPane[]>
}
