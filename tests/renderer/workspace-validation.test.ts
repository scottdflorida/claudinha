import { describe, it, expect } from 'vitest'
import { validateWorkspacePayload } from '../../src/renderer/lib/workspace-validation'

describe('validateWorkspacePayload', () => {
  describe('repo type', () => {
    it('returns error when repoPath is empty', () => {
      expect(validateWorkspacePayload('repo', '', null)).toBe('Repository path is required.')
    })

    it('returns error when repoPath is whitespace', () => {
      expect(validateWorkspacePayload('repo', '   ', null)).toBe('Repository path is required.')
    })

    it('returns null for valid repo workspace with path', () => {
      expect(validateWorkspacePayload('repo', '/Users/test/repo', null)).toBeNull()
    })
  })

  describe('worktree-branch type', () => {
    it('returns error when repoPath is empty', () => {
      expect(validateWorkspacePayload('worktree-branch', '', null)).toBe('Repository path is required.')
    })

    it('returns error when selectedWorktree is null', () => {
      expect(validateWorkspacePayload('worktree-branch', '/repo', null)).toBe('Select a worktree/branch.')
    })

    it('returns null for valid worktree-branch workspace', () => {
      expect(
        validateWorkspacePayload('worktree-branch', '/repo', { path: '/repo/wt-1', branch: 'feature-x' })
      ).toBeNull()
    })

    it('returns null for valid worktree-branch workspace without branch name', () => {
      expect(
        validateWorkspacePayload('worktree-branch', '/repo', { path: '/repo/wt-1' })
      ).toBeNull()
    })
  })

  describe('general type', () => {
    it('returns null with no fields (no requirements)', () => {
      expect(validateWorkspacePayload('general', '', null)).toBeNull()
    })

    it('returns null even when repoPath is provided', () => {
      expect(validateWorkspacePayload('general', '/some/path', null)).toBeNull()
    })
  })

  describe('unknown type', () => {
    it('returns null (falls through to no validation)', () => {
      expect(validateWorkspacePayload('unknown-type', '', null)).toBeNull()
    })
  })
})
