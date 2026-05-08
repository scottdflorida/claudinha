// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { installMockApi, uninstallMockApi } from './helpers/mock-api'
import { LaunchForm, __resetCachedLaunchStateForTests } from '../../src/renderer/components/LaunchForm'
import { IPC } from '../../src/shared/ipc-channels'

// useAppConfig reads from window.api → shim it so the form can mount in jsdom.
// `defaultModel: undefined` → no setting-level default, so the form falls
// through to the localStorage `claudinha:lastModel` key (i.e. last-choice
// behavior). Mirrors how the form behaves when the user picks "None" in
// Configuration → Default model for new terminals.
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
  // LaunchForm keeps a module-level cache of in-progress form values so
  // navigation away/back doesn't lose state. Reset it between tests so
  // each render sees a clean slate.
  __resetCachedLaunchStateForTests()
})

afterEach(() => {
  cleanup()
  uninstallMockApi()
  vi.clearAllMocks()
  localStorage.clear()
})

// Each segmented control renders its options as <button aria-pressed={isActive}>
// (see src/renderer/components/ui/SegmentedControl.tsx). Querying by accessible
// name + pressed state lets each assertion target one specific control without
// depending on DOM order.
describe('LaunchForm — remembers last choice for fields without a Settings default', () => {
  it('seeds Publish path / Terminal location / Branch layout / Branch naming / Effort / Model from last* localStorage keys on mount', () => {
    installMockApi()

    localStorage.setItem('claudinha:lastPublishPath', 'pr')
    localStorage.setItem('claudinha:lastRepoMode', 'per-pane')
    localStorage.setItem('claudinha:lastWorktreeMode', 'shared')
    localStorage.setItem('claudinha:lastNamingMode', 'manual')
    localStorage.setItem('claudinha:lastEffort', 'medium')
    localStorage.setItem('claudinha:lastModel', 'sonnet')

    const { getByRole } = render(
      <LaunchForm onLaunched={vi.fn()} nextWorkspaceNumber={1} />
    )

    // Visible segmented controls reflect the persisted last choices. The
    // Advanced section's controls are present in the DOM even when the
    // collapse is closed, so we can query them by accessible name.
    expect(getByRole('button', { name: 'Pull request', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Choose Repo per Terminal', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Shared across terminals', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Custom', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Med', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Sonnet', pressed: true })).toBeTruthy()
  })

  it('falls back to factory defaults when the last* keys are absent', () => {
    installMockApi()
    // localStorage cleared in beforeEach — no last* keys present.

    const { getByRole } = render(
      <LaunchForm onLaunched={vi.fn()} nextWorkspaceNumber={1} />
    )

    expect(getByRole('button', { name: 'Both', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'All Terminals in Same Repo', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Separate per terminal', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Auto', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'High', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Opus', pressed: true })).toBeTruthy()
  })

  it('falls back to factory defaults when a last* key holds an invalid value', () => {
    installMockApi()

    // Junk values that don't match any enum member.
    localStorage.setItem('claudinha:lastPublishPath', 'not-a-real-mode')
    localStorage.setItem('claudinha:lastRepoMode', 'garbage')
    localStorage.setItem('claudinha:lastWorktreeMode', '')
    localStorage.setItem('claudinha:lastNamingMode', 'xxx')
    localStorage.setItem('claudinha:lastEffort', 'super-max')

    const { getByRole } = render(
      <LaunchForm onLaunched={vi.fn()} nextWorkspaceNumber={1} />
    )

    expect(getByRole('button', { name: 'Both', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'All Terminals in Same Repo', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Separate per terminal', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'Auto', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'High', pressed: true })).toBeTruthy()
  })

  it('clamps Effort down to High on init when the persisted last-model is not Opus', () => {
    installMockApi()

    // Sonnet does not allow Max/X-High effort. The init logic should mirror
    // the existing constraint (setModel + the appConfig effect) and clamp.
    localStorage.setItem('claudinha:lastModel', 'sonnet')
    localStorage.setItem('claudinha:lastEffort', 'max')

    const { getByRole } = render(
      <LaunchForm onLaunched={vi.fn()} nextWorkspaceNumber={1} />
    )

    expect(getByRole('button', { name: 'Sonnet', pressed: true })).toBeTruthy()
    expect(getByRole('button', { name: 'High', pressed: true })).toBeTruthy()
  })

  it('persists the user\'s choices to last* keys on successful submit', async () => {
    const api = installMockApi()
    api.invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC.PATH_VALIDATE) return { valid: true, isGitRepo: true }
      if (channel === IPC.WORKSPACE_CREATE_WITH_TERMINALS) return { workspaceId: 'ws-new', error: null }
      return null
    })

    // Pre-seed only the repo path so the form is submittable in single-repo
    // mode. Other fields start at factory defaults.
    localStorage.setItem('claudinha:lastRepoPath', '/Users/me/myrepo')

    const { getByRole, container } = render(
      <LaunchForm onLaunched={vi.fn()} nextWorkspaceNumber={1} />
    )

    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(submitButton).toBeTruthy()
    await waitFor(() => expect(submitButton.disabled).toBe(false), { timeout: 2000 })

    // Change Publish path (visible without expanding Advanced) and a model
    // pick (inside Advanced — buttons are in the DOM regardless of collapse
    // state). Worktree-mode/naming-mode flips would change the rest of the
    // form's structure, so keep this test focused on a couple of segments.
    fireEvent.click(getByRole('button', { name: 'Pull request' }))
    fireEvent.click(getByRole('button', { name: 'Sonnet' }))
    fireEvent.click(getByRole('button', { name: 'Shared across terminals' }))

    // Submit.
    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => {
      expect(localStorage.getItem('claudinha:lastPublishPath')).toBe('pr')
      expect(localStorage.getItem('claudinha:lastModel')).toBe('sonnet')
      expect(localStorage.getItem('claudinha:lastWorktreeMode')).toBe('shared')
      // Untouched fields persist their factory defaults so a future mount
      // reads a stable value (no junk, no missing key surprises).
      expect(localStorage.getItem('claudinha:lastRepoMode')).toBe('single')
      expect(localStorage.getItem('claudinha:lastNamingMode')).toBe('auto')
      expect(localStorage.getItem('claudinha:lastEffort')).toBe('high')
    }, { timeout: 2000 })
  })

  it('after a successful submit, re-seeds the form from the just-persisted last* values (LaunchForm stays mounted across creates)', async () => {
    const api = installMockApi()
    api.invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC.PATH_VALIDATE) return { valid: true, isGitRepo: true }
      if (channel === IPC.WORKSPACE_CREATE_WITH_TERMINALS) return { workspaceId: 'ws-new', error: null }
      return null
    })

    localStorage.setItem('claudinha:lastRepoPath', '/Users/me/myrepo')

    const { getByRole, container } = render(
      <LaunchForm onLaunched={vi.fn()} nextWorkspaceNumber={1} />
    )

    const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement
    await waitFor(() => expect(submitButton.disabled).toBe(false), { timeout: 2000 })

    // User picks non-default values.
    fireEvent.click(getByRole('button', { name: 'Pull request' }))
    fireEvent.click(getByRole('button', { name: 'Shared across terminals' }))

    await act(async () => {
      fireEvent.click(submitButton)
    })

    // Wait until cleanup has re-seeded the form from localStorage. After
    // cleanup the form should still show the user's choices (not factory
    // defaults), because the workspace opens in its own Electron window
    // and LaunchForm itself stays mounted in the manager.
    await waitFor(() => {
      expect(getByRole('button', { name: 'Pull request', pressed: true })).toBeTruthy()
      expect(getByRole('button', { name: 'Shared across terminals', pressed: true })).toBeTruthy()
    }, { timeout: 2000 })
  })
})
