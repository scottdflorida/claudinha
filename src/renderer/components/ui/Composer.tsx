import React, { useCallback, useRef, useState } from 'react'

interface ComposerProps {
  /** Controlled value. */
  value: string
  onChange: (v: string) => void
  /** Fired on Enter (without Shift). */
  onSubmit?: (v: string) => void
  placeholder?: string
  /** Rendered to the left of the textarea (e.g. + button, attach). */
  leading?: React.ReactNode
  /** Rendered to the right of the controls row (model selector, submit, mic). */
  trailing?: React.ReactNode
  /** Extra controls below the textarea, flanking leading/trailing (e.g. chip pills). */
  rowExtras?: React.ReactNode
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  /** Min height of the textarea in px. Default 48. */
  minHeight?: number
  /** Max height before it starts scrolling. Default 240. */
  maxHeight?: number
}

/**
 * Composer — rounded input card, §10.5 / §9.3-A.
 *
 * Card: rounded-xl, bg-surface, subtle border, 16px padding. Interior:
 * row 1 is the auto-growing textarea, row 2 is the controls row with
 * leading slot on the left and trailing slot on the right.
 *
 * Enter submits; Shift+Enter inserts a newline. Focus-within brightens
 * the border from subtle → strong.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder = 'Describe a task or ask a question',
  leading,
  trailing,
  rowExtras,
  disabled = false,
  autoFocus = false,
  className = '',
  minHeight = 48,
  maxHeight = 240
}: ComposerProps): React.JSX.Element {
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const [focused, setFocused] = useState(false)

  const autosize = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const next = Math.max(minHeight, Math.min(maxHeight, ta.scrollHeight))
    ta.style.height = `${next}px`
  }, [minHeight, maxHeight])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!disabled && value.trim().length > 0) onSubmit?.(value)
    }
  }

  return (
    <div
      className={`
        w-full rounded-xl bg-surface
        border transition-colors duration-fast ease-out
        ${focused ? 'border-strong' : 'border-subtle'}
        ${disabled ? 'opacity-60' : ''}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      <div className="px-4 pt-4">
        <textarea
          ref={taRef}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => { onChange(e.target.value); autosize() }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          rows={1}
          className="
            w-full resize-none bg-transparent outline-none
            text-md text-fg-primary placeholder:text-fg-muted
            font-[450] leading-[1.45]
          "
          style={{ minHeight, maxHeight }}
        />
      </div>
      <div className="flex items-center gap-2 px-3 pb-3 pt-1 min-h-7">
        <div className="flex items-center gap-1.5">{leading}</div>
        {rowExtras && <div className="flex items-center gap-1.5 ml-1">{rowExtras}</div>}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">{trailing}</div>
      </div>
    </div>
  )
}
