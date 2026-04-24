import { describe, it, expect } from 'vitest'
import { buildPaneCloseOptions, buildUnmergedCallout, type PaneCloseDescriptor } from '../../src/renderer/lib/pane-close-options'
import type { PaneStatus } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function desc(overrides: Partial<PaneCloseDescriptor> = {}): PaneCloseDescriptor {
  return {
    status: 'working',
    isWorktree: true,
    isUntouched: false,
    hasUncommittedChanges: false,
    changedFileCount: 0,
    commitsAhead: 0,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Bypass rules — silent close (no modal)
// ---------------------------------------------------------------------------

describe('buildPaneCloseOptions — bypass paths', () => {
  it('bypasses an untouched awaiting-prompt worktree pane with prune-close', () => {
    const r = buildPaneCloseOptions(desc({ status: 'awaiting-prompt', isUntouched: true, isWorktree: true }))
    expect(r.bypass).toBe('prune-close')
    expect(r.buttons).toHaveLength(0)
  })

  it('bypasses an untouched awaiting-prompt non-worktree pane with close-non-worktree', () => {
    const r = buildPaneCloseOptions(desc({ status: 'awaiting-prompt', isUntouched: true, isWorktree: false }))
    expect(r.bypass).toBe('close-non-worktree')
    expect(r.buttons).toHaveLength(0)
  })

  it('bypasses a done + clean worktree pane with prune-close', () => {
    const r = buildPaneCloseOptions(desc({ status: 'done', isWorktree: true }))
    expect(r.bypass).toBe('prune-close')
  })

  it('bypasses a done non-worktree pane with close-non-worktree', () => {
    const r = buildPaneCloseOptions(desc({ status: 'done', isWorktree: false }))
    expect(r.bypass).toBe('close-non-worktree')
  })

  it('does NOT bypass a done pane with uncommitted changes', () => {
    const r = buildPaneCloseOptions(desc({ status: 'done', hasUncommittedChanges: true, changedFileCount: 2 }))
    expect(r.bypass).toBeUndefined()
  })

  it('does NOT bypass a done pane with commits ahead of main', () => {
    const r = buildPaneCloseOptions(desc({ status: 'done', commitsAhead: 3 }))
    expect(r.bypass).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Worktree, done + unmerged — the full three-action set with merge as primary
// ---------------------------------------------------------------------------

describe('buildPaneCloseOptions — done + unmerged (worktree)', () => {
  it('offers keep, prune, and merge (primary) in that order', () => {
    const r = buildPaneCloseOptions(desc({ status: 'done', commitsAhead: 2 }))
    expect(r.buttons.map((b) => b.action)).toEqual(['keep-close', 'prune-close', 'merge-close'])
    expect(r.buttons[2].variant).toBe('primary')
  })

  it('attaches a destructive warning to prune when uncommitted files exist', () => {
    const r = buildPaneCloseOptions(desc({ status: 'done', hasUncommittedChanges: true, changedFileCount: 4, commitsAhead: 1 }))
    const prune = r.buttons.find((b) => b.action === 'prune-close')!
    expect(prune.variant).toBe('destructive')
    expect(prune.warning).toBe('4 uncommitted files will be discarded')
  })

  it('omits the warning when prune is chosen on a commits-only branch (no uncommitted)', () => {
    const r = buildPaneCloseOptions(desc({ status: 'done', commitsAhead: 2 }))
    const prune = r.buttons.find((b) => b.action === 'prune-close')!
    expect(prune.warning).toBeUndefined()
  })

  it('uses singular wording for a single uncommitted file', () => {
    const r = buildPaneCloseOptions(desc({ status: 'done', hasUncommittedChanges: true, changedFileCount: 1, commitsAhead: 1 }))
    const prune = r.buttons.find((b) => b.action === 'prune-close')!
    expect(prune.warning).toBe('1 uncommitted file will be discarded')
  })

  it('surfaces the unmerged callout with files and commits', () => {
    const r = buildPaneCloseOptions(desc({ status: 'done', hasUncommittedChanges: true, changedFileCount: 3, commitsAhead: 2 }))
    expect(r.unmergedCallout).toBe('3 files modified · 2 commits ahead of main')
  })
})

// ---------------------------------------------------------------------------
// Worktree, busy / needs-input / error / touched-awaiting — no merge option
// ---------------------------------------------------------------------------

describe('buildPaneCloseOptions — busy + worktree', () => {
  const busyStates: PaneStatus[] = ['working', 'needs-input', 'error']

  for (const status of busyStates) {
    it(`offers only keep-close and prune-close for status ${status}`, () => {
      const r = buildPaneCloseOptions(desc({ status }))
      expect(r.buttons.map((b) => b.action)).toEqual(['keep-close', 'prune-close'])
      expect(r.buttons.find((b) => b.action === 'merge-close')).toBeUndefined()
    })

    it(`surfaces the status copy for ${status}`, () => {
      const r = buildPaneCloseOptions(desc({ status }))
      expect(r.statusLine).toMatch(/^Terminal is/)
    })

    it(`warns on prune when ${status} + uncommitted`, () => {
      const r = buildPaneCloseOptions(desc({ status, hasUncommittedChanges: true, changedFileCount: 2 }))
      const prune = r.buttons.find((b) => b.action === 'prune-close')!
      expect(prune.warning).toBe('2 uncommitted files will be discarded')
    })

    it(`does not warn when ${status} + clean`, () => {
      const r = buildPaneCloseOptions(desc({ status }))
      const prune = r.buttons.find((b) => b.action === 'prune-close')!
      expect(prune.warning).toBeUndefined()
    })
  }

  it('offers the same keep/prune set for a touched awaiting-prompt pane', () => {
    // isUntouched=false (tokens sent) but still awaiting-prompt — user backed
    // out before the model started. Still worth a confirmation.
    const r = buildPaneCloseOptions(desc({ status: 'awaiting-prompt', isUntouched: false }))
    expect(r.buttons.map((b) => b.action)).toEqual(['keep-close', 'prune-close'])
  })
})

// ---------------------------------------------------------------------------
// Non-worktree panes — single "Close anyway" for busy states
// ---------------------------------------------------------------------------

describe('buildPaneCloseOptions — non-worktree', () => {
  const busyStates: PaneStatus[] = ['working', 'needs-input', 'error']

  for (const status of busyStates) {
    it(`offers one Close anyway button for ${status}`, () => {
      const r = buildPaneCloseOptions(desc({ status, isWorktree: false }))
      expect(r.buttons).toHaveLength(1)
      expect(r.buttons[0].action).toBe('close-non-worktree')
      expect(r.buttons[0].variant).toBe('primary')
    })
  }

  it('does not surface an unmerged callout for non-worktree panes', () => {
    // Even if the underlying repo reports uncommitted, non-worktree panes
    // don't own a branch, so no callout is shown.
    const r = buildPaneCloseOptions(desc({
      status: 'working',
      isWorktree: false,
      hasUncommittedChanges: true,
      changedFileCount: 5
    }))
    expect(r.unmergedCallout).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// buildUnmergedCallout — unit tests
// ---------------------------------------------------------------------------

describe('buildUnmergedCallout', () => {
  it('returns null for a clean branch', () => {
    expect(buildUnmergedCallout(0, 0)).toBeNull()
  })

  it('returns file count only when no commits ahead', () => {
    expect(buildUnmergedCallout(3, 0)).toBe('3 files modified')
  })

  it('returns commits only when no files modified', () => {
    expect(buildUnmergedCallout(0, 2)).toBe('2 commits ahead of main')
  })

  it('joins both parts with a middle dot', () => {
    expect(buildUnmergedCallout(4, 1)).toBe('4 files modified · 1 commit ahead of main')
  })

  it('uses singular wording for one of each', () => {
    expect(buildUnmergedCallout(1, 1)).toBe('1 file modified · 1 commit ahead of main')
  })
})
