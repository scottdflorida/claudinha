import React, { useEffect, useState } from 'react'
import type { RateLimitWindow } from '../../shared/ipc-channels'
import { useStrings } from '../lib/strings'
import {
  RATE_LIMIT_WARNING_THRESHOLD,
  RATE_LIMIT_WARNING_COLOR
} from '../lib/constants'

// Gauge fill + text are theme-aware via CSS custom properties (see globals.css).
// Dark mode keeps the legacy navy/red pair with near-white text. Light mode
// flips to a vivid blue with dark warm charcoal text so the label stays
// readable across the filled and unfilled halves of the bar.
const RATE_LIMIT_FILL_VAR         = 'var(--rate-limit-fill)'
const RATE_LIMIT_FILL_WARNING_VAR = 'var(--rate-limit-fill-warning)'
const RATE_LIMIT_TEXT_VAR         = 'var(--rate-limit-text)'

// ---------------------------------------------------------------------------
// Helpers — exported for unit testing
// ---------------------------------------------------------------------------

/** Format a countdown from now to a future ISO timestamp: "3h 12m", "2d 5h 30m" */
export function formatCountdown(isoString: string): string {
  try {
    const now = Date.now()
    const target = new Date(isoString).getTime()
    let remaining = Math.max(0, target - now)

    if (remaining === 0) return 'now'

    const days = Math.floor(remaining / (1000 * 60 * 60 * 24))
    remaining %= 1000 * 60 * 60 * 24
    const hours = Math.floor(remaining / (1000 * 60 * 60))
    remaining %= 1000 * 60 * 60
    const minutes = Math.floor(remaining / (1000 * 60))

    const parts: string[] = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    return parts.join(' ') || '<1m'
  } catch {
    return ''
  }
}

// Gauge box outline color (neutral gray below the warning threshold)
const GAUGE_BORDER_COLOR = 'var(--color-border-strong)'

/**
 * Grace period past `resetsAt` before we treat a rate-limit window as stale.
 * Rate-limit payloads only refresh when Claude Code pushes a new statusline
 * (usually on the next turn). If the user isn't actively running a turn when
 * the window rolls over, the payload stays frozen — without this check we
 * keep rendering "85% resets in now" indefinitely against expired data.
 * The grace lets the natural "now" / "<1m" flicker render around the actual
 * boundary; only clearly-past data flips to the placeholder.
 */
const RATE_LIMIT_STALE_GRACE_MS = 60_000

/**
 * Fixed width for every rate-limit gauge, in px. Sized to comfortably contain
 * the longest possible 7d label ("⚠ 7d: 100% resets in 6d 23h 59m") in the
 * 11px monospace font with a small buffer on each side. Both gauges use the
 * same width so they line up regardless of their current text length.
 */
const GAUGE_WIDTH_PX = 240

/**
 * Gauge fill color — a calm muted blue at all times below the warning
 * threshold, switching to a dark red once usage reaches
 * RATE_LIMIT_WARNING_THRESHOLD. Sharing the threshold with the warning border
 * keeps the fill flip and the border flip in lockstep.
 */
export function rateLimitFillColor(pct: number): string {
  return pct >= RATE_LIMIT_WARNING_THRESHOLD ? RATE_LIMIT_FILL_WARNING_VAR : RATE_LIMIT_FILL_VAR
}

/** Build the display string for one rate limit window: "5h: 42% resets in 3h12m" */
export function formatRateLimitLabel(
  label: string,
  window: RateLimitWindow | null,
  warningThreshold: number
): { text: string; isWarning: boolean } | null {
  if (!window) return null
  // Once resetsAt is clearly in the past, the usedPercentage is stale. Return
  // null so RateLimitBar falls through to its placeholder ("5h: —") instead of
  // parroting a frozen "85% resets in now". Fresh data reclaims the gauge on
  // the next statusline push.
  const resetTime = new Date(window.resetsAt).getTime()
  if (Number.isFinite(resetTime) && Date.now() - resetTime > RATE_LIMIT_STALE_GRACE_MS) {
    return null
  }
  const pct = Math.round(window.usedPercentage)
  const isWarning = pct >= warningThreshold
  const prefix = isWarning ? '\u26A0 ' : ''
  const countdown = formatCountdown(window.resetsAt)
  const resetSuffix = countdown ? ` resets in ${countdown}` : ''
  return { text: `${prefix}${label}: ${pct}%${resetSuffix}`, isWarning }
}

// ---------------------------------------------------------------------------
// RateLimitBar
// ---------------------------------------------------------------------------

interface RateLimitBarProps {
  fiveHour: RateLimitWindow | null
  sevenDay: RateLimitWindow | null
}

/**
 * RateLimitBar — full-width bottom bar showing rate limit gauges (PE-01).
 *
 * Format: "Rate Limits:   5h:xx% resets in xhxm      7d:xx% resets in xdxhxm"
 * Text turns amber with a warning prefix at ≥90% usage.
 *
 * Always rendered once mounted — each window shows either a live gauge or a
 * fixed-width placeholder so the bar exists from first frame and doesn't
 * reflow when real data arrives. Only mounted for non-API billing accounts
 * (conditional logic in WindowShell).
 */
export function RateLimitBar({ fiveHour, sevenDay }: RateLimitBarProps): React.JSX.Element {
  const t = useStrings()
  // Re-render every 30s so countdowns stay fresh
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  const fiveHourLabel = formatRateLimitLabel('5h', fiveHour, RATE_LIMIT_WARNING_THRESHOLD)
  const sevenDayLabel = formatRateLimitLabel('7d', sevenDay, RATE_LIMIT_WARNING_THRESHOLD)

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-fg-secondary">{t.rateLimit.rateLimitsHeader}</span>
      {fiveHourLabel && fiveHour
        ? <RateLimitGauge label={fiveHourLabel} window={fiveHour} />
        : <RateLimitPlaceholder label="5h: —" />}
      {sevenDayLabel && sevenDay
        ? <RateLimitGauge label={sevenDayLabel} window={sevenDay} />
        : <RateLimitPlaceholder label="7d: —" />}
    </div>
  )
}

interface RateLimitPlaceholderProps {
  label: string
}

/**
 * Placeholder gauge shown before the first rate-limit statusline update arrives.
 * Matches RateLimitGauge's outer dimensions so the bar doesn't reflow when
 * real data populates.
 */
function RateLimitPlaceholder({ label }: RateLimitPlaceholderProps): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        boxSizing: 'border-box',
        width: GAUGE_WIDTH_PX,
        padding: '1px 0',
        border: `1px solid ${GAUGE_BORDER_COLOR}`,
        borderRadius: 8,
        textAlign: 'center'
      }}
    >
      <span className="text-[11px] tabular-nums text-fg-muted">{label}</span>
    </span>
  )
}

interface RateLimitGaugeProps {
  label: { text: string; isWarning: boolean }
  window: RateLimitWindow
}

/**
 * RateLimitGauge — single rate limit pill with a progress bar fill behind the text.
 */
function RateLimitGauge({ label, window: rlWindow }: RateLimitGaugeProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, rlWindow.usedPercentage))
  const fillColor = rateLimitFillColor(pct)
  const borderColor = label.isWarning ? RATE_LIMIT_WARNING_COLOR : GAUGE_BORDER_COLOR
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        boxSizing: 'border-box',
        width: GAUGE_WIDTH_PX,
        padding: '1px 0',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        overflow: 'hidden',
        textAlign: 'center'
      }}
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
        style={{ zIndex: 1, color: RATE_LIMIT_TEXT_VAR }}
      >
        {label.text}
      </span>
    </span>
  )
}
