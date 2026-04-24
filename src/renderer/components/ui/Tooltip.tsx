import React, { useEffect, useId, useRef, useState } from 'react'

type Placement = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  /** Tooltip body; typically short text. */
  content: React.ReactNode
  /** Element the tooltip attaches to. Must accept ref + event handlers. */
  children: React.ReactElement
  placement?: Placement
  /** Open delay in ms (default 500). */
  openDelay?: number
  /** Close delay in ms (default 100). */
  closeDelay?: number
  /** Max width of the tooltip in px. */
  maxWidth?: number
}

/**
 * Tooltip — compact floating hint, §10.7.
 *
 * Fires on hover (with delay) and focus. Keyboard-accessible:
 * focus opens immediately, blur closes. No arrow. Warm surface.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  openDelay = 500,
  closeDelay = 100,
  maxWidth = 240
}: TooltipProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  const clear = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const openAfter = (delay: number): void => {
    clear()
    timerRef.current = setTimeout(() => setOpen(true), delay)
  }

  const closeAfter = (delay: number): void => {
    clear()
    timerRef.current = setTimeout(() => setOpen(false), delay)
  }

  useEffect(() => {
    if (!open || !anchorRef.current) {
      setCoords(null)
      return
    }
    const rect = anchorRef.current.getBoundingClientRect()
    const gap = 6
    let top = 0
    let left = 0
    if (placement === 'top') {
      top = rect.top - gap
      left = rect.left + rect.width / 2
    } else if (placement === 'bottom') {
      top = rect.bottom + gap
      left = rect.left + rect.width / 2
    } else if (placement === 'left') {
      top = rect.top + rect.height / 2
      left = rect.left - gap
    } else {
      top = rect.top + rect.height / 2
      left = rect.right + gap
    }
    setCoords({ top, left })
  }, [open, placement])

  useEffect(() => () => clear(), [])

  const setRef = (el: HTMLElement | null): void => {
    anchorRef.current = el
    const refProp = (children as unknown as { ref?: unknown }).ref
    if (typeof refProp === 'function') refProp(el)
    else if (refProp && typeof refProp === 'object') (refProp as { current: HTMLElement | null }).current = el
  }

  const anchor = React.cloneElement(children, {
    ref: setRef,
    onMouseEnter: (e: React.MouseEvent) => {
      openAfter(openDelay)
      const handler = (children.props as { onMouseEnter?: (e: React.MouseEvent) => void }).onMouseEnter
      handler?.(e)
    },
    onMouseLeave: (e: React.MouseEvent) => {
      closeAfter(closeDelay)
      const handler = (children.props as { onMouseLeave?: (e: React.MouseEvent) => void }).onMouseLeave
      handler?.(e)
    },
    onFocus: (e: React.FocusEvent) => {
      setOpen(true)
      const handler = (children.props as { onFocus?: (e: React.FocusEvent) => void }).onFocus
      handler?.(e)
    },
    onBlur: (e: React.FocusEvent) => {
      setOpen(false)
      const handler = (children.props as { onBlur?: (e: React.FocusEvent) => void }).onBlur
      handler?.(e)
    },
    'aria-describedby': open ? id : undefined
  } as React.HTMLAttributes<HTMLElement> & { ref?: unknown })

  const translate: Record<Placement, string> = {
    top:    'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left:   'translate(-100%, -50%)',
    right:  'translate(0, -50%)'
  }

  return (
    <>
      {anchor}
      {open && coords && (
        <div
          id={id}
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            transform: translate[placement],
            maxWidth,
            zIndex: 'var(--z-popover, 30)' as unknown as number
          }}
          className="pointer-events-none rounded-md bg-overlay text-fg-primary text-xs px-2 py-1 shadow-md"
        >
          {content}
        </div>
      )}
    </>
  )
}
