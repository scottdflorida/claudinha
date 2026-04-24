import React from 'react'

// ---------------------------------------------------------------------------
// SegmentedControl
// ---------------------------------------------------------------------------

interface SegmentOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  label?: string
  size?: 'sm' | 'md'
  className?: string
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className = ''
}: SegmentedControlProps<T>): React.JSX.Element {
  // min-h (rather than fixed h) lets the control grow vertically when an
  // option label wraps to two lines — important for languages where the
  // same concept needs more characters than its English equivalent (e.g.
  // pt-BR "Todos os terminais no mesmo repo" vs "All Terminals in Same
  // Repo"). Buttons keep equal flex basis so they share row width evenly,
  // and the active pill background grows with the wrapped text.
  const minHeightClass = size === 'sm' ? 'min-h-7' : 'min-h-8'
  const textClass = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <span className="text-sm font-[500] text-fg-primary">{label}</span>
      )}
      <div className={`flex items-stretch rounded-md border border-[var(--color-border-subtle)] bg-sunken p-[2px] gap-[2px] ${minHeightClass}`}>
        {options.map((opt) => {
          const isActive = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => !opt.disabled && onChange(opt.value)}
              disabled={opt.disabled}
              className={`ui-btn inline-flex items-center justify-center text-center leading-tight px-3 py-1 rounded-sm transition-colors duration-[80ms] flex-1 basis-0 min-w-0 ${textClass}
                ${isActive
                  ? 'bg-raised text-fg-primary font-[600] shadow-sm'
                  : 'bg-transparent text-fg-muted font-[500] hover:bg-border-subtle hover:text-fg-primary'
                }
                ${opt.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              `}
              aria-pressed={isActive}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
