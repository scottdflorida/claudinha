/**
 * Unit tests for resolvePaneDisplayName — the shared fallback helper used by
 * both the Kanban card (renderer) and the inspector's `buildTreeEntry` (main).
 * The two surfaces must return the same string for the same pane state.
 */

import { describe, it, expect } from 'vitest'
import { resolvePaneDisplayName } from '../src/shared/pane-display'

function makePane(overrides: { userName?: string | null; agentName?: string | null; sessionTitle?: string | null; worktreeName?: string } = {}) {
  return {
    worktreeName: overrides.worktreeName ?? 'wt-0abcd1',
    userName: overrides.userName ?? null,
    metrics: {
      sessionTitle: overrides.sessionTitle ?? null,
      agentName: overrides.agentName ?? null
    }
  }
}

describe('resolvePaneDisplayName', () => {
  it('returns userName when set (highest priority)', () => {
    expect(
      resolvePaneDisplayName(makePane({
        userName: 'my-tree',
        agentName: 'claude-agent-name',
        sessionTitle: 'Claude prose title'
      }))
    ).toBe('my-tree')
  })

  it('trims whitespace from userName', () => {
    expect(
      resolvePaneDisplayName(makePane({ userName: '  spaced  ' }))
    ).toBe('spaced')
  })

  it('falls back to agentName when userName is null', () => {
    expect(
      resolvePaneDisplayName(makePane({
        userName: null,
        agentName: 'add-people-stories-folder',
        sessionTitle: 'Add a story'
      }))
    ).toBe('add-people-stories-folder')
  })

  it('falls back to sessionTitle when userName and agentName are null', () => {
    expect(
      resolvePaneDisplayName(makePane({
        userName: null,
        agentName: null,
        sessionTitle: 'Add a story'
      }))
    ).toBe('Add a story')
  })

  it('falls back to sessionTitle when userName is whitespace and agentName is null', () => {
    expect(
      resolvePaneDisplayName(makePane({
        userName: '   ',
        agentName: null,
        sessionTitle: 'Add a story'
      }))
    ).toBe('Add a story')
  })

  it('skips agentName if it is whitespace', () => {
    expect(
      resolvePaneDisplayName(makePane({
        agentName: '   ',
        sessionTitle: 'Add a story'
      }))
    ).toBe('Add a story')
  })

  it('falls back to worktreeName when nothing else is set', () => {
    expect(
      resolvePaneDisplayName(makePane({ worktreeName: 'wt-650a4c' }))
    ).toBe('wt-650a4c')
  })

  it('falls back to worktreeName when sessionTitle is whitespace and agentName is null', () => {
    expect(
      resolvePaneDisplayName(makePane({ sessionTitle: '   ', worktreeName: 'wt-650a4c' }))
    ).toBe('wt-650a4c')
  })

  it('still works for callers that omit metrics.agentName entirely (optional field)', () => {
    // Existing callers (dormant TerminalSnapshot, SessionHistoryEntry) build
    // the metrics literal with only sessionTitle. The helper must still work.
    const noAgentField: { worktreeName: string; userName: null; metrics: { sessionTitle: string | null } } = {
      worktreeName: 'wt-650a4c',
      userName: null,
      metrics: { sessionTitle: 'Add a story' }
    }
    expect(resolvePaneDisplayName(noAgentField)).toBe('Add a story')
  })
})
