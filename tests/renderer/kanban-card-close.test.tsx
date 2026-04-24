// @vitest-environment jsdom
//
// KanbanCard — close (X) button: verifies the card-level X fires the
// supplied onClose prop, stops event propagation so the card's select-on-click
// does NOT also fire, and is omitted when no onClose is provided.

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

import { render, fireEvent } from '@testing-library/react'
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
    status: 'working',
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
    permissionMode: 'normal',
    ...overrides
  }
}

describe('KanbanCard — close (X) button', () => {
  it('fires onClose when the X is clicked', () => {
    const onClose = vi.fn()
    const onClick = vi.fn()
    const { getByLabelText } = render(
      <KanbanCard
        pane={makePane()}
        statusColor="#888"
        isActive={false}
        onClick={onClick}
        onClose={onClose}
      />
    )
    fireEvent.click(getByLabelText('Close terminal'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops propagation so the card onClick (select) does not also fire', () => {
    const onClose = vi.fn()
    const onClick = vi.fn()
    const { getByLabelText } = render(
      <KanbanCard
        pane={makePane()}
        statusColor="#888"
        isActive={false}
        onClick={onClick}
        onClose={onClose}
      />
    )
    fireEvent.click(getByLabelText('Close terminal'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('omits the X when onClose is not provided', () => {
    const { queryByLabelText } = render(
      <KanbanCard
        pane={makePane()}
        statusColor="#888"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(queryByLabelText('Close terminal')).toBeNull()
  })
})
