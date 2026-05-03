import React, { useEffect, useRef } from 'react'
import { KanbanCard } from './KanbanCard'
import { STATUS_COLORS } from '../lib/constants'
import type { KanbanMovingCard } from '../hooks/useKanbanCardMoves'

interface KanbanOverlayCardProps {
  moving: KanbanMovingCard
}

/**
 * Renders the in-flight card as a viewport-pinned clone that animates from
 * `fromRect` to `toRect` over `durationMs` with ease-out. Mounted in
 * KanbanBoard as a fixed-positioned sibling of the columns grid so it
 * inherits theme CSS context but escapes per-column `overflow-y: auto`
 * clipping.
 *
 * The clone is the same KanbanCard component used in columns. Its onClick /
 * rename / chip handlers are no-ops while in flight — interactions during
 * a move are deliberately suppressed so the user can't, e.g., click the X
 * on a card that is mid-move.
 */
export function KanbanOverlayCard({ moving }: KanbanOverlayCardProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { pane, fromRect, toRect, durationMs } = moving

  // Apply the target transform after first paint so the CSS transition runs
  // from translate(0,0) → translate(dx,dy). Using rAF to ensure the browser
  // commits the initial styles before changing them.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const dx = toRect.left - fromRect.left
    const dy = toRect.top - fromRect.top
    // Force a reflow read so the initial transform is committed.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.getBoundingClientRect()
    requestAnimationFrame(() => {
      el.style.transition = `transform ${durationMs}ms var(--ease-out)`
      el.style.transform = `translate(${dx}px, ${dy}px)`
    })
  }, [fromRect, toRect, durationMs])

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: fromRect.left,
        top: fromRect.top,
        width: fromRect.width,
        // Don't pin height — let the inner KanbanCard take its natural
        // height. Doing this keeps the overlay visually identical to a
        // freshly-rendered card at the destination.
        zIndex: 50,
        pointerEvents: 'none',
        // willChange hints the browser to composite this layer.
        willChange: 'transform',
        transform: 'translate(0, 0)'
      }}
      aria-hidden="true"
    >
      <KanbanCard
        pane={pane}
        statusColor={STATUS_COLORS[pane.status]}
        isActive={false}
        onClick={NOOP}
      />
    </div>
  )
}

function NOOP(): void {
  /* deliberately empty — overlay clone is non-interactive */
}
