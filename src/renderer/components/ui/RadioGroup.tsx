import React, { useId } from 'react'
import { Circle, CircleDot } from 'lucide-react'

// ---------------------------------------------------------------------------
// RadioGroup
// ---------------------------------------------------------------------------

interface RadioOption<T extends string> {
  value: T
  label: string
  description?: string
  disabled?: boolean
}

interface RadioGroupProps<T extends string> {
  options: RadioOption<T>[]
  value: T
  onChange: (value: T) => void
  label?: string
  className?: string
}

export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  className = ''
}: RadioGroupProps<T>): React.JSX.Element {
  const groupId = useId()

  return (
    <div className={`flex flex-col gap-1 ${className}`} role="radiogroup">
      {label && (
        <span className="text-sm font-[500] text-fg-primary mb-1">{label}</span>
      )}
      {options.map((opt) => {
        const isSelected = opt.value === value
        return (
          <label
            key={opt.value}
            htmlFor={`${groupId}-${opt.value}`}
            className={`flex items-start gap-2.5 h-7 cursor-pointer group ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              id={`${groupId}-${opt.value}`}
              name={groupId}
              value={opt.value}
              checked={isSelected}
              onChange={() => !opt.disabled && onChange(opt.value)}
              disabled={opt.disabled}
              className="sr-only"
            />
            <span className="flex-shrink-0 mt-px">
              {isSelected
                ? <CircleDot size={16} className="text-accent" />
                : <Circle size={16} className="text-fg-muted group-hover:text-fg-secondary transition-colors duration-[80ms]" />
              }
            </span>
            <span className={`text-sm ${isSelected ? 'text-fg-primary font-[500]' : 'text-fg-secondary'} transition-colors duration-[80ms]`}>
              {opt.label}
              {opt.description && (
                <span className="block text-xs text-fg-muted mt-0.5">{opt.description}</span>
              )}
            </span>
          </label>
        )
      })}
    </div>
  )
}
