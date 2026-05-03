// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { installMockApi, uninstallMockApi } from './helpers/mock-api'
import { LaunchForm } from '../../src/renderer/components/LaunchForm'
import { IPC } from '../../src/shared/ipc-channels'

// useAppConfig reads from window.api → shim it so the form can mount in jsdom.
vi.mock('../../src/renderer/hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    config: { language: 'en', defaultModel: undefined, kanban: { heightPx: 220 } },
    setConfig: vi.fn(),
    loaded: true
  })
}))

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    ;(HTMLDialogElement.prototype as any).showModal = function () { this.open = true }
    ;(HTMLDialogElement.prototype as any).close = function () { this.open = false }
  }
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  uninstallMockApi()
  vi.clearAllMocks()
  localStorage.clear()
})

// Regression: after a successful workspace create, LaunchForm stays mounted
// (the workspace opens in its own Electron window — there is no remount on the
// manager side). The cleanup re-seeds the repo field from
// `claudinha:lastRepoPath` and resets repoValid/repoIsGit to null. Without
// re-running validation against the re-seeded path, the submit button stays
// stuck disabled even though the field looks correct, until the user touches
// the field. The fix triggers validation in the cleanup so the button tracks
// the re-seeded value.
describe('LaunchForm — post-submit validation re-fires for the re-seeded repo path', () => {
  it('re-enables the submit button after a successful create without user interaction', async () => {
    const api = installMockApi()

    // PATH_VALIDATE → valid git, WORKSPACE_CREATE_WITH_TERMINALS → success
    api.invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC.PATH_VALIDATE) return { valid: true, isGitRepo: true }
      if (channel === IPC.WORKSPACE_CREATE_WITH_TERMINALS) return { workspaceId: 'ws-new', error: null }
      return null
    })

    // Pre-seed lastRepoPath so the form mounts with the field populated.
    localStorage.setItem('claudinha:lastRepoPath', '/Users/me/myrepo')

    const onLaunched = vi.fn()
    const { container } = render(
      <LaunchForm onLaunched={onLaunched} nextWorkspaceNumber={1} />
    )

    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitButton).toBeTruthy()

    // Wait for the initial mount-time validation to land and enable submit.
    await waitFor(() => expect(submitButton.disabled).toBe(false), { timeout: 2000 })

    // Submit the form. Cleanup runs, re-seeds repoPath, resets validation,
    // and (with the fix) re-fires PATH_VALIDATE for the re-seeded path.
    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => expect(onLaunched).toHaveBeenCalled(), { timeout: 2000 })

    // Without the fix, the submit button stays disabled here forever because
    // repoValid/repoIsGit were nulled out and never re-resolved. With the fix,
    // validation fires and the button flips back to enabled.
    await waitFor(() => expect(submitButton.disabled).toBe(false), { timeout: 2000 })

    // And the repo field still shows the re-seeded path. (Inputs in render
    // order: [0] Workspace name, [1] Repository path.)
    const inputs = container.querySelectorAll('input')
    expect((inputs[1] as HTMLInputElement).value).toBe('/Users/me/myrepo')

    // PATH_VALIDATE was called at least twice: once on mount, once after submit
    // cleanup re-seeded the path.
    const pathValidateCalls = api.invoke.mock.calls.filter((c: unknown[]) => c[0] === IPC.PATH_VALIDATE)
    expect(pathValidateCalls.length).toBeGreaterThanOrEqual(2)
  })
})
