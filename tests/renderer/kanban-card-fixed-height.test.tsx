// @vitest-environment jsdom
//
// KanbanCard renders at a fixed 34px height across statuses so the in-flight
// overlay never shrinks or grows mid-move (the source column's two-line
// content rarely matches the destination's one-line content, and an unfixed
// shell would visibly resize). jsdom doesn't run real layout, so we assert
// on the element's inline `height` style rather than the rendered rect.

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/renderer/hooks/usePaneState', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/renderer/hooks/usePaneState')>()
  return {
    ...orig,
    usePaneState: () => ({
      panes: [],
      focusedPaneId: null,
      globalEffort: 'high',
      setFocusedPane: () => {},
      setEffort: () => {},
      setGlobalEffort: () => {},
      setModel: () => {},
      setUserName: () => {},
      globalCompletionPolicy: { action: 'ask', mergeStrategy: 'rebase-ff', pruneOnMerge: false },
      workspaceCompletionPolicy: null,
      effectiveCompletionPolicy: { action: 'ask', mergeStrategy: 'rebase-ff', pruneOnMerge: false },
      windowHiveId: null
    })
  }
})

import { render } from '@testing-library/react'
import { KanbanCard } from '../../src/renderer/components/KanbanCard'
import type { RendererPane } from '../../src/renderer/hooks/usePaneState'

function makePane(overrides: Partial<RendererPane> = {}): RendererPane {
  return {
    id: 'pane-1',
    repoName: 'demo',
    worktreeName: 'feature-x',
    worktreePath: '/tmp/demo/feature-x',
    isApiBilling: false,
    effort: 'high',
    model: 'opus',
    status: 'awaiting-prompt',
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
      sessionTitle: null,
      agentName: null,
      initialPrompt: null
    },
    terminated: false,
    hasUnseenStatusChange: false,
    initialBuffer: null,
    gitStatus: null,
    isWorktree: true,
    completionStatus: null,
    isResolvingConflict: false,
    userName: null,
    permissionMode: 'normal',
    ...overrides
  }
}

describe('KanbanCard — fixed height', () => {
  function rootHeightOf(pane: RendererPane): string {
    const { container } = render(
      <KanbanCard pane={pane} statusColor="#fff" isActive={false} onClick={() => {}} />
    )
    const root = container.firstElementChild as HTMLElement | null
    expect(root).toBeTruthy()
    return root!.style.height
  }

  it('one-line tile (awaiting-prompt) has 34px height', () => {
    expect(rootHeightOf(makePane({ status: 'awaiting-prompt' }))).toBe('34px')
  })

  it('two-line tile (working with active tool) has 34px height', () => {
    expect(
      rootHeightOf(
        makePane({
          status: 'working',
          activeToolName: 'Edit'
        })
      )
    ).toBe('34px')
  })

  it('two-line tile (changes-ready with uncommitted changes) has 34px height', () => {
    expect(
      rootHeightOf(
        makePane({
          status: 'changes-ready',
          metrics: {
            totalTokens: null,
            contextPercent: null,
            toolsUsed: null,
            totalCostUsd: null,
            durationMs: null,
            modelDisplayName: null,
            linesAdded: 12,
            linesRemoved: 3,
            sessionTitle: null,
            agentName: null,
            initialPrompt: null
          },
          gitStatus: {
            hasUncommittedChanges: true,
            changedFileCount: 2,
            changedFiles: ['a.ts', 'b.ts'],
            commitsAhead: 0,
            baseBranchAheadOfRemote: null,
            branchName: 'feature-x'
          }
        })
      )
    ).toBe('34px')
  })
})
