// @vitest-environment jsdom
//
// KanbanRepoCard — header, claude.md pencil affordance, and per-repo
// collapsible session list (default expanded). Bulk-action buttons and
// the rollup row were removed; the new completion-actions design will
// rebuild that surface from scratch.

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
    isAwaitingPlanApproval: false,
    lastActivityAt: Date.now(),
    ...overrides
  }
}

describe('KanbanRepoCard', () => {
  it('renders the repo label', () => {
    const { getByText } = render(
      <KanbanRepoCard
        rollup={makeRollup({ repoLabel: 'claudinha' })}
        panes={[makePane({ paneId: 'p1' }), makePane({ paneId: 'p2' })]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    expect(getByText('claudinha')).toBeTruthy()
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

  it('chevron toggles the session list visibility', () => {
    const { getByLabelText, queryByText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[makePane({ paneId: 'a', paneName: 'agent-A', branchName: 'wt-A' })]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    expect(queryByText('agent-A')).not.toBeNull()

    fireEvent.click(getByLabelText('Collapse session list'))
    expect(queryByText('agent-A')).toBeNull()

    fireEvent.click(getByLabelText('Expand session list'))
    expect(queryByText('agent-A')).not.toBeNull()
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

  it('shows diff counts on session rows when the pane has changes vs base', () => {
    const { container } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[
          makePane({ paneId: 'a', paneName: 'agent-A', linesAdded: 12, linesRemoved: 3 })
        ]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    // Diff wins over the age fallback on the right slot.
    expect(within(container).getByText('+12')).toBeTruthy()
    expect(within(container).getByText('−3')).toBeTruthy()
  })

  it('renders a "changes" affordance for opening the repo-level RepoChangesModal', () => {
    const { getByLabelText } = render(
      <KanbanRepoCard
        rollup={makeRollup({ repoLabel: 'demo' })}
        panes={[]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    // The button is keyed off the repo label. M5 surfaces it next to the
    // claude.md pencil; click opens the per-repo modal (we only assert
    // that the affordance exists here — modal IPC mocking lives in its
    // own test file).
    expect(getByLabelText('Review changes for demo')).toBeTruthy()
  })

  it('falls back to a last-activity age on session rows with no diff', () => {
    const fiveMinAgo = Date.now() - 5 * 60_000
    const { getByText, queryByText } = render(
      <KanbanRepoCard
        rollup={makeRollup()}
        panes={[
          makePane({
            paneId: 'a',
            paneName: 'agent-A',
            linesAdded: 0,
            linesRemoved: 0,
            lastActivityAt: fiveMinAgo
          })
        ]}
        activePaneId={null}
        onSelectSession={() => {}}
      />
    )
    expect(getByText('5m')).toBeTruthy()
    expect(queryByText('+0')).toBeNull()
  })
})
