// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// KanbanCard reads from usePaneState() to support inline rename. The tests
// here only care about layout/projection — provide a no-op stub so the cards
// can render outside a real PaneStateProvider.
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

// DiffViewerModal triggers IPC calls. The board never opens it in these
// tests, but stub it to a no-op render to avoid touching `useIpc`.
vi.mock('../../src/renderer/components/DiffViewerModal', () => ({
  DiffViewerModal: () => null
}))

// jsdom is missing showModal/close on HTMLDialogElement. KanbanBoard now
// auto-opens the CompletionErrorModal when a pane is in error state, so even
// column-placement tests that include an errored pane mount the dialog.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    ;(HTMLDialogElement.prototype as any).showModal = function () {
      this.open = true
    }
    ;(HTMLDialogElement.prototype as any).close = function () {
      this.open = false
    }
  }
})

import { render, fireEvent, within } from '@testing-library/react'
import { KanbanBoard } from '../../src/renderer/components/KanbanBoard'
import type { RendererPane } from '../../src/renderer/hooks/usePaneState'
import type { PaneStatus } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePane(overrides: Partial<RendererPane> = {}): RendererPane {
  return {
    id: 'pane-x',
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
    ...overrides
  }
}

/** Get the column section (including header + body) for a given title. */
function columnFor(container: HTMLElement, title: string): HTMLElement {
  const sections = Array.from(container.querySelectorAll('section'))
  const match = sections.find((s) => s.getAttribute('aria-label')?.startsWith(`${title} (`))
  if (!match) throw new Error(`Column section not found for "${title}"`)
  return match as HTMLElement
}

