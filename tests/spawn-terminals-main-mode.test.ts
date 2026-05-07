/**
 * Tests for the per-repo "main mode" inheritance helper used by both
 * spawnTerminalsIntoWorkspace (batch add) and PANE_SPAWN (single add).
 *
 * "Main mode" means a workspace is running terminals directly inside a repo
 * root rather than under `<repo>/.worktrees/...`. When a later pane is added
 * to the same (workspace, repo) pair, it must inherit that mode — even if
 * the user picked "each-own" or "shared" in the form.
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import { isMainModeForRepoInWorkspace } from '../src/main/spawn-terminals-helper'
import type { PaneState, Workspace, TerminalSnapshot } from '../src/shared/types'

// ---------------------------------------------------------------------------
// Tiny in-memory stand-ins for SessionRegistry + WorkspaceManager. We only
// need the two methods the helper actually calls.
// ---------------------------------------------------------------------------

function makePaneState(overrides: Partial<PaneState> & { id: string; workspaceId: string; worktreePath: string }): PaneState {
  return {
    id: overrides.id,
    windowId: 'w1',
    workspaceId: overrides.workspaceId,
    ptyId: 'pty-1',
    sessionId: null,
    transcriptPath: null,
    contextWindowSize: null,
    repoName: 'repo',
    worktreeName: 'wt',
    worktreePath: overrides.worktreePath,
    status: 'awaiting-prompt',
    activeToolName: null,
    statusChangedAt: 0,
    statusSource: 'pty-fallback',
    isFocused: false,
    hasUnseenStatusChange: false,
    isApiBilling: false,
    effort: 'high',
    model: 'opus',
    metrics: {
      totalTokens: null, contextPercent: null, toolsUsed: null,
      totalCostUsd: null, durationMs: null, modelDisplayName: null,
      linesAdded: null, linesRemoved: null, sessionTitle: null,
      agentName: null, initialPrompt: null
    },
    createdAt: 0,
    gitStatus: null,
    isWorktree: false,
    completionActionStatus: null,
    ...overrides
  }
}

function makeWorkspace(id: string, paused: TerminalSnapshot[] = []): Workspace {
  return {
    id,
    name: 'ws',
    workspaceNumber: 1,
    type: 'general',
    constraint: {},
    status: 'active',
    windowId: null,
    activePaneIds: [],
    pausedTerminals: paused,
    createdAt: 0,
    lastActiveAt: 0,
    completionPolicy: null,
    viewMode: 'kanban',
    activePaneId: null
  }
}

function makeFakeRegistry(panes: PaneState[]): { getPanesForWorkspace: (id: string) => PaneState[] } {
  return {
    getPanesForWorkspace: (id: string): PaneState[] => panes.filter((p) => p.workspaceId === id)
  }
}

function makeFakeWorkspaceManager(workspaces: Workspace[]): { getWorkspace: (id: string) => Workspace | undefined } {
  return {
    getWorkspace: (id: string): Workspace | undefined => workspaces.find((w) => w.id === id)
  }
}

// ---------------------------------------------------------------------------

describe('isMainModeForRepoInWorkspace', () => {
  const repoA = '/Users/dev/projects/alpha'
  const repoB = '/Users/dev/projects/beta'
  const wtUnderA = path.join(repoA, '.worktrees', 'wt-abc')

  it('returns true when an active pane lives directly in the repo root', () => {
    const reg = makeFakeRegistry([
      makePaneState({ id: 'p1', workspaceId: 'ws-1', worktreePath: repoA })
    ])
    const wm = makeFakeWorkspaceManager([makeWorkspace('ws-1')])
    expect(isMainModeForRepoInWorkspace('ws-1', repoA, reg as any, wm as any)).toBe(true)
  })

  it('returns false when the only active pane lives in a worktree subdir', () => {
    const reg = makeFakeRegistry([
      makePaneState({ id: 'p1', workspaceId: 'ws-1', worktreePath: wtUnderA })
    ])
    const wm = makeFakeWorkspaceManager([makeWorkspace('ws-1')])
    expect(isMainModeForRepoInWorkspace('ws-1', repoA, reg as any, wm as any)).toBe(false)
  })

  it('does not leak inheritance across different repos in the same workspace', () => {
    const reg = makeFakeRegistry([
      makePaneState({ id: 'p1', workspaceId: 'ws-1', worktreePath: repoA })
    ])
    const wm = makeFakeWorkspaceManager([makeWorkspace('ws-1')])
    // repoA is in main mode but we're asking about repoB — must say no.
    expect(isMainModeForRepoInWorkspace('ws-1', repoB, reg as any, wm as any)).toBe(false)
  })

  it('does not leak inheritance across workspaces', () => {
    const reg = makeFakeRegistry([
      makePaneState({ id: 'p1', workspaceId: 'ws-other', worktreePath: repoA })
    ])
    const wm = makeFakeWorkspaceManager([
      makeWorkspace('ws-other'),
      makeWorkspace('ws-target')
    ])
    expect(isMainModeForRepoInWorkspace('ws-target', repoA, reg as any, wm as any)).toBe(false)
  })

  it('returns true when only a paused (dormant) terminal snapshot matches the repo root', () => {
    const reg = makeFakeRegistry([])
    const snapshot: TerminalSnapshot = {
      paneId: 'p-paused',
      sessionId: null,
      worktreePath: repoA,
      repoName: 'alpha',
      worktreeName: 'alpha',
      sessionTitle: null,
      wasActiveAtClose: false,
      snapshotAt: 0
    }
    const wm = makeFakeWorkspaceManager([makeWorkspace('ws-1', [snapshot])])
    expect(isMainModeForRepoInWorkspace('ws-1', repoA, reg as any, wm as any)).toBe(true)
  })

  it('handles trailing slashes and unnormalized paths', () => {
    const reg = makeFakeRegistry([
      makePaneState({ id: 'p1', workspaceId: 'ws-1', worktreePath: repoA + '/' })
    ])
    const wm = makeFakeWorkspaceManager([makeWorkspace('ws-1')])
    expect(isMainModeForRepoInWorkspace('ws-1', repoA, reg as any, wm as any)).toBe(true)
  })

  it('returns false for an unknown workspace', () => {
    const reg = makeFakeRegistry([])
    const wm = makeFakeWorkspaceManager([])
    expect(isMainModeForRepoInWorkspace('ws-missing', repoA, reg as any, wm as any)).toBe(false)
  })
})
