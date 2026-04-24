import React from 'react'

interface ProgressBarProps {
  /** Value clamped to [0, max]. */
  value: number
  /** Max value (default 100 for percentages). */
  max?: number
  /** Bar height in px (8 default for usage rows, 4 for inline rate-limit bars). */
  size?: 4 | 6 | 8
  /** Accessible label describing what this bar represents. */
  label?: string
  className?: string
}

/**
 * ProgressBar — §10.14.
 *
 * Track: --color-bg-overlay. Fill: --color-accent. Fully rounded ends.
 * Used for usage limits (8px), rate-limit bars (4px), and the onboarding
 * checklist spinner scaffold.
 */
export function ProgressBar({
  value,
  max = 100,
  size = 8,
  label,
  className = ''
}: ProgressBarProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(max, value))
  const pct = max > 0 ? (clamped / max) * 100 : 0
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={`w-full rounded-full bg-overlay overflow-hidden ${className}`}
      style={{ height: size }}
    >
      <div
        className="h-full bg-accent rounded-full transition-[width] duration-base ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
