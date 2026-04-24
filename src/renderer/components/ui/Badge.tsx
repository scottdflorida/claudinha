import React from 'react'

type BadgeVariant = 'new' | 'beta' | 'trending' | 'interactive' | 'count' | 'neutral'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  new:         'uppercase tracking-wider bg-accent-subtle text-accent',
  beta:        'uppercase tracking-wider bg-overlay text-fg-muted',
  trending:    'bg-surface text-brand',
  interactive: 'bg-transparent text-fg-muted',
  count:       'bg-accent text-fg-on-accent rounded-full w-[18px] h-[18px] inline-flex items-center justify-center p-0 text-[10px]',
  neutral:     'bg-overlay text-fg-secondary'
}

/**
 * Badge — small chip, §10.15.
 *
 * Variants: new/beta (uppercase, tight tracking), trending (warm brand
 * text on surface), interactive (dot + label, muted), count (18px
 * filled circle), neutral (catch-all).
 */
export function Badge({
  variant = 'neutral',
  className = '',
  children,
  ...rest
}: BadgeProps): React.JSX.Element {
  if (variant === 'count') {
    return (
      <span
        {...rest}
        className={`${VARIANT_CLASSES.count} ${className}`.trim()}
      >
        {children}
      </span>
    )
  }
  return (
    <span
      {...rest}
      className={`
        inline-flex items-center gap-1 rounded-full text-micro font-[500] px-2 py-0.5
        ${VARIANT_CLASSES[variant]}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {variant === 'interactive' && <span className="w-1 h-1 rounded-full bg-fg-muted" />}
      {children}
    </span>
  )
}
