// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { installMockApi, uninstallMockApi } from './helpers/mock-api'
import { AddTerminalsForm } from '../../src/renderer/components/AddTerminalsForm'
import { IPC } from '../../src/shared/ipc-channels'

// useAppConfig reads from window.api → shim it so the form can mount in jsdom.
vi.mock('../../src/renderer/hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    config: { language: 'en', defaultModel: undefined, kanban: { heightPx: 220 } },
    setConfig: vi.fn(),
    loaded: true
  })
}))

// jsdom does not implement HTMLDialogElement showModal/close.
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

// ---------------------------------------------------------------------------
// Standard repo / general workspace form
// ---------------------------------------------------------------------------

describe('AddTerminalsForm — repo / general workspaces', () => {
  it('seeds the repo field from lastSpawnedRepoPath', () => {
    installMockApi()
    const { container } = render(
      <AddTerminalsForm
        workspaceId="ws-1"
        lastSpawnedRepoPath="/Users/me/myrepo"
        onSubmitted={vi.fn()}
      />
    )
    const repoInput = container.querySelector('input') as HTMLInputElement
    expect(repoInput).toBeTruthy()
    expect(repoInput.value).toBe('/Users/me/myrepo')
  })

  it('strips a trailing .worktrees segment from the seeded path', () => {
    installMockApi()
    const { container } = render(
      <AddTerminalsForm
        workspaceId="ws-1"
        lastSpawnedRepoPath="/Users/me/myrepo/.worktrees"
        onSubmitted={vi.fn()}
      />
    )
    const repoInput = container.querySelector('input') as HTMLInputElement
    expect(repoInput.value).toBe('/Users/me/myrepo')
  })

  it('leaves the repo field blank when no lastSpawnedRepoPath is supplied', () => {
    installMockApi()
    const { container } = render(
      <AddTerminalsForm workspaceId="ws-1" onSubmitted={vi.fn()} />
    )
    const repoInput = container.querySelector('input') as HTMLInputElement
    expect(repoInput.value).toBe('')
  })

  it('renders the terminal-location toggle and the count stepper', () => {
    installMockApi()
    const { getByText, container } = render(
      <AddTerminalsForm workspaceId="ws-1" onSubmitted={vi.fn()} />
    )
    expect(getByText('Terminal location')).toBeTruthy()
    expect(getByText('All Terminals in Same Repo')).toBeTruthy()
    expect(getByText('Choose Repo per Terminal')).toBeTruthy()
    expect(getByText('Terminals to spawn')).toBeTruthy()
    // Default count 4
    const stepperValue = container.querySelector('span.tabular-nums')
    expect(stepperValue?.textContent).toBe('4')
  })

  it('does not render the workspace name field or view-mode toggle', () => {
    installMockApi()
    const { queryByText } = render(
      <AddTerminalsForm workspaceId="ws-1" onSubmitted={vi.fn()} />
    )
    // LaunchForm's workspace name + view mode labels — must NOT appear.
    expect(queryByText('Workspace name')).toBeNull()
    expect(queryByText('View mode')).toBeNull()
  })

  it('does not render an advanced-setup toggle (every field is visible)', () => {
    installMockApi()
    const { queryByText } = render(
      <AddTerminalsForm workspaceId="ws-1" onSubmitted={vi.fn()} />
    )
    expect(queryByText('Advanced Setup')).toBeNull()
    // Branch layout / branch naming — fields gated by Advanced in LaunchForm —
    // must be visible in AddTerminalsForm.
    expect(queryByText('Branch layout')).toBeTruthy()
    expect(queryByText('Branch naming')).toBeTruthy()
    expect(queryByText('Model')).toBeTruthy()
    expect(queryByText('Effort')).toBeTruthy()
  })

  it('submits a WORKSPACE_ADD_TERMINALS payload with the workspaceId set', async () => {
    const api = installMockApi()
    // PATH_VALIDATE → valid git, WORKSPACE_ADD_TERMINALS → success
    api.invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC.PATH_VALIDATE) return { valid: true, isGitRepo: true }
      if (channel === IPC.WORKSPACE_ADD_TERMINALS) return { error: null }
      return null
    })

    const onSubmitted = vi.fn()
    const { container } = render(
      <AddTerminalsForm
        workspaceId="ws-42"
        lastSpawnedRepoPath="/Users/me/myrepo"
        onSubmitted={onSubmitted}
      />
    )

    // Wait for debounced PATH_VALIDATE to resolve so canSubmit flips to true.
    await waitFor(
      () => {
        expect(api.invoke).toHaveBeenCalledWith(IPC.PATH_VALIDATE, { path: '/Users/me/myrepo' })
      },
      { timeout: 1000 }
    )

    // Submit. The button's disabled flag flips after the validation result lands.
    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitButton).toBeTruthy()
    await waitFor(() => expect(submitButton.disabled).toBe(false), { timeout: 1000 })

    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled(), { timeout: 1000 })

    const addCall = api.invoke.mock.calls.find((c: unknown[]) => c[0] === IPC.WORKSPACE_ADD_TERMINALS)
    expect(addCall).toBeTruthy()
    const payload = addCall![1] as Record<string, unknown>
    expect(payload.workspaceId).toBe('ws-42')
    expect(payload.repoPath).toBe('/Users/me/myrepo')
    expect(payload.terminalCount).toBe(4)
    expect(payload.worktreeMode).toBe('each-own')
    expect(payload.namingMode).toBe('auto')
  })
})

