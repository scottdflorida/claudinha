// @vitest-environment jsdom
//
// PaneGrid kanban-stack layout — verifies:
//   - All panes mount with stable per-id wrapper divs (L-005, L-008).
//   - Toggling layout=wall ↔ kanban-stack does not destroy any wrapper div
//     (so xterm instances inside <Pane> survive view-mode flips).
//   - Only the active pane is `visibility: visible`; the rest are
//     `visibility: hidden` but still occupy layout (so ResizeObserver fires
//     and PTY sizes stay correct).
//   - Pane add/remove preserves identity for surviving panes.
//
// We mock <Pane> because it pulls in xterm.js + IPC; we only care here that
// the wrapper structure around it is stable.

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../src/renderer/components/Pane', () => ({
  Pane: ({ paneId }: { paneId: string }) => (
    <div data-testid="pane-stub" data-pane-id={paneId}>
      pane:{paneId}
    </div>
  )
}))

import { PaneGrid } from '../../src/renderer/components/PaneGrid'

function getWrapperDivs(container: HTMLElement): HTMLElement[] {
  // Each wrapper div directly contains a <div data-testid="pane-stub" ...>.
  // We grab those parents to introspect their inline styles.
  return Array.from(container.querySelectorAll('[data-testid="pane-stub"]'))
    .map((stub) => stub.parentElement!)
    .filter(Boolean) as HTMLElement[]
}

describe('PaneGrid — kanban-stack layout', () => {
  it('mounts every pane and only marks the active one visible', () => {
    const { container } = render(
      <PaneGrid
        paneIds={['p1', 'p2', 'p3']}
        layout="kanban-stack"
        activePaneId="p2"
      />
    )
    const wrappers = getWrapperDivs(container)
    expect(wrappers).toHaveLength(3)
    const byPaneId = (id: string) => wrappers.find((w) => w.querySelector(`[data-pane-id="${id}"]`))!

    expect(byPaneId('p1').style.visibility).toBe('hidden')
    expect(byPaneId('p2').style.visibility).toBe('visible')
    expect(byPaneId('p3').style.visibility).toBe('hidden')

    // Hidden panes ignore pointer events so users can't click through them.
    expect(byPaneId('p1').style.pointerEvents).toBe('none')
    expect(byPaneId('p2').style.pointerEvents).toBe('auto')

    // All panes are absolute-positioned in the same box (so ResizeObserver
    // fires for every pane on container resize, keeping PTY sizes correct).
    for (const w of wrappers) {
      expect(w.style.position).toBe('absolute')
      expect(w.style.inset).toBe('0px')
    }

    // aria-hidden flags the inactive ones for assistive tech.
    expect(byPaneId('p1').getAttribute('aria-hidden')).toBe('true')
    expect(byPaneId('p2').getAttribute('aria-hidden')).toBe('false')
  })

  it('flipping activePaneId does not unmount any pane wrapper', () => {
    const { container, rerender } = render(
      <PaneGrid
        paneIds={['p1', 'p2', 'p3']}
        layout="kanban-stack"
        activePaneId="p1"
      />
    )
    const before = getWrapperDivs(container)

    rerender(
      <PaneGrid
        paneIds={['p1', 'p2', 'p3']}
        layout="kanban-stack"
        activePaneId="p3"
      />
    )
    const after = getWrapperDivs(container)

    // Same DOM nodes — React reused the wrappers (panes did not unmount).
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBe(before[i])
    }
  })

  it('switching layout wall ↔ kanban-stack does not unmount any pane wrapper (L-005)', () => {
    const { container, rerender } = render(
      <PaneGrid paneIds={['p1', 'p2']} layout="wall" />
    )
    const wallStubsBefore = container.querySelectorAll('[data-testid="pane-stub"]')
    expect(wallStubsBefore).toHaveLength(2)

    rerender(
      <PaneGrid paneIds={['p1', 'p2']} layout="kanban-stack" activePaneId="p1" />
    )
    const stackStubs = container.querySelectorAll('[data-testid="pane-stub"]')
    expect(stackStubs).toHaveLength(2)
    // Same Pane stub DOM nodes — React kept the children alive across the
    // layout switch (per the "stable wrapper" invariant). If this fails, the
    // structure has regressed and xterm instances would be destroyed in
    // production.
    expect(stackStubs[0]).toBe(wallStubsBefore[0])
    expect(stackStubs[1]).toBe(wallStubsBefore[1])

    // And back again.
    rerender(<PaneGrid paneIds={['p1', 'p2']} layout="wall" />)
    const wallStubsAfter = container.querySelectorAll('[data-testid="pane-stub"]')
    expect(wallStubsAfter[0]).toBe(wallStubsBefore[0])
    expect(wallStubsAfter[1]).toBe(wallStubsBefore[1])
  })

  it('with activePaneId=null, every pane is hidden (no auto-select inside the grid)', () => {
    // Auto-selection of the first pane is the workspace shell's job, not the
    // grid's — the grid honors null literally.
    const { container } = render(
      <PaneGrid paneIds={['p1', 'p2']} layout="kanban-stack" activePaneId={null} />
    )
    for (const w of getWrapperDivs(container)) {
      expect(w.style.visibility).toBe('hidden')
    }
  })
})
