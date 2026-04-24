// @vitest-environment jsdom
//
// PaneBorder — chromeMode='kanban' status-ring chrome.
//
// Regression: the Wall-mode status ring does not work in Kanban view (the
// pane fills its container edge-to-edge between the repo rail on the left,
// the Kanban board above, and the window edge on the right):
//   - An OUTSET 2px ring clipped into those neighbours and ran off-window.
//   - An INSET shadow was masked by the xterm terminal + pane header, which
//     paint above inset shadows.
//   - A real CSS `border` was visible but added a colored frame that the
//     design decided was redundant — status is carried by the column
//     placement in the board above and the header's inline status chip.
// The current shipping behaviour: no chrome from PaneBorder in Kanban mode.
// Separation from surrounding UI is owned by the subtle 1px dividers on
// the KanbanBoard wrapper (below the board) and the repo rail wrapper
// (border-r). Wall mode is unchanged.

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PaneBorder } from '../../src/renderer/components/PaneBorder'

function getWrapper(container: HTMLElement): HTMLElement {
  // PaneBorder renders a single wrapper div around its children.
  const wrapper = container.firstElementChild as HTMLElement | null
  if (!wrapper) throw new Error('PaneBorder wrapper not found')
  return wrapper
}

describe('PaneBorder — chromeMode="kanban"', () => {
  it('paints no status-colored border, ring, or shadow around the pane', () => {
    const { container } = render(
      <PaneBorder
        status="needs-input"
        terminated={false}
        isFocused={false}
        chromeMode="kanban"
      >
        <div>child</div>
      </PaneBorder>
    )
    const wrapper = getWrapper(container)
    // No border, no box-shadow — the surrounding subtle dividers
    // (KanbanBoard border-b, rail border-r) own the separation.
    expect(wrapper.style.boxShadow).toBe('')
    expect(wrapper.style.border).not.toMatch(/\b(?:1|2|3|4)px solid/)
  })

  it('has square corners (border-radius 0) in Kanban view', () => {
    const { container } = render(
      <PaneBorder
        status="working"
        terminated={false}
        isFocused={false}
        chromeMode="kanban"
      >
        <div>child</div>
      </PaneBorder>
    )
    const wrapper = getWrapper(container)
    expect(wrapper.style.borderRadius).toBe('0px')
  })

  it('paints no halo when the pane is in error state', () => {
    const { container } = render(
      <PaneBorder
        status="error"
        terminated={false}
        isFocused={false}
        chromeMode="kanban"
      >
        <div>child</div>
      </PaneBorder>
    )
    const wrapper = getWrapper(container)
    // Wall-mode error panes get a multi-layer dim halo. Kanban suppresses it:
    // error context is still communicated by ERROR column placement + red
    // status chip in the header.
    expect(wrapper.style.boxShadow).toBe('')
    expect(wrapper.style.border).not.toMatch(/\b(?:1|2|3|4)px solid/)
  })

  it('forces isFocused=false so the focus-halo never renders in Kanban', () => {
    const { container } = render(
      <PaneBorder
        status="working"
        terminated={false}
        isFocused={true}
        chromeMode="kanban"
      >
        <div>child</div>
      </PaneBorder>
    )
    const wrapper = getWrapper(container)
    // The Wall-mode focus halo layers nine outset shadows — Kanban must
    // collapse to no chrome regardless of what the caller passes.
    expect(wrapper.style.boxShadow).toBe('')
  })

  it('keeps Wall-mode chrome untouched (outset ring via box-shadow + 4px radius)', () => {
    const { container } = render(
      <PaneBorder
        status="working"
        terminated={false}
        isFocused={false}
        chromeMode="wall"
      >
        <div>child</div>
      </PaneBorder>
    )
    const wrapper = getWrapper(container)
    // Wall still uses box-shadow (outset) for the status ring.
    expect(wrapper.style.boxShadow).not.toBe('')
    expect(wrapper.style.boxShadow).not.toMatch(/inset/)
    // And no solid border.
    expect(wrapper.style.border).not.toMatch(/\b(?:1|2|3|4)px solid/)
    expect(wrapper.style.borderRadius).toBe('4px')
  })
})
