// @vitest-environment jsdom
/**
 * computeOrderedGrouping — sticky per-column ordering used by KanbanBoard.
 * Pane-creation order in the panes array does not match the visual order
 * cards should occupy: a card moving INTO a column should land at the
 * BOTTOM of that column, regardless of when it was originally created.
 */

import { describe, it, expect } from 'vitest'

import { computeOrderedGrouping } from '../../src/renderer/hooks/useColumnOrder'
import type { RendererPane } from '../../src/renderer/hooks/usePaneState'
import type { PaneStatus } from '../../src/shared/types'

const COLUMNS: PaneStatus[] = [
  'awaiting-prompt',
  'planning',
  'plan-ready',
  'needs-input',
  'working',
  'changes-ready'
]

function makePane(id: string, status: PaneStatus): RendererPane {
  return {
    id,
    repoName: 'demo',
    worktreeName: id,
    worktreePath: `/tmp/demo/${id}`,
    isApiBilling: false,
    effort: 'high',
    model: 'opus',
    status,
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
    permissionMode: 'normal'
  }
}

const bucketFor = (pane: RendererPane): PaneStatus => pane.status

describe('computeOrderedGrouping', () => {
  it('first render: panes are placed in panes-array order', () => {
    const panes = [
      makePane('a', 'planning'),
      makePane('b', 'planning'),
      makePane('c', 'working')
    ]
    const grouped = computeOrderedGrouping(panes, COLUMNS, bucketFor, new Map())
    expect(grouped['planning'].map((p) => p.id)).toEqual(['a', 'b'])
    expect(grouped['working'].map((p) => p.id)).toEqual(['c'])
  })

  it('panes that stayed in their column keep their slot when a sibling arrives', () => {
    // Panes-array order is [card1 (older), card2]. Initially card1 in
    // 'awaiting-prompt' and card2 in 'planning'. Then card1 transitions
    // to 'planning'. With panes-array order it would land ABOVE card2,
    // displacing it. With sticky ordering, card2 stays at slot 1 and
    // card1 appends at slot 2.
    const before = [makePane('card1', 'awaiting-prompt'), makePane('card2', 'planning')]
    const beforeGrouped = computeOrderedGrouping(before, COLUMNS, bucketFor, new Map())
    expect(beforeGrouped['planning'].map((p) => p.id)).toEqual(['card2'])

    const prevOrder = new Map<PaneStatus, string[]>()
    for (const status of COLUMNS) prevOrder.set(status, beforeGrouped[status].map((p) => p.id))

    const after = [makePane('card1', 'planning'), makePane('card2', 'planning')]
    const afterGrouped = computeOrderedGrouping(after, COLUMNS, bucketFor, prevOrder)
    expect(afterGrouped['planning'].map((p) => p.id)).toEqual(['card2', 'card1'])
  })

  it('a pane leaving a column drops out of that column', () => {
    const before = [makePane('a', 'planning'), makePane('b', 'planning')]
    const prevOrder = new Map<PaneStatus, string[]>()
    prevOrder.set('planning', ['a', 'b'])
    const after = [makePane('a', 'working'), makePane('b', 'planning')]
    const grouped = computeOrderedGrouping(after, COLUMNS, bucketFor, prevOrder)
    expect(grouped['planning'].map((p) => p.id)).toEqual(['b'])
    expect(grouped['working'].map((p) => p.id)).toEqual(['a'])
  })

  it('a closed pane drops out of every list', () => {
    const prevOrder = new Map<PaneStatus, string[]>()
    prevOrder.set('planning', ['a', 'b'])
    // Close 'a' — it isn't in the panes array anymore.
    const after = [makePane('b', 'planning')]
    const grouped = computeOrderedGrouping(after, COLUMNS, bucketFor, prevOrder)
    expect(grouped['planning'].map((p) => p.id)).toEqual(['b'])
  })

  it('multiple panes arriving in the same column on the same render append in panes-array order', () => {
    const prevOrder = new Map<PaneStatus, string[]>()
    prevOrder.set('planning', ['a'])
    // 'b' and 'c' both transition into planning this render. Tiebreaker
    // should be panes-array order so the result is deterministic.
    const after = [
      makePane('a', 'planning'),
      makePane('b', 'planning'),
      makePane('c', 'planning')
    ]
    const grouped = computeOrderedGrouping(after, COLUMNS, bucketFor, prevOrder)
    expect(grouped['planning'].map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores prev-order entries for panes whose bucket has changed', () => {
    // 'a' was in planning per prev order but its current bucket is working.
    // It should land in working, not planning.
    const prevOrder = new Map<PaneStatus, string[]>()
    prevOrder.set('planning', ['a', 'b'])
    const after = [makePane('a', 'working'), makePane('b', 'planning'), makePane('c', 'working')]
    const grouped = computeOrderedGrouping(after, COLUMNS, bucketFor, prevOrder)
    // 'b' kept its slot in planning. 'a' (moved out of planning) and 'c'
    // (new arrival in working) are in working; 'a' from panes order before 'c'.
    expect(grouped['planning'].map((p) => p.id)).toEqual(['b'])
    expect(grouped['working'].map((p) => p.id)).toEqual(['a', 'c'])
  })
})
