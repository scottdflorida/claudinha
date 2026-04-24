import React, { useRef, useState } from 'react'
import { Menu, type MenuItem } from './Menu'

interface SelectOption<T extends string> {
  value: T
  label: React.ReactNode
  /** Optional secondary text shown beneath the label inside the menu. */
  description?: React.ReactNode
  /** Shown at the right of the button when selected. */
  icon?: React.ReactNode
}

interface SelectProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: SelectOption<T>[]
  placeholder?: React.ReactNode
  disabled?: boolean
  /** Accessible label for the trigger. */
  'aria-label'?: string
  className?: string
}

/**
 * Select — input-styled trigger that opens a Menu, §10.10.
 *
 * Wraps Menu with a button trigger matching the text-input shape.
 * Selected option shows with a ✓ in the menu.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  className = '',
  ...aria
}: SelectProps<T>): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  const items: MenuItem[] = options.map((opt) => ({
    kind: 'item' as const,
    id: String(opt.value),
    label: (
      <div className="flex flex-col gap-0.5">
        <span>{opt.label}</span>
        {opt.description && <span className="text-xs text-fg-muted">{opt.description}</span>}
      </div>
    ),
    icon: opt.icon,
    trailing: opt.value === value ? (
      <svg width="14" height="14" viewBox="0 0 14 14" className="text-accent">
        <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ) : null,
    onClick: () => onChange(opt.value)
  }))

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={aria['aria-label']}
        className={`
          inline-flex items-center justify-between gap-2 min-w-[120px] h-8 px-2.5 rounded-md
          bg-surface text-sm text-fg-primary
          border border-subtle transition-colors duration-fast ease-out
          hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring
          ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
          ${className}
        `.trim().replace(/\s+/g, ' ')}
      >
        <span className="truncate">
          {current ? current.label : (placeholder ?? '—')}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" className="text-fg-muted shrink-0">
          <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <Menu
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        placement="bottom-start"
        minWidth={Math.max(triggerRef.current?.offsetWidth ?? 160, 160)}
      />
    </>
  )
}
