/**
 * Kanban animation tuning constants.
 *
 * Co-located here so all three Kanban animations (active-pane slide-up, card
 * column move, old-column compaction) share a single grep target for
 * by-feel tuning after visual QA.
 */

/** Active-pane slide-up duration (Animation A). */
export const KANBAN_SLIDE_MS = 500

/**
 * Card column move (Animation B) speed in pixels per millisecond.
 * Higher = faster. A 600px diagonal at 1.5px/ms ≈ 400ms — the user-targeted
 * average. Tune by feel.
 */
export const KANBAN_PX_PER_MS = 1.5

/**
 * Floor / ceiling for the card move duration so very short moves still feel
 * deliberate and very long moves don't drag.
 */
export const KANBAN_MOVE_MIN_MS = 200
export const KANBAN_MOVE_MAX_MS = 800

/**
 * Old-column compaction (Animation C) fallback duration when there is no
 * concurrent in-flight card move to sync to (e.g., a pane was closed rather
 * than moved). When a move is in flight, columns use that move's duration
 * so card-leaving and gap-closing land together.
 */
export const KANBAN_COMPACT_MS = 300

/**
 * Compute the duration for a card move based on euclidean travel distance,
 * clamped to [min, max].
 */
export function computeMoveDuration(distancePx: number): number {
  const raw = distancePx / KANBAN_PX_PER_MS
  if (raw < KANBAN_MOVE_MIN_MS) return KANBAN_MOVE_MIN_MS
  if (raw > KANBAN_MOVE_MAX_MS) return KANBAN_MOVE_MAX_MS
  return raw
}
