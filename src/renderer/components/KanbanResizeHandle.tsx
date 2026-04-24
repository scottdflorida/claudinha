import React, { useCallback } from 'react'
import { KANBAN_MIN_HEIGHT_PX } from '../../shared/types'
import { useStrings } from '../lib/strings'

interface KanbanResizeHandleProps {
  /** Height currently written to AppConfig — the baseline for this drag. */
  persistedHeightPx: number
  /** Live upper bound: board can't grow past this (6 terminal rows remain). */
  maxHeightPx: number
  /** Local preview callback during drag, fires on every mousemove. */
  onDrag: (px: number) => void
  /** Persisted-commit callback; fires once on mouseup if the height changed. */
  onCommit: (px: number) => void
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}

/**
 * Horizontal drag handle below the Kanban board. Mirrors the InspectorDrawer
 * resize pattern: local state tracks the drag at native cadence, persisted
 * state is written only on mouseup so we don't firehose APP_CONFIG_SET.
 *
 * Visual: a 10px dark strip bracketed by column-divider hairlines, with a
 * centered pill indicator so the grip is obviously a grip. A transparent
 * invisible 6px halo is NOT needed — the 10px visible strip is itself the
 * hit area, and is large enough to target reliably even when the board has
 * just been shrunk down close to the terminal.
 *
 * `position: relative` + `z-index: 10` guarantees the handle stacks above
 * any absolute-positioned chrome in PaneGrid (kanban-stack uses absolute
 * positioning inside its own box; they can't reach up into the handle's
 * box, but the z-index is defense against a future regression).
 */
export function KanbanResizeHandle({
  persistedHeightPx,
  maxHeightPx,
  onDrag,
  onCommit
}: KanbanResizeHandleProps): React.JSX.Element {
  const t = useStrings()
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startY = e.clientY
      const startHeight = persistedHeightPx
      let latest = startHeight
      const handleMove = (evt: MouseEvent): void => {
        const dy = evt.clientY - startY
        latest = clamp(startHeight + dy, KANBAN_MIN_HEIGHT_PX, maxHeightPx)
        onDrag(latest)
      }
      const handleUp = (): void => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
        if (latest !== startHeight) {
          onCommit(latest)
        } else {
          // No effective move — clear any preview state so the parent falls
          // back to the persisted height without writing to config.
          onDrag(startHeight)
        }
      }
      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [persistedHeightPx, maxHeightPx, onDrag, onCommit]
  )

  return (
    <div
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="horizontal"
      aria-label={t.kanbanResizeHandle.aria}
      title={t.kanbanResizeHandle.title}
      className="shrink-0 relative flex items-center justify-center select-none"
      style={{
        height: 10,
        cursor: 'ns-resize',
        background: '#1a1a19',
        borderTop: '1px solid #575754',
        borderBottom: '1px solid #575754',
        zIndex: 10
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 2,
          borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.35)'
        }}
      />
    </div>
  )
}
