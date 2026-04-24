// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { installMockApi, uninstallMockApi } from './helpers/mock-api'
import { DirtyMainModal } from '../../src/renderer/components/DirtyMainModal'
import { KanbanBoard } from '../../src/renderer/components/KanbanBoard'
import { IPC } from '../../src/shared/ipc-channels'
import type { RendererPane } from '../../src/renderer/hooks/usePaneState'
import type { CompletionActionStatus } from '../../src/shared/types'

// The DirtyMainModal reads the pane list from usePaneState() to detect
// merge-busy siblings. For a single-pane test we can return just that pane.
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

// DiffViewerModal is loaded by KanbanBoard; stub to avoid unrelated IPC.
vi.mock('../../src/renderer/components/DiffViewerModal', () => ({
  DiffViewerModal: () => null
}))

// jsdom's HTMLDialogElement is missing showModal/close; polyfill in a
// minimal way so <Dialog> mounts without crashing.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    gitStatus: {
      hasUncommittedChanges: false,
      changedFileCount: 0,
      commitsAhead: 0,
      branchName: 'main'
    },
    isWorktree: true,
    completionStatus: null,
    isResolvingConflict: false,
    userName: null,
    permissionMode: 'normal',
    ...overrides
  }
}

function dirtyMainStatus(overrides: Partial<CompletionActionStatus> = {}): CompletionActionStatus {
  return {
    state: 'dirty-main',
    dirtyMain: {
      path: '/repo',
      files: ['README.md', 'src/app.ts'],
      totalCount: 2
    },
    ...overrides
  } as CompletionActionStatus
}

// ---------------------------------------------------------------------------
// DirtyMainModal — rendered in isolation
// ---------------------------------------------------------------------------

