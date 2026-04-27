// @vitest-environment jsdom
//
// KanbanResizeHandle drag math — pins down the contract WindowShell relies on:
// given maxHeightPx > persistedHeightPx, dragging down (positive dy) MUST
// produce a value larger than the start height. The drag-handle bug we're
// regressing against masqueraded as a frozen handle: when WindowShell handed
// the handle maxHeightPx === persistedHeightPx (because the kanban-column
// ref's clientHeight had never been measured), the clamp inside this
// component silently no-op'd every drag-down, and the user could only ever
// shrink. The fix lives in WindowShell — this test makes sure the handle
// itself keeps its half of the contract.

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { KanbanResizeHandle } from '../../src/renderer/components/KanbanResizeHandle'

// useStrings reads from the AppConfig context; outside a provider the hook
// falls back to English via the standalone path. That's enough for this test.

function findHandle(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[role="separator"]') as HTMLElement | null
  if (!el) throw new Error('resize handle not found')
  return el
}

describe('KanbanResizeHandle — drag math', () => {
  it('drag-down with headroom commits a larger persisted height', () => {
    const onDrag = vi.fn()
    const onCommit = vi.fn()
    const { container } = render(
      <KanbanResizeHandle
        persistedHeightPx={160}
        maxHeightPx={400}
        onDrag={onDrag}
        onCommit={onCommit}
      />
    )
    const handle = findHandle(container)

    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 150 }) // dy = +50
    fireEvent.mouseUp(window)

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(210)
  })

  it('drag-up below current height commits a smaller persisted height', () => {
    const onDrag = vi.fn()
    const onCommit = vi.fn()
    const { container } = render(
      <KanbanResizeHandle
        persistedHeightPx={300}
        maxHeightPx={400}
        onDrag={onDrag}
        onCommit={onCommit}
      />
    )
    const handle = findHandle(container)

    fireEvent.mouseDown(handle, { clientY: 200 })
    fireEvent.mouseMove(window, { clientY: 150 }) // dy = -50
    fireEvent.mouseUp(window)

    expect(onCommit).toHaveBeenCalledWith(250)
  })

  it('regression: when maxHeightPx === persistedHeightPx, drag-down silently no-ops', () => {
    // This is the SHAPE of the WindowShell bug — documenting it here so the
    // contract is explicit. The handle DOES correctly clamp at maxHeightPx;
    // what was broken is that WindowShell was handing it maxHeightPx ===
    // persistedHeightPx (i.e. zero headroom) when the kanban column hadn't
    // been measured. This test confirms why that was un-draggable.
    const onDrag = vi.fn()
    const onCommit = vi.fn()
    const { container } = render(
      <KanbanResizeHandle
        persistedHeightPx={160}
        maxHeightPx={160}
        onDrag={onDrag}
        onCommit={onCommit}
      />
    )
    const handle = findHandle(container)

    fireEvent.mouseDown(handle, { clientY: 100 })
    fireEvent.mouseMove(window, { clientY: 200 }) // dy = +100, but no headroom
    fireEvent.mouseUp(window)

    expect(onCommit).not.toHaveBeenCalled() // drag-down clamps to startHeight, no commit
  })
})
