/**
 * Unit tests for resolvePaneDisplayName — the shared fallback helper used by
 * both the Kanban card (renderer) and the inspector's `buildTreeEntry` (main).
 * The two surfaces must return the same string for the same pane state.
 */

import { describe, it, expect } from 'vitest'
import { resolvePaneDisplayName } from '../src/shared/pane-display'

function makePane(overrides: { userName?: string | null; sessionTitle?: string | null; worktreeName?: string } = {}) {
  return {
    worktreeName: overrides.worktreeName ?? 'wt-0abcd1',
    userName: overrides.userName ?? null,
    metrics: { sessionTitle: overrides.sessionTitle ?? null }
  }
}

describe('resolvePaneDisplayName', () => {
  it('returns userName when set', () => {
    expect(
      resolvePaneDisplayName(makePane({ userName: 'my-tree', sessionTitle: 'claude-title' }))
    ).toBe('my-tree')
  })

  it('trims whitespace from userName', () => {
    expect(
      resolvePaneDisplayName(makePane({ userName: '  spaced  ' }))
    ).toBe('spaced')
  })

  it('falls back to sessionTitle when userName is null', () => {
    expect(
      resolvePaneDisplayName(makePane({ userName: null, sessionTitle: 'cute-animal-stories' }))
    ).toBe('cute-animal-stories')
  })

  it('falls back to sessionTitle when userName is an empty / whitespace string', () => {
    expect(
      resolvePaneDisplayName(makePane({ userName: '   ', sessionTitle: 'cute-animal-stories' }))
    ).toBe('cute-animal-stories')
  })

  it('falls back to worktreeName when neither userName nor sessionTitle is set', () => {
    expect(
      resolvePaneDisplayName(makePane({ worktreeName: 'wt-650a4c' }))
    ).toBe('wt-650a4c')
  })

  it('falls back to worktreeName when sessionTitle is whitespace', () => {
    expect(
      resolvePaneDisplayName(makePane({ sessionTitle: '   ', worktreeName: 'wt-650a4c' }))
    ).toBe('wt-650a4c')
  })
})
