import React from 'react'

interface InfoCalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
}

/**
 * InfoCallout — §10.16.
 *
 * Soft banner used at the top of settings pages and other context-
 * setting surfaces. Background = --color-info-subtle-bg, text =
 * --color-fg-secondary, leading info-dot in --color-info-fg.
 */
export function InfoCallout({
  icon,
  className = '',
  children,
  ...rest
}: InfoCalloutProps): React.JSX.Element {
  const defaultIcon = (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="5.5" />
      <path d="M7 9.5v-3" strokeLinecap="round" />
      <circle cx="7" cy="4.6" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  )
  return (
    <div
      {...rest}
      role="note"
      className={`
        flex items-start gap-2 rounded-lg bg-info-subtle-bg px-3 py-2 text-xs text-fg-secondary
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      <span className="mt-[1px] text-info-fg shrink-0 inline-flex">{icon ?? defaultIcon}</span>
      <div className="leading-[1.45]">{children}</div>
    </div>
  )
}
