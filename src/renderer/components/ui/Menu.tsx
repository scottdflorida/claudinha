import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Popover, type PopoverPlacement } from './Popover'

export type MenuItem =
  | {
      kind: 'item'
      /** Unique key for the item (used for keyboard focus + React key). */
      id: string
      label: React.ReactNode
      icon?: React.ReactNode
      /** Shown on the right side of the row — check, shortcut hint, submenu caret. */
      trailing?: React.ReactNode
      disabled?: boolean
      onClick?: () => void
    }
  | {
      kind: 'separator'
      id: string
    }
  | {
      kind: 'header'
      id: string
      label: React.ReactNode
    }

interface MenuProps {
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  items: MenuItem[]
  placement?: PopoverPlacement
  /** Accessible label describing what this menu controls. */
  'aria-label'?: string
  /** Width override in px; otherwise the menu sizes to content. */
  minWidth?: number
}

/**
 * Menu — keyboard-navigable list inside a Popover, §10.6.
 *
 * Arrow keys move focus across selectable items (skipping separators +
 * headers). Enter activates; Escape closes. Hover highlights use an
 * accent-tinted background.
 */
export function Menu({
  anchorRef,
  open,
  onClose,
  items,
  placement = 'bottom-start',
  minWidth,
  ...aria
}: MenuProps): React.JSX.Element {
  const selectable = items
    .map((item, idx) => (item.kind === 'item' && !item.disabled ? idx : -1))
    .filter((i) => i >= 0)
  const [focusIdx, setFocusIdx] = useState<number>(selectable[0] ?? 0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open && selectable.length > 0) setFocusIdx(selectable[0])
  }, [open, items])  // eslint-disable-line react-hooks/exhaustive-deps

  const move = useCallback((dir: 1 | -1) => {
    const pos = selectable.indexOf(focusIdx)
    const next = pos < 0
      ? selectable[0]
      : selectable[(pos + dir + selectable.length) % selectable.length]
    setFocusIdx(next)
  }, [focusIdx, selectable])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[focusIdx]
        if (item?.kind === 'item' && !item.disabled) {
          item.onClick?.()
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, focusIdx, items, move, onClose])

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} placement={placement}>
      <div
        ref={containerRef}
        role="menu"
        aria-label={aria['aria-label']}
        style={minWidth ? { minWidth } : undefined}
      >
        {items.map((item, idx) => {
          if (item.kind === 'separator') {
            return <div key={item.id} className="my-1 h-px bg-border-subtle" role="separator" />
          }
          if (item.kind === 'header') {
            return (
              <div key={item.id} className="px-3 py-1 text-xs font-[500] text-fg-muted uppercase tracking-wider">
                {item.label}
              </div>
            )
          }
          const focused = idx === focusIdx
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onMouseEnter={() => setFocusIdx(idx)}
              onClick={() => {
                if (item.disabled) return
                item.onClick?.()
                onClose()
              }}
              className={`
                w-full flex items-center gap-2.5 h-8 px-3 rounded-md text-left text-sm
                ${item.disabled ? 'text-fg-subtle cursor-not-allowed' : 'text-fg-primary cursor-pointer'}
                ${focused && !item.disabled ? 'bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)]' : ''}
                focus-visible:outline-none
              `.trim().replace(/\s+/g, ' ')}
            >
              {item.icon && <span className="inline-flex items-center shrink-0">{item.icon}</span>}
              <span className="flex-1 truncate">{item.label}</span>
              {item.trailing && <span className="inline-flex items-center shrink-0 text-fg-muted">{item.trailing}</span>}
            </button>
          )
        })}
      </div>
    </Popover>
  )
}
