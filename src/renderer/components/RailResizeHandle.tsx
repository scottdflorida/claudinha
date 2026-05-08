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

/**
 * Vertical drag handle on the right edge of the repo rail. Mirrors
 * KanbanResizeHandle for the X axis: local state tracks the drag at native
 * cadence, persisted state is written only on mouseup so we don't firehose
 * APP_CONFIG_SET.
 *
 * Visual: a 6px dark strip bracketed by left/right hairlines so the strip
 * reads as a divider with a grip pill in the middle. The strip is its own
 * hit area; the cursor change is the primary affordance.
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
      const handleMove = (evt: MouseEvent): void => {
        const dx = evt.clientX - startX
        latest = clamp(startWidth + dx, RAIL_MIN_WIDTH_PX, maxWidthPx)
        onDrag(latest)
      }
      const handleUp = (): void => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
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
      className="shrink-0 relative flex items-center justify-center select-none"
      style={{
        width: 6,
        cursor: 'ew-resize',
        background: '#1a1a19',
        borderLeft: '1px solid #575754',
        borderRight: '1px solid #575754',
        zIndex: 10
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 2,
          height: 32,
          borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.35)'
        }}
      />
    </div>
  )
}
