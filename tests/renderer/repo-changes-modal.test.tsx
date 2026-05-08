// @vitest-environment jsdom
//
// RepoChangesModal — repo-level rollup of pending turns. Asserts:
//   - Header shows the resolved repo label and pane count.
//   - Sections render one per pane with their turn lines.
//   - Bulk action buttons enable when at least one pane is selected
//     and the current publish path lights them up.
//   - "select all" + "clear" wire the selection set correctly.
//   - Filter chips collapse the visible pane list.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { installMockApi, uninstallMockApi, createMockApi } from './helpers/mock-api'
import { RepoChangesModal } from '../../src/renderer/components/RepoChangesModal'
import { IPC } from '../../src/shared/ipc-channels'
import type { RepoTurnsGetResult } from '../../src/shared/ipc-channels'

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    ;(HTMLDialogElement.prototype as any).showModal = function () { this.open = true }
    ;(HTMLDialogElement.prototype as any).close = function () { this.open = false }
  }
})

afterEach(() => {
  cleanup()
  uninstallMockApi()
  vi.clearAllMocks()
})

function aggregate(): RepoTurnsGetResult {
  return {
    error: null,
    repoLabel: 'demo',
    publishPath: 'both',
    panes: [
      {
        paneId: 'pane-A',
        paneName: 'agent-A',
        worktreeName: 'wt-A',
        currentBranch: 'wt-A',
        baseBranch: 'main',
        isWorktree: true,
        autoCommitEnabled: true,
        pendingAction: null,
        turns: [
          {
            id: 'a-1', index: 1, summary: 'Add a.txt', state: 'open',
            commitSha: 'sha-a-1', parentCommitSha: 'sha-base',
            additions: 5, deletions: 0, filesChanged: 1,
            authoredAt: Date.now(), authorEmail: 't@t.com'
          }
        ]
      },
      {
        paneId: 'pane-B',
        paneName: 'agent-B',
        worktreeName: 'wt-B',
        currentBranch: 'wt-B',
        baseBranch: 'main',
        isWorktree: true,
        autoCommitEnabled: true,
        pendingAction: null,
        turns: []
      }
    ]
  }
}

describe('RepoChangesModal', () => {
  it('renders the repo label, pane sections, and disabled bulk bar by default', async () => {
    const api = installMockApi()
    api.invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC.REPO_TURNS_GET) return aggregate()
      return null
    })

    const { getByText, getByTitle } = render(
      <RepoChangesModal workspaceId="ws-1" repoPath="/repos/demo" onClose={() => {}} />
    )

    await waitFor(() => expect(getByText(/Changes in Repo: demo/)).toBeTruthy())
    expect(getByText('agent-A')).toBeTruthy()
    expect(getByText('agent-B')).toBeTruthy()
    expect(getByText('Add a.txt')).toBeTruthy()

    // Merge button is rendered (publishPath = 'both') but disabled
    // before any pane is selected.
    const mergeButton = getByText('Merge to origin/main').closest('button') as HTMLButtonElement
    expect(mergeButton.disabled).toBe(true)
  })

  it('selecting a pane enables the bulk Merge button and select-all picks only actionable panes', async () => {
    const api = installMockApi()
    api.invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC.REPO_TURNS_GET) return aggregate()
      return null
    })

    const { getByText, getByLabelText } = render(
      <RepoChangesModal workspaceId="ws-1" repoPath="/repos/demo" onClose={() => {}} />
    )
    await waitFor(() => expect(getByText('agent-A')).toBeTruthy())

    // Click pane A's checkbox.
    fireEvent.click(getByLabelText('Select agent-A'))
    expect(getByText('1 selected')).toBeTruthy()

    const mergeButton = getByText('Merge to origin/main').closest('button') as HTMLButtonElement
    expect(mergeButton.disabled).toBe(false)

    // "select all" should add only agent-A — agent-B has no turns so its
    // checkbox is disabled.
    fireEvent.click(getByText('select all'))
    // Still 1 selected because B has no actionable turns.
    expect(getByText('1 selected')).toBeTruthy()

    // Clear resets.
    fireEvent.click(getByText('clear'))
    expect(mergeButton.disabled).toBe(true)
  })

  it('clicking Merge invokes BULK_RUN with the right payload', async () => {
    const api = installMockApi()
    api.invoke.mockImplementation(async (channel: string, payload: unknown) => {
      if (channel === IPC.REPO_TURNS_GET) return aggregate()
      if (channel === IPC.BULK_RUN) {
        // Capture-and-return so the assertion below can read the spy call.
        return { error: null, runId: 'run-uuid-1' }
      }
      return null
    })

    const { getByText, getByLabelText } = render(
      <RepoChangesModal workspaceId="ws-1" repoPath="/repos/demo" onClose={() => {}} />
    )
    await waitFor(() => expect(getByText('agent-A')).toBeTruthy())
    fireEvent.click(getByLabelText('Select agent-A'))

    fireEvent.click(getByText('Merge to origin/main'))

    await waitFor(() => {
      const calls = api.invoke.mock.calls.filter((c: unknown[]) => c[0] === IPC.BULK_RUN)
      expect(calls.length).toBe(1)
      const payload = calls[0]![1] as { paneIds: string[]; action: string; repoPath: string }
      expect(payload.paneIds).toEqual(['pane-A'])
      expect(payload.action).toBe('merge')
      expect(payload.repoPath).toBe('/repos/demo')
    })
  })

  it('Has-changes filter hides panes with no publishable turns', async () => {
    const api = installMockApi()
    api.invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC.REPO_TURNS_GET) return aggregate()
      return null
    })

    const { getByText, queryByText } = render(
      <RepoChangesModal workspaceId="ws-1" repoPath="/repos/demo" onClose={() => {}} />
    )
    await waitFor(() => expect(getByText('agent-A')).toBeTruthy())
    expect(queryByText('agent-B')).not.toBeNull()

    fireEvent.click(getByText('Has changes'))
    expect(queryByText('agent-A')).not.toBeNull()
    // agent-B has no turns → hidden.
    expect(queryByText('agent-B')).toBeNull()
  })
})