// ---------------------------------------------------------------------------
// Worktree-branch workspace simplified variant
// ---------------------------------------------------------------------------

describe('AddTerminalsForm — worktree-branch workspaces', () => {
  it('renders the simplified layout with the locked-worktree banner', () => {
    installMockApi()
    const { getByText, queryByText } = render(
      <AddTerminalsForm
        workspaceId="ws-wt"
        workspaceType="worktree-branch"
        workspaceConstraint={{
          repoPath: '/Users/me/myrepo',
          branchName: 'feature/x',
          worktreePath: '/Users/me/myrepo/.worktrees/feature-x'
        }}
        onSubmitted={vi.fn()}
      />
    )
    // Banner copy mentions the branch and worktree path.
    expect(getByText(/feature\/x/)).toBeTruthy()
    expect(getByText(/feature-x/)).toBeTruthy()
    // No location/branch fields — those would let the user override the
    // workspace's pinned worktree, which is forbidden.
    expect(queryByText('Terminal location')).toBeNull()
    expect(queryByText('Branch layout')).toBeNull()
    expect(queryByText('Branch naming')).toBeNull()
    // Count + Model + Effort still appear.
    expect(getByText('Terminals to spawn')).toBeTruthy()
    expect(getByText('Model')).toBeTruthy()
    expect(getByText('Effort')).toBeTruthy()
  })

  it('submits PANE_SPAWN N times with manual-path mode + the workspace worktreePath', async () => {
    const api = installMockApi()
    api.invoke.mockResolvedValue({ error: null })
    const onSubmitted = vi.fn()
    const { container } = render(
      <AddTerminalsForm
        workspaceId="ws-wt"
        workspaceType="worktree-branch"
        workspaceConstraint={{
          repoPath: '/Users/me/myrepo',
          branchName: 'feature/x',
          worktreePath: '/Users/me/myrepo/.worktrees/feature-x'
        }}
        onSubmitted={onSubmitted}
      />
    )
    // Default count is 4. Bump down to 2 so the test is fast.
    const stepperButtons = container.querySelectorAll('button[type="button"]')
    // Find the "−" button — its text content is "−".
    const minusButton = Array.from(stepperButtons).find((b) => b.textContent === '−') as HTMLButtonElement
    expect(minusButton).toBeTruthy()
    await act(async () => {
      fireEvent.click(minusButton) // 4 → 3
      fireEvent.click(minusButton) // 3 → 2
    })

    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitButton.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled(), { timeout: 1000 })

    const spawnCalls = api.invoke.mock.calls.filter((c: unknown[]) => c[0] === IPC.PANE_SPAWN)
    expect(spawnCalls.length).toBe(2)
    for (const call of spawnCalls) {
      const payload = call[1] as Record<string, unknown>
      expect(payload.mode).toBe('manual-path')
      expect(payload.worktreePath).toBe('/Users/me/myrepo/.worktrees/feature-x')
      expect(payload.workspaceId).toBe('ws-wt')
    }
  })
})
