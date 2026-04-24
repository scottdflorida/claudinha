import React, { useId } from 'react'
import { AlertCircle, X } from 'lucide-react'

// ---------------------------------------------------------------------------
// TextInput
// ---------------------------------------------------------------------------

// Accept every standard input attribute (spellCheck, autoCorrect,
// autoCapitalize, maxLength, etc.) so callers don't need the component to list
// them one by one. We omit `size` because TextInput repurposes that name for
// its visual size prop ('sm' | 'md' | 'lg').
interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  helperText?: string
  error?: string
  size?: 'sm' | 'md' | 'lg'
  /** Show a clear button when non-empty */
  clearable?: boolean
  onClear?: () => void
  /** Leading element (icon etc.) */
  leading?: React.ReactNode
  /** Trailing element */
  trailing?: React.ReactNode
  inputRef?: React.Ref<HTMLInputElement>
}

const HEIGHT: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-8',
  md: 'h-9',
  lg: 'h-10'
}

export function TextInput({
  label,
  helperText,
  error,
  size = 'md',
  clearable = false,
  onClear,
  leading,
  trailing,
  id: idProp,
  inputRef,
  className = '',
  ...inputProps
}: TextInputProps): React.JSX.Element {
  const generatedId = useId()
  const id = idProp ?? generatedId

  const hasError = Boolean(error)

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-sm font-[500] text-fg-primary">
          {label}
        </label>
      )}

      <div className={`relative flex items-center ${HEIGHT[size]} rounded-md border bg-surface px-2.5 gap-2 transition-colors duration-[120ms]
        ${hasError
          ? 'border-danger-fg focus-within:ring-2 focus-within:ring-danger-fg focus-within:outline-none'
          : 'border-subtle focus-within:border-accent focus-within:ring-2 focus-within:ring-focus-ring focus-within:outline-none'
        }
        ${inputProps.disabled ? 'opacity-40 cursor-not-allowed' : ''}
      `}>
        {leading && <span className="text-fg-muted flex-shrink-0">{leading}</span>}

        <input
          {...inputProps}
          id={id}
          ref={inputRef}
          className="flex-1 bg-transparent text-sm text-fg-primary placeholder-fg-muted outline-none min-w-0 h-full"
        />

        {clearable && inputProps.value && (
          <button
            type="button"
            onClick={onClear}
            className="ui-btn flex-shrink-0 text-fg-muted hover:text-fg-primary transition-colors duration-[80ms]"
            tabIndex={-1}
            aria-label="Clear"
          >
            <X size={14} />
          </button>
        )}

        {trailing && <span className="text-fg-muted flex-shrink-0">{trailing}</span>}
      </div>

      {(error || helperText) && (
        <div className={`flex items-center gap-1 text-xs ${hasError ? 'text-danger-fg' : 'text-fg-secondary'}`}>
          {hasError && <AlertCircle size={12} className="flex-shrink-0" />}
          <span>{error ?? helperText}</span>
        </div>
      )}
    </div>
  )
}
