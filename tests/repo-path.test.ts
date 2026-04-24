import { describe, it, expect } from 'vitest'
import { worktreePathToRepoPath } from '../src/main/repo-path'

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
