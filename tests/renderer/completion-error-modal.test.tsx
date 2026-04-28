// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { installMockApi, uninstallMockApi } from './helpers/mock-api'
import { CompletionErrorModal } from '../../src/renderer/components/CompletionErrorModal'
import { KanbanBoard } from '../../src/renderer/components/KanbanBoard'
import { IPC } from '../../src/shared/ipc-channels'
import type { RendererPane } from '../../src/renderer/hooks/usePaneState'
import type { CompletionActionStatus } from '../../src/shared/types'

// usePaneState is read by KanbanCard for inline rename. The board tests don't
// touch rename, so a no-op stub is enough.
let mockPanes: RendererPane[] = []

vi.mock('../../src/renderer/hooks/usePaneState', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/renderer/hooks/usePaneState')>()
  return {
    ...orig,
    usePaneState: () => ({
      panes: mockPanes,
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

// DiffViewerModal triggers IPC. Stub to avoid unrelated traffic.
vi.mock('../../src/renderer/components/DiffViewerModal', () => ({
  DiffViewerModal: () => null
}))

// jsdom is missing showModal/close on HTMLDialogElement; polyfill so <Dialog> mounts.
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

function makePane(overrides: Partial<RendererPane> = {}): RendererPane {
  return {
    id: 'pane-a',
    repoName: 'demo',
    worktreeName: 'feature-a',
    worktreePath: '/repo/.worktrees/feature-a',
    isApiBilling: false,
    effort: 'high',
    model: 'opus',
    status: 'done',
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

function errorStatus(message = 'Rebase failed: refusing to merge unrelated histories'): CompletionActionStatus {
  return { state: 'error', errorMessage: message }
}

// ---------------------------------------------------------------------------
// CompletionErrorModal — rendered in isolation
// ---------------------------------------------------------------------------

describe('CompletionErrorModal', () => {
  beforeEach(() => {
    const api = installMockApi()
    api.invoke.mockImplementation(() => Promise.resolve({}))
  })
  afterEach(() => {
    cleanup()
    uninstallMockApi()
    vi.clearAllMocks()
  })

  it('renders the error message verbatim', () => {
    const { getByText } = render(
      <CompletionErrorModal
        message="Rebase failed: refusing to merge unrelated histories"
        onRetry={() => {}}
        onClose={() => {}}
      />
    )
    expect(getByText('Rebase failed: refusing to merge unrelated histories')).toBeTruthy()
  })

  it('renders only Close + Retry when onClearState is omitted (Wall mode shape)', () => {
    const { queryByText } = render(
      <CompletionErrorModal message="boom" onRetry={() => {}} onClose={() => {}} />
    )
    expect(queryByText('Close')).toBeTruthy()
    expect(queryByText('Retry')).toBeTruthy()
    expect(queryByText('Mark resolved')).toBeNull()
  })

  it('renders the Mark resolved button when onClearState is supplied (Kanban mode shape)', () => {
    const { queryByText } = render(
      <CompletionErrorModal
        message="boom"
        onRetry={() => {}}
        onClose={() => {}}
        onClearState={() => {}}
      />
    )
    expect(queryByText('Mark resolved')).toBeTruthy()
  })

  it('Mark resolved → calls onClearState then onClose', () => {
    const onClearState = vi.fn()
    const onClose = vi.fn()
    const { getByText } = render(
      <CompletionErrorModal
        message="boom"
        onRetry={() => {}}
        onClose={onClose}
        onClearState={onClearState}
      />
    )
    fireEvent.click(getByText('Mark resolved'))
    expect(onClearState).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Retry → calls onRetry then onClose', () => {
    const onRetry = vi.fn()
    const onClose = vi.fn()
    const { getByText } = render(
      <CompletionErrorModal message="boom" onRetry={onRetry} onClose={onClose} />
    )
    fireEvent.click(getByText('Retry'))
    expect(onRetry).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// KanbanBoard — auto-open + chip click + retry/clear-state IPC wiring
// ---------------------------------------------------------------------------

describe('KanbanBoard error integration', () => {
  beforeEach(() => {
    const api = installMockApi()
    api.invoke.mockImplementation(() => Promise.resolve({}))
    mockPanes = []
  })
  afterEach(() => {
    cleanup()
    uninstallMockApi()
    vi.clearAllMocks()
  })

  it('renders the "Action failed" chip as a button when state is error (per-card recovery affordance)', () => {
    const pane = makePane({ status: 'done', completionStatus: errorStatus() })
    mockPanes = [pane]
    const { container } = render(
      <KanbanBoard panes={[pane]} activePaneId={null} onCardClick={() => {}} />
    )
    // Auto-open will fire on first render — close it first to inspect the card.
    fireEvent.click(container.querySelector('dialog button[aria-label="Close dialog"]') ?? document.createElement('button'))
    const chip = container.querySelector('button[title="Action failed — click to see why"]')
    expect(chip).toBeTruthy()
  })

  it('auto-opens the CompletionErrorModal when a pane transitions into error', () => {
    const pane = makePane({ completionStatus: null })
    mockPanes = [pane]
    const { rerender, queryByText } = render(
      <KanbanBoard panes={[pane]} activePaneId={null} onCardClick={() => {}} />
    )
    expect(queryByText('Merge or PR failed')).toBeNull()

    const errored = { ...pane, completionStatus: errorStatus('boom') }
    mockPanes = [errored]
    rerender(<KanbanBoard panes={[errored]} activePaneId={null} onCardClick={() => {}} />)
    expect(queryByText('Merge or PR failed')).toBeTruthy()
    expect(queryByText('boom')).toBeTruthy()
  })

  it('opens the modal when the "Action failed" chip is clicked after dismissal', () => {
    const pane = makePane({ status: 'done', completionStatus: errorStatus() })
    mockPanes = [pane]
    const { getAllByText, queryByText, container } = render(
      <KanbanBoard panes={[pane]} activePaneId={null} onCardClick={() => {}} />
    )
    // Auto-open fires; close it via the modal's footer Close button.
    const closeButtons = getAllByText('Close')
    fireEvent.click(closeButtons[0])
    expect(queryByText('Merge or PR failed')).toBeNull()

    const chip = container.querySelector('button[title="Action failed — click to see why"]')
    expect(chip).toBeTruthy()
    fireEvent.click(chip as HTMLElement)
    expect(queryByText('Merge or PR failed')).toBeTruthy()
  })

  it('Retry button → invokes COMPLETION_MERGE with paneId and rebase-ff strategy', () => {
    const pane = makePane({ id: 'pane-z', status: 'done', completionStatus: errorStatus() })
    mockPanes = [pane]
    const invokeMock = (window as any).api.invoke as ReturnType<typeof vi.fn>
    const { getByText } = render(
      <KanbanBoard panes={[pane]} activePaneId={null} onCardClick={() => {}} />
    )
    // Auto-open already fired.
    fireEvent.click(getByText('Retry'))
    const mergeCalls = invokeMock.mock.calls.filter((c) => c[0] === IPC.COMPLETION_MERGE)
    expect(mergeCalls).toHaveLength(1)
    expect(mergeCalls[0][1]).toMatchObject({ paneId: 'pane-z', strategy: 'rebase-ff' })
  })

  it('Mark resolved button → sends COMPLETION_CLEAR_STATE for the pane', () => {
    const pane = makePane({ id: 'pane-z', status: 'done', completionStatus: errorStatus() })
    mockPanes = [pane]
    const sendMock = (window as any).api.send as ReturnType<typeof vi.fn>
    const { getByText } = render(
      <KanbanBoard panes={[pane]} activePaneId={null} onCardClick={() => {}} />
    )
    // Auto-open already fired.
    fireEvent.click(getByText('Mark resolved'))
    const clearCalls = sendMock.mock.calls.filter((c) => c[0] === IPC.COMPLETION_CLEAR_STATE)
    expect(clearCalls).toHaveLength(1)
    expect(clearCalls[0][1]).toMatchObject({ paneId: 'pane-z' })
  })

  it('does not auto-reopen the same pane after dismissal until it leaves and re-enters error', () => {
    const pane = makePane({ id: 'pane-q', status: 'done', completionStatus: errorStatus() })
    mockPanes = [pane]
    const { rerender, queryByText, getAllByText } = render(
      <KanbanBoard panes={[pane]} activePaneId={null} onCardClick={() => {}} />
    )
    // Auto-opened on mount — close it.
    fireEvent.click(getAllByText('Close')[0])
    expect(queryByText('Merge or PR failed')).toBeNull()

    // Re-render with the same error state. Should NOT auto-reopen.
    rerender(<KanbanBoard panes={[pane]} activePaneId={null} onCardClick={() => {}} />)
    expect(queryByText('Merge or PR failed')).toBeNull()
  })
})
