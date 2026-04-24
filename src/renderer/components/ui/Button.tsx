import React from 'react'

// ---------------------------------------------------------------------------
// Button — §10.1 / §10.2 / §10.3
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'brand' | 'icon'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  destructive?: boolean
  icon?: React.ReactNode
  trailingIcon?: React.ReactNode
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-7 px-3 text-xs',
  md: 'h-8 px-4 text-sm',
  lg: 'h-9 px-5 text-sm'
}

const ICON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-6 w-6',
  md: 'h-7 w-7',
  lg: 'h-8 w-8'
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Functional primary (blue) — used for interactive-emphasis actions
  primary:   'bg-accent text-fg-on-accent hover:bg-accent-hover active:bg-accent-active border border-transparent',
  secondary: 'bg-raised text-fg-primary hover:bg-overlay border border-subtle',
  ghost:     'bg-transparent text-fg-secondary hover:bg-raised hover:text-fg-primary border border-transparent',
  // Identity-forward CTA (warm cream) — "New workspace", "New terminal"
  brand:     'bg-brand-soft text-brand-soft-fg hover:bg-[color-mix(in_oklch,var(--color-brand-soft)_92%,white)] active:bg-[color-mix(in_oklch,var(--color-brand-soft)_85%,black)] border border-transparent',
  // Icon-only — square tap target, no text
  icon:      'bg-transparent text-fg-muted hover:bg-raised hover:text-fg-primary border border-transparent'
}

const DESTRUCTIVE_CLASSES: Record<ButtonVariant, string> = {
  primary:   'bg-danger-fg text-white hover:opacity-90 active:opacity-80 border border-transparent',
  secondary: 'bg-transparent text-danger-fg border border-danger-fg hover:bg-danger-fg hover:text-white',
  ghost:     'bg-transparent text-danger-fg border border-transparent hover:bg-danger-fg hover:text-white',
  brand:     'bg-danger-fg text-white hover:opacity-90 active:opacity-80 border border-transparent',
  icon:      'bg-transparent text-danger-fg hover:bg-danger-subtle-bg border border-transparent'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  destructive = false,
  icon,
  trailingIcon,
  className = '',
  children,
  disabled,
  ...props
}: ButtonProps): React.JSX.Element {
  const variantClass = destructive ? DESTRUCTIVE_CLASSES[variant] : VARIANT_CLASSES[variant]
  const sizeClass = variant === 'icon' ? ICON_SIZE_CLASSES[size] : SIZE_CLASSES[size]
  const shapeClass = variant === 'icon' ? 'rounded-md' : 'rounded'
  return (
    <button
      {...props}
      disabled={disabled}
      className={`ui-btn inline-flex items-center justify-center gap-1.5 ${shapeClass} font-[500] transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none flex-shrink-0
        ${sizeClass}
        ${variantClass}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${className}`}
    >
      {icon}
      {children}
      {trailingIcon}
    </button>
  )
}
