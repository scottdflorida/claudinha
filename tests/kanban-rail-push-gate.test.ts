/**
 * Regression test for the Kanban repo rail's Push button enable predicate.
 *
 * The bug: with a freshly-spawned workspace (every pane in `awaiting-prompt`)
 * Push lit up whenever the user's local main was ahead of origin/main —
 * including from prior unrelated work outside the current workspace. The
 * other three bulk-action buttons (Merge, Merge + push, Create PR) are
 * gated on agent activity (readyCount > 0); Push was the asymmetric outlier.
 *
 * The fix tightens Push to require both:
 *   (a) baseAheadOfOrigin > 0
 *   (b) ≥1 pane in this repo with paneStatus !== 'awaiting-prompt'
 *
 * `computeCanPush` is the pure helper exported from KanbanRepoRail.tsx; we
 * drive it directly here so the test stays in vitest's node environment and
 * doesn't pull in DOM / React infrastructure.
 */

import { describe, it, expect } from 'vitest'
import { computeCanPush } from '../src/renderer/components/KanbanRepoRail'

describe('KanbanRepoRail — Push gate', () => {
  it('disabled when base is at origin (no unpushed commits)', () => {
    expect(
      computeCanPush({ baseAheadOfOrigin: 0 }, [{ paneStatus: 'working' }])
    ).toBe(false)
  })

  it('disabled when baseAheadOfOrigin is null (unknown / no remote)', () => {
    expect(
      computeCanPush({ baseAheadOfOrigin: null }, [{ paneStatus: 'working' }])
    ).toBe(false)
  })

  it('disabled when base is ahead but every pane is awaiting-prompt (the regression)', () => {
    expect(
      computeCanPush(
        { baseAheadOfOrigin: 5 },
        Array.from({ length: 11 }, () => ({ paneStatus: 'awaiting-prompt' as const }))
      )
    ).toBe(false)
  })

  it('enabled when base is ahead AND at least one pane has been engaged', () => {
    expect(
      computeCanPush(
        { baseAheadOfOrigin: 1 },
        [{ paneStatus: 'awaiting-prompt' }, { paneStatus: 'working' }]
      )
    ).toBe(true)
  })

  it('enabled regardless of which non-awaiting state the engaged pane is in', () => {
    for (const status of ['working', 'needs-input', 'done', 'error'] as const) {
      expect(
        computeCanPush({ baseAheadOfOrigin: 2 }, [{ paneStatus: status }])
      ).toBe(true)
    }
  })

  it('disabled when there are no panes at all in this repo', () => {
    expect(computeCanPush({ baseAheadOfOrigin: 5 }, [])).toBe(false)
  })
})