/** Count how many cards (elements with aria-pressed) live in a column. */
function cardCount(column: HTMLElement): number {
  return column.querySelectorAll('[aria-pressed]').length
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KanbanBoard', () => {
  it('renders the five status columns in fixed order', () => {
    const { container } = render(
      <KanbanBoard panes={[]} activePaneId={null} onCardClick={() => {}} />
    )
    const headers = Array.from(container.querySelectorAll('section header span')).map((el) =>
      el.textContent?.trim()
    )
    // First text node in each header is the column title (count is the second).
    const titles = headers.filter((t) => t && !/^\d+$/.test(t!))
    expect(titles).toEqual([
      'Awaiting orders',
      'Planning',
      'Plan ready',
      'Needs input',
      'Working',
      'Changes ready'
    ])
  })

  it('groups panes into columns by status', () => {
    const panes: RendererPane[] = [
      makePane({ id: 'p1', status: 'needs-input' }),
      makePane({ id: 'p2', status: 'working' }),
      makePane({ id: 'p3', status: 'working' }),
      makePane({ id: 'p4', status: 'changes-ready' }),
      makePane({ id: 'p5', status: 'awaiting-prompt' }),
      makePane({ id: 'p6', status: 'planning' }),
      makePane({ id: 'p7', status: 'plan-ready' })
    ]
    const { container } = render(
      <KanbanBoard panes={panes} activePaneId={null} onCardClick={() => {}} />
    )
    expect(cardCount(columnFor(container, 'Needs input'))).toBe(1)
    expect(cardCount(columnFor(container, 'Working'))).toBe(2)
    expect(cardCount(columnFor(container, 'Changes ready'))).toBe(1)
    expect(cardCount(columnFor(container, 'Awaiting orders'))).toBe(1)
    expect(cardCount(columnFor(container, 'Planning'))).toBe(1)
    expect(cardCount(columnFor(container, 'Plan ready'))).toBe(1)
  })

  it('buckets a working pane in plan mode into Planning, not Working', () => {
    // The renderer-side bucketing covers the case where Claude is composing a
    // plan (calling Read/Grep/Bash) — those tool cycles produce
    // status='working', but the user expects to see them in Planning. The
    // hook-listener can't help here because there's no Stop event during
    // active tool work. Mirrors useKanbanCardMoves.bucketFor — they MUST
    // agree or the card-move animation aims at a different column than the
    // card lands in.
    const panes: RendererPane[] = [
      makePane({ id: 'planner', status: 'working', permissionMode: 'plan' }),
      makePane({ id: 'coder', status: 'working', permissionMode: 'normal' })
    ]
    const { container } = render(
      <KanbanBoard panes={panes} activePaneId={null} onCardClick={() => {}} />
    )
    expect(cardCount(columnFor(container, 'Planning'))).toBe(1)
    expect(cardCount(columnFor(container, 'Working'))).toBe(1)
  })

  it('keeps terminated panes in their status column with a red border', () => {
    // Errors are no longer their own column — `terminated` drives the red
    // PaneBorder highlight while the pane stays where its status puts it.
    const panes: RendererPane[] = [
      makePane({ id: 'crashed', status: 'working', terminated: true })
    ]
    const { container } = render(
      <KanbanBoard panes={panes} activePaneId={null} onCardClick={() => {}} />
    )
    expect(cardCount(columnFor(container, 'Working'))).toBe(1)
  })

  it('keeps a changes-ready pane in Changes ready when only the post-stop automation errored', () => {
    // A pane with PaneStatus === 'changes-ready' but
    // completionStatus.state === 'error' belongs in Changes ready with the
    // tile's action-warn glyph, not in a separate Error column.
    const panes: RendererPane[] = [
      makePane({
        id: 'merge-failed',
        status: 'changes-ready',
        terminated: false,
        completionStatus: { state: 'error', errorMessage: 'merge conflict' }
      })
    ]
    const { container } = render(
      <KanbanBoard panes={panes} activePaneId={null} onCardClick={() => {}} />
    )
    expect(cardCount(columnFor(container, 'Changes ready'))).toBe(1)
  })

  it('renders a placeholder dash in empty columns (L-024 — fixtures stay visible)', () => {
    const { container } = render(
      <KanbanBoard
        panes={[makePane({ id: 'p1', status: 'working' })]}
        activePaneId={null}
        onCardClick={() => {}}
      />
    )
    for (const title of ['Needs input', 'Awaiting orders', 'Changes ready', 'Planning', 'Plan ready']) {
      const col = columnFor(container, title)
      const placeholder = within(col).queryByText('—')
      expect(placeholder).not.toBeNull()
    }
  })

  it('clicking a card invokes onCardClick with the pane id', () => {
    const onCardClick = vi.fn()
    const panes: RendererPane[] = [
      makePane({ id: 'pane-A', status: 'working', worktreeName: 'feature-A' })
    ]
    const { getByLabelText } = render(
      <KanbanBoard panes={panes} activePaneId={null} onCardClick={onCardClick} />
    )
    fireEvent.click(getByLabelText('Select feature-A'))
    expect(onCardClick).toHaveBeenCalledWith('pane-A')
  })

  it('marks the active card with aria-pressed=true', () => {
    const panes: RendererPane[] = [
      makePane({ id: 'p1', status: 'working', worktreeName: 'one' }),
      makePane({ id: 'p2', status: 'working', worktreeName: 'two' })
    ]
    const { getByLabelText } = render(
      <KanbanBoard panes={panes} activePaneId="p2" onCardClick={() => {}} />
    )
    expect(getByLabelText('Select one').getAttribute('aria-pressed')).toBe('false')
    expect(getByLabelText('Select two').getAttribute('aria-pressed')).toBe('true')
  })

  it('agent name fallback: sessionTitle wins over worktreeName when present', () => {
    const panes: RendererPane[] = [
      makePane({
        id: 'p1',
        status: 'working',
        worktreeName: 'feature-X',
        metrics: {
          totalTokens: null,
          contextPercent: null,
          toolsUsed: null,
          totalCostUsd: null,
          durationMs: null,
          modelDisplayName: null,
          linesAdded: null,
          linesRemoved: null,
          sessionTitle: 'Refactor auth middleware'
        }
      })
    ]
    const { queryByLabelText } = render(
      <KanbanBoard panes={panes} activePaneId={null} onCardClick={() => {}} />
    )
    expect(queryByLabelText('Select Refactor auth middleware')).not.toBeNull()
    expect(queryByLabelText('Select feature-X')).toBeNull()
  })
})

describe('KanbanBoard — status colors match Wall', () => {
  it('column header text routes through the theme-aware --color-status-* CSS vars', () => {
    // Header text picks up the per-status CSS custom property from globals.css
    // so light mode renders Working as dark warm charcoal (visible) instead of
    // the dark-mode-tuned near-white. The 'error' column maps to --color-status-lost
    // (the existing semantic name in globals.css).
    const expectedVarByStatus: Partial<Record<PaneStatus, string>> = {
      'awaiting-prompt': 'var(--color-status-awaiting)',
      'planning':        'var(--color-status-working)',
      'plan-ready':      'var(--color-status-plan)',
      'working':         'var(--color-status-working)',
      'needs-input':     'var(--color-status-needs-input)',
      'changes-ready':   'var(--color-status-done)'
    }
    const titlesByStatus: Partial<Record<PaneStatus, string>> = {
      'awaiting-prompt': 'Awaiting orders',
      'planning': 'Planning',
      'plan-ready': 'Plan ready',
      'working': 'Working',
      'needs-input': 'Needs input',
      'changes-ready': 'Changes ready'
    }
    const { container } = render(
      <KanbanBoard panes={[]} activePaneId={null} onCardClick={() => {}} />
    )
    for (const [status, title] of Object.entries(titlesByStatus)) {
      const section = columnFor(container, title!)
      // The first <span> inside <header> is the colored title.
      const header = section.querySelector('header span') as HTMLElement | null
      expect(header).not.toBeNull()
      expect(header!.style.color).toBe(expectedVarByStatus[status as PaneStatus])
    }
  })
})

