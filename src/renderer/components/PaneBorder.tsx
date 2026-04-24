import React, { useEffect, useRef, useState } from 'react'
import type { PaneStatus } from '../../shared/types'
import { STATUS_COLORS, STATUS_TERMINATED_COLOR } from '../lib/constants'

// ---------------------------------------------------------------------------
// PaneBorder
// ---------------------------------------------------------------------------

interface PaneBorderProps {
  status: PaneStatus
  terminated: boolean
  isFocused: boolean
  hasUnseenStatusChange?: boolean
  /**
   * When 'kanban', the focused-pane halo is suppressed (there's only one
   * terminal visible so focus is unambiguous; the halo was noise). Status
   * color border still renders for visual parity with Wall.
   */
  chromeMode?: 'wall' | 'kanban'
  /** True when this pane is focused — passed to children for header tint */
  children: React.ReactNode
}

/**
 * PaneBorder — status-colored border wrapping a pane.
 *
 * Focus encoding (L-002 compliant — box-shadow only, no border-width changes):
 * - Focused:   4px hard ring + stepped-alpha halo fading smoothly to transparent.
 * - Unfocused: 2px ring at status color ~70% alpha.
 * - Error unfocused: 2px ring + stepped-alpha dim halo at status color.
 * - Border-radius: 4px on all sides.
 *
 * Kanban chrome:
 * - No status-colored border. The pane sits flush against the Kanban board
 *   above, the repo rail on the left, and the window edge on the right, and
 *   is separated from them by subtle 1px dividers owned by the surrounding
 *   chrome (KanbanBoard wrapper's border-b, rail wrapper's border-r).
 *   Status is communicated by the Kanban column placement + the header's
 *   inline status chip, so the ring is redundant here.
 * - Border-radius: 0 — square corners match the flush-to-container geometry.
 *
 * Border-pulse: 1s ease-in-out on unfocused panes with unseen status change
 *   to needs-input / done / error. Error-lift: one-time translateY entrance.
 */
export function PaneBorder({
  status,
  terminated,
  isFocused,
  hasUnseenStatusChange = false,
  chromeMode = 'wall',
  children
}: PaneBorderProps): React.JSX.Element {
  // In Kanban mode the single-active-terminal model makes focus unambiguous,
  // so the halo adds noise rather than signal. Force the unfocused style.
  if (chromeMode === 'kanban') {
    isFocused = false
    hasUnseenStatusChange = false
  }
  const color = terminated ? STATUS_TERMINATED_COLOR : STATUS_COLORS[status]
  const isError = status === 'error' || terminated

  // Pulse when unfocused + unseen status change to needs-input / done / error
  const shouldPulse =
    !isFocused &&
    !terminated &&
    hasUnseenStatusChange &&
    (status === 'needs-input' || status === 'done' || status === 'error')

  // One-time error lift on transition into error/lost while unfocused
  const [isLifting, setIsLifting] = useState(false)
  const prevIsError = useRef(false)
  const prevIsFocused = useRef(isFocused)
  useEffect(() => {
    const enteredError = isError && !prevIsError.current
    const enteredUnfocused = !isFocused && prevIsFocused.current
    if (!isFocused && isError && (enteredError || enteredUnfocused)) {
      setIsLifting(true)
      const t = setTimeout(() => setIsLifting(false), 220)
      return () => clearTimeout(t)
    }
    prevIsError.current = isError
    prevIsFocused.current = isFocused
  }, [isError, isFocused])

  // Build box-shadow for focus/status chrome (L-002 compliant — no border-width changes)
  // Focused panes carry a 2px hard ring plus a pixel-stepped alpha halo that
  // fades smoothly in the ring's own color. All hard shadows (no blur) so the
  // boundary between ring and halo never reads as a dark "notch."
  //
  // Kanban: no chrome. The surrounding subtle 1px dividers (KanbanBoard
  // wrapper below, repo rail to the left) separate the pane from the rest
  // of the UI; status is carried by the column placement + header chip.
  const unfocusedShadow = `0 0 0 2px ${color}B3`
  let boxShadow: string | undefined
  if (chromeMode === 'kanban') {
    boxShadow = undefined
  } else if (isFocused) {
    // 2px solid + nine 1px halo steps out to 10px total.
    boxShadow = [
      `0 0 0 2px ${color}`,
      `0 0 0 3px ${color}E6`,
      `0 0 0 4px ${color}CC`,
      `0 0 0 5px ${color}B3`,
      `0 0 0 6px ${color}99`,
      `0 0 0 7px ${color}80`,
      `0 0 0 8px ${color}66`,
      `0 0 0 9px ${color}4D`,
      `0 0 0 10px ${color}33`
    ].join(', ')
  } else if (isError) {
    // Error panes get a persistent dim halo in addition to the 2px ring.
    boxShadow = `0 0 0 2px ${color}B3, 0 0 0 4px ${color}55, 0 0 0 6px ${color}22`
  } else {
    boxShadow = unfocusedShadow
  }

  // Pulse animates the 2px ring's own alpha (no halo) so the border itself
  // appears to breathe between dim and fully lit. Keeping the ring geometry
  // identical at both ends avoids "glow that appears and disappears."
  const pulseDimShadow = `0 0 0 2px ${color}4D`
  const pulsePeakShadow = `0 0 0 2px ${color}`
  const wrapperStyle: React.CSSProperties = chromeMode === 'kanban'
    ? {
        borderRadius: 0
      }
    : {
        borderRadius: 4,
        boxShadow,
        ...(shouldPulse && {
          '--ring-idle': pulseDimShadow,
          '--ring-peak': pulsePeakShadow,
          animation: 'border-pulse 1s ease-in-out infinite'
        } as React.CSSProperties)
      }

  const liftClass = isLifting ? 'pane-border--error-lift' : ''
  const pulsingClass = shouldPulse ? 'pane-border--pulsing' : ''

  return (
    <div
      className={`w-full flex flex-col box-border overflow-hidden h-full ${liftClass} ${pulsingClass}`}
      style={wrapperStyle}
    >
      {children}
    </div>
  )
}
