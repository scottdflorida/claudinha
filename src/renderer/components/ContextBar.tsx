import React from 'react'
import {
  CONTEXT_WARNING_THRESHOLD,
  RATE_LIMIT_WARNING_COLOR
} from '../lib/constants'

// Fill + text colors are theme-aware via the existing CSS custom properties
// (see globals.css). We piggyback on the rate-limit warning/text tokens so a
// single swatch defines "darkish red" and "readable label" across themes. The
// non-warning fill reuses the warm-gray neutral that powers strong borders.
const CONTEXT_FILL_GRAY_VAR    = 'var(--color-border-strong)'
const CONTEXT_FILL_WARNING_VAR = 'var(--rate-limit-fill-warning)'
const CONTEXT_TEXT_VAR         = 'var(--rate-limit-text)'

// Gauge box outline color (neutral — matches fill below threshold so the pill
// reads as a single block; swaps to warning color at/above threshold to echo
// the fill flip).
const GAUGE_BORDER_COLOR = 'var(--color-border-strong)'

/** Fixed pill width in px. Fits "ctx 100%" at 11px tabular-nums with breathing room. */
const CONTEXT_BAR_WIDTH_PX = 80

/**
 * Fill color for the context gauge. Warm gray below the warning threshold,
 * darkish red at/above it. Exported for unit testing.
 */
export function contextFillColor(pct: number): string {
  return pct >= CONTEXT_WARNING_THRESHOLD ? CONTEXT_FILL_WARNING_VAR : CONTEXT_FILL_GRAY_VAR
}

interface ContextBarProps {
  /** Context window used, 0–100. Null → placeholder pill ("ctx —"). */
  contextPercent: number | null
}

/**
 * ContextBar — a mini progress bar showing Claude-Code's context window usage,
 * rendered in the Kanban-mode PaneHeader's right-hand cluster. Structure mirrors
 * RateLimitBar's gauges (absolute-positioned fill behind centered text, fixed
 * outer width for layout stability). Fill is warm gray until usage reaches
 * CONTEXT_WARNING_THRESHOLD (70%), then flips to darkish red.
 *
 * When `contextPercent` is null, renders a placeholder pill of the same outer
 * dimensions so incoming data doesn't reflow the header.
 */
export function ContextBar({ contextPercent }: ContextBarProps): React.JSX.Element {
  if (contextPercent == null) {
    return (
      <span
        style={{
          display: 'inline-block',
          boxSizing: 'border-box',
          width: CONTEXT_BAR_WIDTH_PX,
          padding: '1px 0',
          border: `1px solid ${GAUGE_BORDER_COLOR}`,
          borderRadius: 8,
          textAlign: 'center'
        }}
      >
        <span className="text-[11px] tabular-nums text-fg-muted">ctx —</span>
      </span>
    )
  }

  const pct = Math.max(0, Math.min(100, Math.round(contextPercent)))
  const isWarning = pct >= CONTEXT_WARNING_THRESHOLD
  const fillColor = contextFillColor(pct)
  const borderColor = isWarning ? RATE_LIMIT_WARNING_COLOR : GAUGE_BORDER_COLOR

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        boxSizing: 'border-box',
        width: CONTEXT_BAR_WIDTH_PX,
        padding: '1px 0',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        overflow: 'hidden',
        textAlign: 'center'
      }}
      title={`Context window: ${pct}%`}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          backgroundColor: fillColor,
          zIndex: 0
        }}
      />
      <span
        className="relative text-[11px] tabular-nums"
        style={{ zIndex: 1, color: CONTEXT_TEXT_VAR }}
      >
        ctx {pct}%
      </span>
    </span>
  )
}
