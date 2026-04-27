import React from 'react'

interface ClaudinhaIconProps {
  size?: number
  strokeWidth?: number
  className?: string
}

/**
 * Outline-only Claudinha glyph drawn in the lucide-react style: 24×24 viewBox,
 * stroke="currentColor", fill="none", default strokeWidth 2. Composes inline
 * with neighbouring lucide icons (Search, Lock, Settings, Sprout) without
 * looking out of place. Eyes are filled dots so they remain legible at 12px;
 * a stroke-only circle vanishes at that size.
 */
export function ClaudinhaIcon({
  size = 24,
  strokeWidth = 2,
  className = ''
}: ClaudinhaIconProps): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Body — wider than tall, generously rounded */}
      <rect x="3" y="6" width="18" height="12" rx="5" ry="5" />
      {/* Feet — small stubs peeking from under the body */}
      <path d="M8 18v2.5" />
      <path d="M16 18v2.5" />
      {/* Eyes — filled dots so they read at small sizes */}
      <circle cx="9" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}
