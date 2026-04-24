import React from 'react'

interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  leading?: React.ReactNode
  /** Selected pills gain a subtle border while keeping the resting fill. */
  selected?: boolean
}

/**
 * Pill — rounded action chip, §10.4.
 *
 * Fully-rounded, 32px tall, surface fill → raised on hover. Used below
 * the composer for action chips (Write, Learn, Code…) and as toggle-
 * chips ("Local", "Select folder…") inside composer attachments.
 */
export function Pill({
  leading,
  selected = false,
  className = '',
  children,
  ...rest
}: PillProps): React.JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={`
        inline-flex items-center gap-2 h-8 px-3 rounded-full
        text-sm font-[500] text-fg-secondary
        bg-surface
        transition-colors duration-fast ease-out
        hover:bg-raised hover:text-fg-primary
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas
        ${selected ? 'border border-strong' : 'border border-transparent'}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {leading && <span className="inline-flex items-center">{leading}</span>}
      {children}
    </button>
  )
}
