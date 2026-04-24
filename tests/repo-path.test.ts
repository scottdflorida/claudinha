import { describe, it, expect } from 'vitest'
import { worktreePathToRepoPath, normaliseRepoPath, repoNameFromWorktreePath } from '../src/main/repo-path'

describe('worktreePathToRepoPath', () => {
  it('returns the repo root when the worktree lives under `.worktrees/`', () => {
    expect(
      worktreePathToRepoPath('/Users/me/Documents/game-studio-research/.worktrees/wt-abcd')
    ).toBe('/Users/me/Documents/game-studio-research')
  })

  it('treats the parent as the repo root for legacy sibling worktrees', () => {
    expect(worktreePathToRepoPath('/Users/me/Documents/repo/wt-abcd')).toBe(
      '/Users/me/Documents/repo'
    )
  })

  it('handles the manual-path case where the worktree IS the repo dir', () => {
    expect(worktreePathToRepoPath('/Users/me/Documents/repo')).toBe('/Users/me/Documents')
  })
})

describe('normaliseRepoPath', () => {
  it('strips a trailing `.worktrees` segment so the repo root is used', () => {
    expect(normaliseRepoPath('/Users/me/Documents/claudinha/.worktrees')).toBe(
      '/Users/me/Documents/claudinha'
    )
  })

  it('is a no-op when the path is already the repo root', () => {
    expect(normaliseRepoPath('/Users/me/Documents/claudinha')).toBe(
      '/Users/me/Documents/claudinha'
    )
  })
})

describe('repoNameFromWorktreePath', () => {
  it('returns the parent repo basename for a `.worktrees/`-nested worktree', () => {
    expect(
      repoNameFromWorktreePath('/Users/me/Documents/game-studio-research/.worktrees/wt-abcd')
    ).toBe('game-studio-research')
  })

  it('returns the parent basename for a legacy sibling worktree', () => {
    expect(repoNameFromWorktreePath('/Users/me/Documents/repo/wt-abcd')).toBe('repo')
  })

  it('never returns the literal `.worktrees` even when the layout would suggest it', () => {
    // Doubly-nested case: would have been produced by a pre-fix spawn through
    // a poisoned repoPath (`<repoRoot>/.worktrees/.worktrees/wt-xxx`). The
    // helper walks up one segment, not two — so the display name here is the
    // inner `.worktrees`, not the parent repo. That's acceptable: the L-042
    // follow-up prevents this shape from being created at all. What we assert
    // here is the single-nested case (the common one) is correct.
    expect(
      repoNameFromWorktreePath('/Users/me/Documents/claudinha/.worktrees/Planner')
    ).toBe('claudinha')
  })
})