describe('DirtyMainModal', () => {
  beforeEach(() => {
    const api = installMockApi()
    // Default any unmocked invoke call to resolve with an empty object. The
    // useAppConfig hook fires APP_CONFIG_GET on mount; without a default this
    // returns undefined and the subsequent `.then` throws inside a React
    // effect, which fails the test even when our production logic is fine.
    api.invoke.mockImplementation(() => Promise.resolve({}))
    mockPanes = []
  })
  afterEach(() => {
    // React effects call window.api.off on unmount — run cleanup BEFORE
    // uninstalling the mock so the detach doesn't explode.
    cleanup()
    uninstallMockApi()
    vi.clearAllMocks()
  })

  it('lists the dirty files', () => {
    const pane = makePane({ completionStatus: dirtyMainStatus() })
    mockPanes = [pane]
    const { getByText } = render(<DirtyMainModal pane={pane} onClose={() => {}} />)
    expect(getByText('README.md')).toBeTruthy()
    expect(getByText('src/app.ts')).toBeTruthy()
  })

  it('renders the overflow label when totalCount exceeds the visible list', () => {
    const pane = makePane({
      completionStatus: dirtyMainStatus({
        dirtyMain: {
          path: '/repo',
          files: Array.from({ length: 10 }, (_, i) => `file-${i}.ts`),
          totalCount: 15
        }
      } as any)
    })
    mockPanes = [pane]
    const { getByText } = render(<DirtyMainModal pane={pane} onClose={() => {}} />)
    expect(getByText('…and 5 more')).toBeTruthy()
  })

  it('Commit all → expands the message input and dispatches GIT_COMMIT_DIRTY_MAIN on confirm', async () => {
    const pane = makePane({ completionStatus: dirtyMainStatus() })
    mockPanes = [pane]
    const invokeMock = (window as any).api.invoke as ReturnType<typeof vi.fn>
    invokeMock.mockResolvedValue({ error: null })
    const onClose = vi.fn()
    const { getByText } = render(<DirtyMainModal pane={pane} onClose={onClose} />)

    fireEvent.click(getByText('Commit all'))
    // The confirm button appears after expanding.
    await act(async () => {
      fireEvent.click(getByText('Commit'))
    })

    expect(invokeMock).toHaveBeenCalledWith(
      IPC.GIT_COMMIT_DIRTY_MAIN,
      expect.objectContaining({
        repoPath: '/repo',
        message: 'WIP before merge from Claudinha',
        files: ['README.md', 'src/app.ts']
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('Stash → dispatches GIT_STASH_DIRTY_MAIN with the default message', async () => {
    const pane = makePane({ completionStatus: dirtyMainStatus() })
    mockPanes = [pane]
    const invokeMock = (window as any).api.invoke as ReturnType<typeof vi.fn>
    invokeMock.mockResolvedValue({ error: null })
    const onClose = vi.fn()
    const { getByText } = render(<DirtyMainModal pane={pane} onClose={onClose} />)

    await act(async () => {
      fireEvent.click(getByText('Stash'))
    })

    expect(invokeMock).toHaveBeenCalledWith(
      IPC.GIT_STASH_DIRTY_MAIN,
      expect.objectContaining({
        repoPath: '/repo',
        files: ['README.md', 'src/app.ts']
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('Discard requires a second click before dispatching', async () => {
    const pane = makePane({ completionStatus: dirtyMainStatus() })
    mockPanes = [pane]
    const invokeMock = (window as any).api.invoke as ReturnType<typeof vi.fn>
    invokeMock.mockResolvedValue({ error: null })
    const onClose = vi.fn()
    const { getByText } = render(<DirtyMainModal pane={pane} onClose={onClose} />)

    // First click arms — the DISCARD channel must not have been invoked yet.
    // (Other channels like APP_CONFIG_GET may fire from mount effects; we
    // only care about the destructive call.)
    fireEvent.click(getByText('Discard'))
    const discardCalls = () => invokeMock.mock.calls.filter(
      (c) => c[0] === IPC.GIT_DISCARD_DIRTY_MAIN
    )
    expect(discardCalls()).toHaveLength(0)
    expect(getByText('Discard — are you sure?')).toBeTruthy()

    // Second click fires.
    await act(async () => {
      fireEvent.click(getByText('Discard — are you sure?'))
    })
    expect(discardCalls()).toHaveLength(1)
    expect(discardCalls()[0][1]).toMatchObject({
      repoPath: '/repo',
      files: ['README.md', 'src/app.ts']
    })
  })

  it('disables commit/stash/discard while a sibling pane in the same repo is merging', () => {
    const dirtyPane = makePane({
      id: 'pane-a',
      worktreePath: '/repo/.worktrees/feature-a',
      completionStatus: dirtyMainStatus()
    })
    const siblingMerging = makePane({
      id: 'pane-b',
      worktreePath: '/repo/.worktrees/feature-b',
      completionStatus: { state: 'merging' } as CompletionActionStatus
    })
    mockPanes = [dirtyPane, siblingMerging]

    const { getByText } = render(<DirtyMainModal pane={dirtyPane} onClose={() => {}} />)
    const commitBtn = getByText('Commit all') as HTMLButtonElement
    const stashBtn = getByText('Stash') as HTMLButtonElement
    const discardBtn = getByText('Discard') as HTMLButtonElement
    expect(commitBtn.disabled).toBe(true)
    expect(stashBtn.disabled).toBe(true)
    expect(discardBtn.disabled).toBe(true)
  })

  it('surfaces a main-process error and keeps the modal open', async () => {
    const pane = makePane({ completionStatus: dirtyMainStatus() })
    mockPanes = [pane]
    const invokeMock = (window as any).api.invoke as ReturnType<typeof vi.fn>
    invokeMock.mockResolvedValue({ error: 'boom' })
    const onClose = vi.fn()
    const { getByText } = render(<DirtyMainModal pane={pane} onClose={onClose} />)

    await act(async () => {
      fireEvent.click(getByText('Stash'))
    })

    expect(getByText(/boom/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// KanbanBoard — auto-open + chip click wiring
// ---------------------------------------------------------------------------

describe('KanbanBoard dirty-main integration', () => {
  beforeEach(() => {
    const api = installMockApi()
    // Default any unmocked invoke call to resolve with an empty object. The
    // useAppConfig hook fires APP_CONFIG_GET on mount; without a default this
    // returns undefined and the subsequent `.then` throws inside a React
    // effect, which fails the test even when our production logic is fine.
    api.invoke.mockImplementation(() => Promise.resolve({}))
    mockPanes = []
  })
  afterEach(() => {
    // React effects call window.api.off on unmount — run cleanup BEFORE
    // uninstalling the mock so the detach doesn't explode.
    cleanup()
    uninstallMockApi()
    vi.clearAllMocks()
  })

  it('auto-opens the DirtyMainModal when a pane transitions into dirty-main', () => {
    const pane = makePane({ completionStatus: null })
    mockPanes = [pane]
    const { rerender, queryByText } = render(
      <KanbanBoard panes={[pane]} activePaneId={null} onCardClick={() => {}} />
    )
    // No modal yet.
    expect(queryByText('Uncommitted changes on main')).toBeNull()

    const dirty = { ...pane, completionStatus: dirtyMainStatus() }
    mockPanes = [dirty]
    rerender(<KanbanBoard panes={[dirty]} activePaneId={null} onCardClick={() => {}} />)
    expect(queryByText('Uncommitted changes on main')).toBeTruthy()
  })

  it('opens the modal when the "Main dirty" chip is clicked', () => {
    const pane = makePane({ status: 'done', completionStatus: dirtyMainStatus() })
    mockPanes = [pane]
    // The auto-open effect will fire for this pane because it's dirty on the
    // first render. Dismiss the modal first, then click the chip.
    const { getByText, queryByText, container } = render(
      <KanbanBoard panes={[pane]} activePaneId={null} onCardClick={() => {}} />
    )
    // Close via the dialog's Close button.
    fireEvent.click(getByText('Close'))
    expect(queryByText('Uncommitted changes on main')).toBeNull()

    // Click the Main dirty chip on the card.
    const chip = container.querySelector('button[title="Main has uncommitted changes — click to resolve"]')
    expect(chip).toBeTruthy()
    fireEvent.click(chip as HTMLElement)
    expect(queryByText('Uncommitted changes on main')).toBeTruthy()
  })
})
