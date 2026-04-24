import { describe, it, expect } from 'vitest'
import { wouldExceedMinPaneSize, validateSpawnPayload, stripWorktreesSuffix } from '../../src/renderer/lib/spawn-validation'
import {
  MIN_PANE_COLS,
  MIN_PANE_ROWS,
  HEADER_ROW1_HEIGHT_PX,
  HEADER_ROW2_HEIGHT_PX,
  HEADER_SEPARATOR_HEIGHT_PX
} from '../../src/renderer/lib/constants'

// Mirror the lib's per-pane minimum computation so the test stays in sync if
// the underlying constants change.
const HEADER_H = HEADER_ROW1_HEIGHT_PX + HEADER_ROW2_HEIGHT_PX + HEADER_SEPARATOR_HEIGHT_PX
const MIN_PIXEL_WIDTH = MIN_PANE_COLS * 8
const MIN_PIXEL_HEIGHT = MIN_PANE_ROWS * 17 + HEADER_H

describe('wouldExceedMinPaneSize', () => {
  it('returns false for a large window with 1 existing pane', () => {
    // 2 panes → 2x1 grid → each pane is 960x540 — well above minimums
    expect(wouldExceedMinPaneSize(1, 1920, 1080)).toBe(false)
  })

  it('returns false for a single pane in a moderately sized window', () => {
    // 1 pane → 1x1 grid → 800x600
    expect(wouldExceedMinPaneSize(0, 800, 600)).toBe(false)
  })

  it('returns true when window is too narrow', () => {
    // With 1 existing pane → 2 panes → 2 cols
    // Window width too small for 2 columns of MIN_PIXEL_WIDTH each
    const tooNarrow = MIN_PIXEL_WIDTH * 2 - 2
    expect(wouldExceedMinPaneSize(1, tooNarrow, 1080)).toBe(true)
  })

  it('returns true when window is too short', () => {
    // With 3 existing → 4 panes → 2x2 grid → 2 rows
    // Window height too small for 2 rows of MIN_PIXEL_HEIGHT each
    const tooShort = MIN_PIXEL_HEIGHT * 2 - 2
    expect(wouldExceedMinPaneSize(3, 1920, tooShort)).toBe(true)
  })

  it('returns false at exact edge of minimum size', () => {
    // 1 existing → 2 panes → 2x1 grid → cols=2, rows=1
    const exactWidth = MIN_PIXEL_WIDTH * 2
    const exactHeight = MIN_PIXEL_HEIGHT
    expect(wouldExceedMinPaneSize(1, exactWidth, exactHeight)).toBe(false)
  })

  it('returns true just below minimum size', () => {
    // Same as above but 1px too narrow
    const exactWidth = MIN_PIXEL_WIDTH * 2
    const exactHeight = MIN_PIXEL_HEIGHT
    expect(wouldExceedMinPaneSize(1, exactWidth - 1, exactHeight)).toBe(true)
  })

  it('handles many panes in a large window', () => {
    // 8 existing → 9 panes → 3x3 grid → each pane 640x360
    expect(wouldExceedMinPaneSize(8, 1920, 1080)).toBe(false)
  })
})

describe('validateSpawnPayload', () => {
  describe('new-worktree mode', () => {
    it('returns error when repoPath is empty', () => {
      expect(validateSpawnPayload('new-worktree', '', '', null)).toBe('Repository path is required.')
    })

    it('returns error when repoPath is whitespace', () => {
      expect(validateSpawnPayload('new-worktree', '   ', '', null)).toBe('Repository path is required.')
    })

    it('returns null for valid input', () => {
      expect(validateSpawnPayload('new-worktree', '/Users/test/repo', '', null)).toBeNull()
    })
  })

  describe('existing-worktree mode', () => {
    it('returns error when repoPath is empty', () => {
      expect(validateSpawnPayload('existing-worktree', '', '', null)).toBe('Repository path is required.')
    })

    it('returns error when selectedWorktree is null', () => {
      expect(validateSpawnPayload('existing-worktree', '/repo', '', null)).toBe('Select a worktree.')
    })

    it('returns error when selectedWorktree is empty string', () => {
      expect(validateSpawnPayload('existing-worktree', '/repo', '', '')).toBe('Select a worktree.')
    })

    it('returns null for valid input', () => {
      expect(validateSpawnPayload('existing-worktree', '/repo', '', '/repo/wt-1')).toBeNull()
    })
  })

  describe('manual-path mode', () => {
    it('returns error when manualPath is empty', () => {
      expect(validateSpawnPayload('manual-path', '', '', null)).toBe('Directory path is required.')
    })

    it('returns error when manualPath is whitespace', () => {
      expect(validateSpawnPayload('manual-path', '', '   ', null)).toBe('Directory path is required.')
    })

    it('returns null for valid input', () => {
      expect(validateSpawnPayload('manual-path', '', '/some/dir', null)).toBeNull()
    })
  })

  describe('unknown mode', () => {
    it('returns null (no validation rules)', () => {
      expect(validateSpawnPayload('resume-session', '', '', null)).toBeNull()
    })
  })
})

describe('stripWorktreesSuffix', () => {
  it('strips a trailing .worktrees segment on posix paths', () => {
    expect(stripWorktreesSuffix('/Users/me/Documents/game-studio-research/.worktrees')).toBe(
      '/Users/me/Documents/game-studio-research'
    )
  })

  it('strips a trailing .worktrees segment with a trailing slash', () => {
    expect(stripWorktreesSuffix('/repo/.worktrees/')).toBe('/repo')
  })

  it('strips a trailing .worktrees segment on windows-style paths', () => {
    expect(stripWorktreesSuffix('C:\\Users\\me\\repo\\.worktrees')).toBe('C:\\Users\\me\\repo')
  })

  it('leaves paths that only contain .worktrees as an inner segment alone', () => {
    expect(stripWorktreesSuffix('/repo/.worktrees/wt-1234')).toBe('/repo/.worktrees/wt-1234')
  })

  it('leaves unrelated paths unchanged', () => {
    expect(stripWorktreesSuffix('/Users/me/Documents/repo')).toBe('/Users/me/Documents/repo')
  })

  it('leaves an empty string alone', () => {
    expect(stripWorktreesSuffix('')).toBe('')
  })

  it('does not strip a path whose final segment merely ends in ".worktrees" text', () => {
    expect(stripWorktreesSuffix('/repo/my.worktrees')).toBe('/repo/my.worktrees')
  })
})
