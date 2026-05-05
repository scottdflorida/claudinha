// @vitest-environment jsdom
//
// StatusOverlay — the floating pill that straddles the top border of a pane
// in wall mode. Aligned with the kanban column vocabulary so it speaks the
// same language as the kanban-mode pill above the same lifecycle states.
//
// Two invariants pinned here:
//   1. changes-ready panes read "Changes ready" (matching the kanban
//      column header), not the legacy "Done".
//   2. terminated panes drop the "Lost" override entirely. They show the
//      underlying status label, the pill border goes solid red (#DB4D3F),
//      and the icon stays the regular status icon — same treatment as the
//      kanban card's red left border.

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StatusOverlay } from '../../src/renderer/components/StatusOverlay'

describe('StatusOverlay — kanban-aligned vocabulary', () => {
  it('shows "Changes ready" for changes-ready panes (not "Done")', () => {
    const { getByText, queryByText } = render(
      <StatusOverlay
        status="changes-ready"
        activeToolName={null}
        terminated={false}
      />
    )
    expect(getByText('Changes ready')).toBeTruthy()
    expect(queryByText('Done')).toBeNull()
  })
})

describe('StatusOverlay — terminated panes', () => {
  it('does NOT show "Lost"; renders the underlying status label instead', () => {
    const { getByText, queryByText } = render(
      <StatusOverlay
        status="working"
        activeToolName={null}
        terminated={true}
      />
    )
    expect(queryByText('Lost')).toBeNull()
    expect(getByText('Working')).toBeTruthy()
  })

  it('frames the pill in solid red (#DB4D3F) when terminated', () => {
    const { getByText } = render(
      <StatusOverlay
        status="working"
        activeToolName={null}
        terminated={true}
      />
    )
    // The pill is the inline-flex container that holds the label span.
    const pill = getByText('Working').parentElement as HTMLElement | null
    expect(pill).not.toBeNull()
    // JSDOM normalizes hex → rgb when parsing the `border` shorthand.
    expect(pill?.style.borderColor).toBe('rgb(219, 77, 63)')
  })

  it('keeps the regular status icon when terminated (no AlertTriangle swap)', () => {
    const { container } = render(
      <StatusOverlay
        status="working"
        activeToolName={null}
        terminated={true}
      />
    )
    // lucide-react sets data-lucide on the rendered svg's class. We probe by
    // class name since lucide doesn't expose a stable test id.
    // Working maps to CircleDot; AlertTriangle would imply the old terminated
    // behavior is back.
    const svgs = container.querySelectorAll('svg')
    const classNames = Array.from(svgs).map(s => s.getAttribute('class') ?? '').join(' ')
    expect(classNames).toContain('lucide-circle-dot')
    expect(classNames).not.toContain('lucide-alert-triangle')
  })
})
