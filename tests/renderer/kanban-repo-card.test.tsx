// @vitest-environment jsdom
//
// KanbanRepoCard — Phase 5: rollups display, status-dot breakdown,
// per-repo collapsible session list (default expanded), and that the
// bulk-action buttons are present-but-disabled until Phase 6.

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import { KanbanRepoCard } from '../../src/renderer/components/KanbanRepoCard'
import type { ReadyPaneEntry, RepoRollup } from '../../src/shared/types'

function makeRollup(overrides: Partial<RepoRollup> = {}): RepoRollup {
  return {
    repoPath: '/repos/demo',
    repoLabel: 'demo',
    paneCount: 2,
    totalFilesTouched: 5,
    totalLinesAdded: 42,
    totalLinesRemoved: 7,
    readyCount: 1,
    ...overrides
  }
}

function makePane(overrides: Partial<ReadyPaneEntry> = {}): ReadyPaneEntry {
  return {
    paneId: 'p-1',
    paneName: 'agent-name',
    repoPath: '/repos/demo',
    repoName: 'demo',
    branchName: 'feat-branch',
    filesTouched: 3,
    linesAdded: 30,
    linesRemoved: 4,
    paneStatus: 'working',
    isReadyToMerge: false,
    completionState: null,
    ...overrides
  }
}

describe('KanbanRepoCard', () => {
  it('renders the repo label and rollup line counts', () => {
    const { getByText, container } = render(
      <KanbanRepoCard
        rollup={makeRollup({ repoLabel: 'claudinha', totalLinesAdded: 12, totalLinesRemoved: 3 })}
        panes={[makePane({ paneId: 'p1' }), makePane({ paneId: 'p2' })]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    expect(getByText('claudinha')).toBeTruthy()
    expect(within(container).getByText('+12')).toBeTruthy()
    expect(within(container).getByText('−3')).toBeTruthy()
  })

  it('defaults to expanded session list (concept doc decision 2)', () => {
    const { getByText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[
          makePane({ paneId: 'a', paneName: 'agent-A', branchName: 'wt-A' }),
          makePane({ paneId: 'b', paneName: 'agent-B', branchName: 'wt-B' })
        ]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    expect(getByText('agent-A')).toBeTruthy()
    expect(getByText('agent-B')).toBeTruthy()
  })

  it('chevron toggles the session list and the bulk-action buttons together', () => {
    const { getByLabelText, queryByText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[makePane({ paneId: 'a', paneName: 'agent-A', branchName: 'wt-A' })]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    // Expanded default: both the session row AND the bulk actions are visible.
    expect(queryByText('agent-A')).not.toBeNull()
    expect(queryByText('Merge')).not.toBeNull()
    expect(queryByText('Create PR')).not.toBeNull()

    // Collapse: both disappear.
    fireEvent.click(getByLabelText('Collapse session list'))
    expect(queryByText('agent-A')).toBeNull()
    expect(queryByText('Merge')).toBeNull()
    expect(queryByText('Create PR')).toBeNull()

    // Re-expand: both come back.
    fireEvent.click(getByLabelText('Expand session list'))
    expect(queryByText('agent-A')).not.toBeNull()
    expect(queryByText('Merge')).not.toBeNull()
    expect(queryByText('Create PR')).not.toBeNull()
  })

  it('clicking a session row invokes onSelectSession with that pane id', () => {
    const onSelect = vi.fn()
    const { getByText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[makePane({ paneId: 'pane-X', paneName: 'agent-X', branchName: 'wt-X' })]}
        activePaneId={null}
        onSelectSession={onSelect}
      />
    )
    fireEvent.click(getByText('agent-X'))
    expect(onSelect).toHaveBeenCalledWith('pane-X')
  })

  it('leaves Merge / Push / Merge + push / Create PR disabled when no handlers are provided', () => {
    const { getByText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[makePane()]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    for (const label of ['Merge', 'Push', 'Merge + push', 'Create PR']) {
      const btn = getByText(label)
      expect((btn as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('Create PR is enabled and fires onCreatePr when the handler is provided', () => {
    const onCreatePr = vi.fn()
    const { getByText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[makePane()]}
        activePaneId={null}
        onSelectSession={() => {}}
        onCreatePr={onCreatePr}
      />
    )
    const btn = getByText('Create PR') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(onCreatePr).toHaveBeenCalledTimes(1)
  })

  it('CLAUDE.md pencil is disabled when no onEditClaudeMd handler is provided', () => {
    const { getByLabelText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    const pencil = getByLabelText('Edit CLAUDE.md') as HTMLButtonElement
    expect(pencil.disabled).toBe(true)
  })

  it('CLAUDE.md pencil is enabled and fires onEditClaudeMd when provided', () => {
    const onEdit = vi.fn()
    const { getByLabelText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[]}
        activePaneId={null}
        onSelectSession={() => {}}
        onEditClaudeMd={onEdit}
      />
    )
    const pencil = getByLabelText('Edit CLAUDE.md') as HTMLButtonElement
    expect(pencil.disabled).toBe(false)
    fireEvent.click(pencil)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('marks the row matching activePaneId with aria-pressed=true', () => {
    const { getByText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[
          makePane({ paneId: 'a', paneName: 'one', branchName: 'wt-1' }),
          makePane({ paneId: 'b', paneName: 'two', branchName: 'wt-2' })
        ]}
        activePaneId="b"
        onSelectSession={() => {}}
      />
    )
    expect(getByText('one').closest('button')!.getAttribute('aria-pressed')).toBe('false')
    expect(getByText('two').closest('button')!.getAttribute('aria-pressed')).toBe('true')
  })
})
