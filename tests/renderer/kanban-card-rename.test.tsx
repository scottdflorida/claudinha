// @vitest-environment jsdom
//
// Phase 8 — KanbanCard inline rename: verifies the agent-name fallback chain
// (userName → sessionTitle → worktreeName), pencil click + double-click open
// the input, Enter / blur commits, Escape cancels, and setUserName receives
// the trimmed value (or null when emptied).

import { describe, it, expect, vi } from 'vitest'

const { setUserNameMock } = vi.hoisted(() => ({ setUserNameMock: vi.fn() }))

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
      setUserName: setUserNameMock,
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

describe('KanbanCard — agent-name fallback chain', () => {
  it('renders userName when present (highest precedence)', () => {
    const { getByText, queryByText } = render(
      <KanbanCard
        pane={makePane({
          userName: 'My Refactor',
          metrics: { ...makePane().metrics, sessionTitle: 'Auto Title' }
        })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(getByText('My Refactor')).toBeTruthy()
    expect(queryByText('Auto Title')).toBeNull()
    expect(queryByText('feature-x')).toBeNull()
  })

  it('falls back to sessionTitle when userName is null', () => {
    const { getByText, queryByText } = render(
      <KanbanCard
        pane={makePane({
          userName: null,
          metrics: { ...makePane().metrics, sessionTitle: 'Auto Title' }
        })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(getByText('Auto Title')).toBeTruthy()
    expect(queryByText('feature-x')).toBeNull()
  })

  it('falls back to worktreeName when both userName and sessionTitle are absent', () => {
    const { getByText } = render(
      <KanbanCard
        pane={makePane({ userName: null })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(getByText('feature-x')).toBeTruthy()
  })
})

describe('KanbanCard — inline rename', () => {
  beforeEach(() => {
    setUserNameMock.mockClear()
  })

  it('clicking the pencil reveals an input pre-filled with the current name', () => {
    const { getByLabelText } = render(
      <KanbanCard
        pane={makePane({ userName: 'old name' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    const pencil = getByLabelText('Rename agent') as HTMLButtonElement
    fireEvent.click(pencil)
    const input = getByLabelText('Agent name') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.value).toBe('old name')
  })

  it('Enter commits the trimmed name to setUserName', () => {
    const { getByLabelText } = render(
      <KanbanCard
        pane={makePane({ userName: null })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    fireEvent.click(getByLabelText('Rename agent'))
    const input = getByLabelText('Agent name') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  Refactor X  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setUserNameMock).toHaveBeenCalledWith('pane-1', 'Refactor X')
  })

  it('blur commits the name', () => {
    const { getByLabelText } = render(
      <KanbanCard
        pane={makePane({ userName: null })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    fireEvent.click(getByLabelText('Rename agent'))
    const input = getByLabelText('Agent name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Inline name' } })
    fireEvent.blur(input)
    expect(setUserNameMock).toHaveBeenCalledWith('pane-1', 'Inline name')
  })

  it('Escape cancels without invoking setUserName', () => {
    const { getByLabelText } = render(
      <KanbanCard
        pane={makePane({ userName: 'unchanged' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    fireEvent.click(getByLabelText('Rename agent'))
    const input = getByLabelText('Agent name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'never saved' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(setUserNameMock).not.toHaveBeenCalled()
  })

  it('committing an empty/blank name clears the override (sends null)', () => {
    const { getByLabelText } = render(
      <KanbanCard
        pane={makePane({ userName: 'old' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    fireEvent.click(getByLabelText('Rename agent'))
    const input = getByLabelText('Agent name') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setUserNameMock).toHaveBeenCalledWith('pane-1', null)
  })

  it('committing the same name does not call setUserName (no-op edit)', () => {
    const { getByLabelText } = render(
      <KanbanCard
        pane={makePane({ userName: 'same' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    fireEvent.click(getByLabelText('Rename agent'))
    const input = getByLabelText('Agent name') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setUserNameMock).not.toHaveBeenCalled()
  })
})

describe('KanbanCard — activity row (only when working)', () => {
  it('renders the present-continuous tool activity when status=working and activeToolName is set', () => {
    const { getByText } = render(
      <KanbanCard
        pane={makePane({ status: 'working', activeToolName: 'Read' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(getByText('Reading')).toBeTruthy()
  })

  it('falls back to "Using <Tool>" for unknown tool names', () => {
    const { getByText } = render(
      <KanbanCard
        pane={makePane({ status: 'working', activeToolName: 'CustomTool' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(getByText('Using CustomTool')).toBeTruthy()
  })

  it('renders "Working…" when status=working and no active tool', () => {
    const { getByText } = render(
      <KanbanCard
        pane={makePane({ status: 'working', activeToolName: null })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(getByText(/Working/)).toBeTruthy()
  })

  it('does NOT render an activity row for changes-ready / needs-input / awaiting-prompt', () => {
    for (const status of ['changes-ready', 'needs-input', 'awaiting-prompt'] as const) {
      const { queryByText, unmount } = render(
        <KanbanCard
          pane={makePane({ status })}
          statusColor="#fff"
          isActive={false}
          onClick={() => {}}
        />
      )
      expect(queryByText('Done')).toBeNull()
      expect(queryByText('Awaiting prompt')).toBeNull()
      expect(queryByText('Awaiting your input')).toBeNull()
      unmount()
    }
  })
})

// Plan mode badges were removed in the kanban redesign — column placement
// (Planning / Plan ready) carries the signal now.
describe.skip('KanbanCard — plan mode badge', () => {
  it('renders a PLANNING badge when permissionMode is "plan" and the agent is still drafting', () => {
    const { getByText, queryByText } = render(
      <KanbanCard
        pane={makePane({ permissionMode: 'plan', activeToolName: null })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(getByText('PLANNING')).toBeTruthy()
    expect(queryByText('PLAN READY')).toBeNull()
  })

  it('flips to PLAN READY when the agent is parked on ExitPlanMode', () => {
    const { getByText, queryByText } = render(
      <KanbanCard
        pane={makePane({ permissionMode: 'plan', activeToolName: 'ExitPlanMode' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(getByText('PLAN READY')).toBeTruthy()
    expect(queryByText('PLANNING')).toBeNull()
  })

  it('omits the badge when permissionMode is "normal"', () => {
    const { queryByText } = render(
      <KanbanCard
        pane={makePane({ permissionMode: 'normal' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(queryByText('PLANNING')).toBeNull()
    expect(queryByText('PLAN READY')).toBeNull()
  })

  it('omits the badge when permissionMode is "normal" even if activeToolName is ExitPlanMode', () => {
    const { queryByText } = render(
      <KanbanCard
        pane={makePane({ permissionMode: 'normal', activeToolName: 'ExitPlanMode' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    expect(queryByText('PLANNING')).toBeNull()
    expect(queryByText('PLAN READY')).toBeNull()
  })
})

describe('KanbanCard — focus indicator (feedback item 11)', () => {
  it('uses an outline outside the box (not ring) when active, preserves left bar', () => {
    const { container, rerender } = render(
      <KanbanCard
        pane={makePane()}
        statusColor="#abc123"
        isActive={true}
        onClick={() => {}}
      />
    )
    const card = container.querySelector('[role="button"]') as HTMLElement
    // Outline (outside the box), not ring (inside).
    expect(card.style.outline).toMatch(/var\(--color-fg-muted\)/)
    expect(card.style.outlineOffset).toBe('2px')
    // Left status color bar still present (jsdom normalizes hex → rgb).
    expect(card.style.borderLeft).toMatch(/rgb\(171, 193, 35\)|#abc123/)
    // No Tailwind ring class on the active card.
    expect(card.className).not.toMatch(/\bring-1\b/)

    rerender(
      <KanbanCard
        pane={makePane()}
        statusColor="#abc123"
        isActive={false}
        onClick={() => {}}
      />
    )
    const unfocusedCard = container.querySelector('[role="button"]') as HTMLElement
    expect(unfocusedCard.style.outline).toBe('none')
  })
})

// Uncommitted indicator was rolled into the next-step pill on the
// changes-ready tile — see ChangesReadyModal for the new contract.
describe.skip('KanbanCard — uncommitted indicator placement', () => {
  it('renders "Uncommitted" adjacent to the diff chip (left side of footer)', () => {
    const { getByLabelText, getByText } = render(
      <KanbanCard
        pane={makePane({
          gitStatus: {
            hasUncommittedChanges: true,
            changedFileCount: 1,
            commitsAhead: 0,
            branchName: 'feature'
          },
          metrics: {
            ...makePane().metrics,
            linesAdded: 5,
            linesRemoved: 2
          }
        })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
        onDiffClick={() => {}}
      />
    )
    const diffChip = getByLabelText('View diff') as HTMLElement
    const uncommitted = getByText('Uncommitted') as HTMLElement
    // Both live in the same footer row container.
    expect(diffChip.parentElement).toBe(uncommitted.parentElement)
  })

  it('uncommitted tooltip explains the auto-commit behavior', () => {
    const { getByText } = render(
      <KanbanCard
        pane={makePane({
          gitStatus: {
            hasUncommittedChanges: true,
            changedFileCount: 1,
            commitsAhead: 0,
            branchName: 'feature'
          }
        })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    const pill = getByText('Uncommitted')
    expect(pill.getAttribute('title')).toMatch(/auto-commit/i)
  })
})

describe('KanbanCard — no effort indicator (feedback item 9)', () => {
  it('does not render the old effort icon glyph', () => {
    const { container } = render(
      <KanbanCard
        pane={makePane({ effort: 'max' })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    // The old EFFORT_ICONS rendered '⬤' for 'max'; the current card
    // must not have any element with aria-label starting with "Effort ".
    const effortElement = container.querySelector('[aria-label^="Effort "]')
    expect(effortElement).toBeNull()
  })
})

// Standalone diff chip was replaced by the next-step pill — opens the
// ChangesReadyModal which embeds the diff viewer as a sub-modal.
describe.skip('KanbanCard — diff chip', () => {
  it('clicking the diff chip invokes onDiffClick (not the card click)', () => {
    const onClick = vi.fn()
    const onDiffClick = vi.fn()
    const { getByLabelText } = render(
      <KanbanCard
        pane={makePane({
          metrics: {
            ...makePane().metrics,
            linesAdded: 12,
            linesRemoved: 3
          }
        })}
        statusColor="#fff"
        isActive={false}
        onClick={onClick}
        onDiffClick={onDiffClick}
      />
    )
    fireEvent.click(getByLabelText('View diff'))
    expect(onDiffClick).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('diff chip is hidden when there are no line changes', () => {
    const { queryByLabelText } = render(
      <KanbanCard
        pane={makePane({
          metrics: {
            ...makePane().metrics,
            linesAdded: 0,
            linesRemoved: 0
          }
        })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
        onDiffClick={() => {}}
      />
    )
    expect(queryByLabelText('View diff')).toBeNull()
  })
})

// Sync indicator slot was removed — the next-step pill collapses sync state
// into the same slot for changes-ready tiles, and other columns show no sync.
describe.skip('KanbanCard — sync indicator placement', () => {
  // Regression: Done/merged cards used to render a near-empty footer row
  // just to hold the right-aligned "Merged" badge, which doubled the card
  // height. The badge must live in the title row so cards without diff or
  // uncommitted content stay a single row tall (per kanban/concept.md:64,
  // "One row per card").
  it('places the sync badge in the title row, not a separate footer row, when there is no diff or uncommitted', () => {
    const { getByText, queryByLabelText, queryByText } = render(
      <KanbanCard
        pane={makePane({
          status: 'done',
          completionStatus: { state: 'merged' }
        })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
      />
    )
    const merged = getByText('Merged')
    const agentName = getByText('feature-x')
    // Same parent div ⇒ sync badge sits in the title row.
    expect(merged.parentElement).toBe(agentName.parentElement)
    // No diff chip and no Uncommitted ⇒ footer row should not render at all.
    expect(queryByLabelText('View diff')).toBeNull()
    expect(queryByText('Uncommitted')).toBeNull()
  })

  it('still places the sync badge in the title row when a diff chip is also present', () => {
    const { getByText, getByLabelText } = render(
      <KanbanCard
        pane={makePane({
          status: 'done',
          completionStatus: { state: 'error', errorMessage: 'merge conflict' },
          gitStatus: {
            hasUncommittedChanges: true,
            changedFileCount: 1,
            commitsAhead: 0,
            branchName: 'feature-x'
          },
          metrics: {
            ...makePane().metrics,
            linesAdded: 4,
            linesRemoved: 1
          }
        })}
        statusColor="#fff"
        isActive={false}
        onClick={() => {}}
        onDiffClick={() => {}}
      />
    )
    const actionFailed = getByText('Action failed')
    const agentName = getByText('feature-x')
    // Sync badge sits with the title, not down in the footer with the diff.
    expect(actionFailed.parentElement).toBe(agentName.parentElement)
    // Diff chip and Uncommitted still render in the (now diff-only) footer.
    expect(getByLabelText('View diff')).toBeTruthy()
    expect(getByText('Uncommitted')).toBeTruthy()
  })
})
