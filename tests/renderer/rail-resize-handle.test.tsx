// @vitest-environment jsdom
//
// RailResizeHandle drag math — mirrors KanbanResizeHandle on the X axis.
// Pins down the same contract: given maxWidthPx > persistedWidthPx, dragging
// right (positive dx) MUST commit a width larger than the start width.

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { RailResizeHandle } from '../../src/renderer/components/RailResizeHandle'

function findHandle(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[role="separator"]') as HTMLElement | null
  if (!el) throw new Error('resize handle not found')
  return el
}

describe('RailResizeHandle — drag math', () => {
  it('drag-right with headroom commits a larger persisted width', () => {
    const onDrag = vi.fn()
    const onCommit = vi.fn()
    const { container } = render(
      <RailResizeHandle
        persistedWidthPx={280}
        maxWidthPx={500}
        onDrag={onDrag}
        onCommit={onCommit}
      />
    )
    const handle = findHandle(container)

    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 160 }) // dx = +60
    fireEvent.mouseUp(window)

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(340)
  })

  it('drag-left below current width commits a smaller persisted width', () => {
    const onDrag = vi.fn()
    const onCommit = vi.fn()
    const { container } = render(
      <RailResizeHandle
        persistedWidthPx={400}
        maxWidthPx={500}
        onDrag={onDrag}
        onCommit={onCommit}
      />
    )
    const handle = findHandle(container)

    fireEvent.mouseDown(handle, { clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 150 }) // dx = -50
    fireEvent.mouseUp(window)

    expect(onCommit).toHaveBeenCalledWith(350)
  })

  it('regression: when maxWidthPx === persistedWidthPx, drag-right silently no-ops', () => {
    const onDrag = vi.fn()
    const onCommit = vi.fn()
    const { container } = render(
      <RailResizeHandle
        persistedWidthPx={280}
        maxWidthPx={280}
        onDrag={onDrag}
        onCommit={onCommit}
      />
    )
    const handle = findHandle(container)

    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 200 }) // dx = +100, but no headroom
    fireEvent.mouseUp(window)

    expect(onCommit).not.toHaveBeenCalled()
  })
})
