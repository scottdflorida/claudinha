import React from 'react'

interface RowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  leading?: React.ReactNode
  label: React.ReactNode
  meta?: React.ReactNode
  /** Trailing chevron glyph when the row opens something; set to false to hide. */
  chevron?: boolean
  selected?: boolean
  /** Colored 6px status dot shown before the leading slot. */
  statusDot?: 'done' | 'needs-input' | 'working' | 'muted' | 'success' | null
}

/**
 * Row — dense list item, §10.12.
 *
 * Single-line affordance used for sidebar entries, paused-terminal lists,
 * session lists, and left-rail settings navigation. Status dot optional.
 * Selected state gets a 2px left accent border.
 */
export function Row({
  leading,
  label,
  meta,
  chevron = true,
  selected = false,
  statusDot = null,
  className = '',
  ...rest
}: RowProps): React.JSX.Element {
  const dotClass =
    statusDot === 'done'         ? 'bg-[var(--color-status-done)]' :
    statusDot === 'needs-input'  ? 'bg-[var(--color-status-needs-input)]' :
    statusDot === 'working'      ? 'bg-[var(--color-status-working)]' :
    statusDot === 'success'      ? 'bg-success-fg' :
    statusDot === 'muted'        ? 'bg-fg-subtle' : ''

  return (
    <button
      type="button"
      {...rest}
      className={`
        group w-full flex items-center gap-2 h-8 px-2 rounded-md
        text-left text-sm font-[500] text-fg-primary
        transition-colors duration-fast ease-out
        hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0
        ${selected ? 'border-l-2 border-accent bg-surface pl-[6px]' : 'border-l-2 border-transparent'}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {statusDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />}
      {leading && <span className="shrink-0 inline-flex items-center text-fg-muted">{leading}</span>}
      <span className="flex-1 truncate">{label}</span>
      {meta && <span className="text-xs text-fg-muted shrink-0">{meta}</span>}
      {chevron && (
        <svg width="14" height="14" viewBox="0 0 14 14" className="text-fg-subtle shrink-0">
          <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
