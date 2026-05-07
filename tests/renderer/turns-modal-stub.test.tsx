// @vitest-environment jsdom
//
// TurnsModal — M0 stub. Verifies the placeholder renders, the close button
// fires `onClose`, and the dialog `data-testid` is present so M1+ tests can
// target the same surface.
//
// Real interaction (turn list, publish dropdown, hunk picker, etc.) lands
// in milestones M1-M5 with their own focused tests.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { TurnsModal } from '../../src/renderer/components/TurnsModal'

// jsdom doesn't implement HTMLDialogElement.showModal/close — stub them so
// our `<dialog>`-based modal mounts cleanly under test.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
})

describe('TurnsModal — M0 stub', () => {
  it('renders with the pane name in the title', () => {
    const { getByText } = render(
      <TurnsModal
        paneId="pane-1"
        paneName="ctest5/wt-877543"
        workspaceId="ws-1"
        onClose={() => {}}
      />
    )
    expect(getByText(/Turns · ctest5\/wt-877543/)).toBeTruthy()
  })

  it('shows the "coming soon" placeholder so users know this is M0 scaffolding', () => {
    const { getByText } = render(
      <TurnsModal
        paneId="pane-1"
        paneName="agent-A"
        workspaceId={null}
        onClose={() => {}}
      />
    )
    // Two strings on the page contain "coming soon" — match the first
    // (the headline) via a more specific regex.
    expect(getByText(/Turn-based completion actions are landing soon/i)).toBeTruthy()
  })

  it('fires onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    const { getByLabelText } = render(
      <TurnsModal
        paneId="pane-1"
        paneName="agent-A"
        workspaceId="ws-1"
        onClose={onClose}
      />
    )
    fireEvent.click(getByLabelText('Close turns modal'))
    expect(onClose).toHaveBeenCalled()
  })

  it('fires onClose when the footer "Close" button is clicked', () => {
    const onClose = vi.fn()
    const { getByText } = render(
      <TurnsModal
        paneId="pane-1"
        paneName="agent-A"
        workspaceId="ws-1"
        onClose={onClose}
      />
    )
    fireEvent.click(getByText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('exposes a stable data-testid for milestone-spanning integration tests', () => {
    const { container } = render(
      <TurnsModal
        paneId="pane-xyz"
        paneName="agent-A"
        workspaceId="ws-1"
        onClose={() => {}}
      />
    )
    const dialog = container.querySelector('[data-testid="turns-modal-pane-xyz"]')
    expect(dialog).not.toBeNull()
  })

  it('accepts a null workspaceId (legacy / transient context)', () => {
    expect(() =>
      render(
        <TurnsModal
          paneId="pane-1"
          paneName="agent-A"
          workspaceId={null}
          onClose={() => {}}
        />
      )
    ).not.toThrow()
  })
})
