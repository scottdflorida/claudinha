import React from 'react'

interface BrandMarkProps {
  /** Square size in px. The figure is drawn in a fixed 100×100 viewBox and scales to fit. */
  size?: number
  /** Gentle blink at rest (landing hero only; disabled under prefers-reduced-motion). */
  blink?: boolean
  /** Override the body + feet fill. Defaults to var(--color-brand). Eyes stay constant. */
  color?: string
  className?: string
  title?: string
}

/**
 * Claudinha — the app's brand critter. Gold body + feet, deep-blue eyes, no
 * background. Same silhouette footprint as the earlier rectangular mark, so
 * existing call sites (HomeView, Hero, EmptyState, layout previews) render
 * without layout shift.
 */
export function BrandMark({
  size = 28,
  blink = false,
  color,
  className = '',
  title
}: BrandMarkProps): React.JSX.Element {
  const bodyFill = color ?? 'var(--color-brand)'
  const eyeFill = '#17328F'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title ?? 'Claudinha'}
      className={`inline-block flex-shrink-0 ${blink ? 'brand-mark-blink' : ''} ${className}`}
    >
      {/* Feet (drawn behind the body so only the lower stubs peek out) */}
      <rect x="26" y="78" width="14" height="14" rx="3" ry="3" fill={bodyFill} />
      <rect x="60" y="78" width="14" height="14" rx="3" ry="3" fill={bodyFill} />
      {/* Body — wider than tall */}
      <rect x="11" y="20" width="78" height="60" rx="20" ry="20" fill={bodyFill} />
      {/* Eyes */}
      <circle cx="35" cy="42" r="9" fill={eyeFill} />
      <circle cx="65" cy="42" r="9" fill={eyeFill} />
    </svg>
  )
}
