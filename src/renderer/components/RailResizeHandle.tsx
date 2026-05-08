import React, { useCallback } from 'react'
import { RAIL_MIN_WIDTH_PX } from '../../shared/types'
import { useStrings } from '../lib/strings'

interface RailResizeHandleProps {
  /** Width currently written to AppConfig — the baseline for this drag. */
  persistedWidthPx: number
  /** Live upper bound: rail can't grow past this (pane grid keeps a min). */
  maxWidthPx: number
  /** Local preview callback during drag, fires on every mousemove. */
  onDrag: (px: number) => void
  /** Persisted-commit callback; fires once on mouseup if the width changed. */
  onCommit: (px: number) => void
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}

const HIT_WIDTH = 8
const LINE_WIDTH = 2

/**
 * Subtle vertical resize handle on the right edge of the repo rail.
 *
 * Visual: a thin 2px line in the subtle border color, centered in an 8px
 * transparent hit area. Cursor switches to `grab` on hover and `grabbing`
 * while the user is actively dragging — the body cursor is overridden for
 * the duration of the drag so the grabbing icon sticks even when the
 * pointer leaves the strip.
 */
export function RailResizeHandle({
  persistedWidthPx,
  maxWidthPx,
  onDrag,
  onCommit
}: RailResizeHandleProps): React.JSX.Element {
  const t = useStrings()
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = persistedWidthPx
      let latest = startWidth
      // Lock the cursor to "grabbing" for the whole drag — even when the
      // pointer moves off the narrow handle and over the rail or pane grid,
      // the user is still resizing, so the cursor should still say so.
      const previousCursor = document.body.style.cursor
      document.body.style.cursor = 'grabbing'
      const handleMove = (evt: MouseEvent): void => {
        const dx = evt.clientX - startX
        latest = clamp(startWidth + dx, RAIL_MIN_WIDTH_PX, maxWidthPx)
        onDrag(latest)
      }
      const handleUp = (): void => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
        document.body.style.cursor = previousCursor
        if (latest !== startWidth) {
          onCommit(latest)
        } else {
          onDrag(startWidth)
        }
      }
      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [persistedWidthPx, maxWidthPx, onDrag, onCommit]
  )

  return (
    <div
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={t.railResizeHandle.aria}
      title={t.railResizeHandle.title}
      className="shrink-0 relative select-none"
      style={{
        width: HIT_WIDTH,
        cursor: 'grab',
        zIndex: 10
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: (HIT_WIDTH - LINE_WIDTH) / 2,
          width: LINE_WIDTH,
          background: 'var(--color-border-subtle)'
        }}
      />
    </div>
  )
}
