import React from 'react'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** When true, card reacts to hover with a subtle fill-step lift. */
  interactive?: boolean
  /** Stronger border + filled treatment. */
  elevated?: boolean
}

/**
 * Card — rounded panel, §10.11.
 *
 * Default: --color-bg-surface fill, --radius-lg, 16px padding, no shadow.
 * Interactive variant: hover fills with --color-bg-raised and brightens
 * the first child heading slightly with a warm tint.
 */
export function Card({
  interactive = false,
  elevated = false,
  className = '',
  children,
  ...rest
}: CardProps): React.JSX.Element {
  return (
    <div
      {...rest}
      className={`
        rounded-lg p-4
        ${elevated ? 'bg-raised border border-subtle' : 'bg-surface'}
        ${interactive ? 'transition-colors duration-fast ease-out hover:bg-raised cursor-pointer' : ''}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {children}
    </div>
  )
}
