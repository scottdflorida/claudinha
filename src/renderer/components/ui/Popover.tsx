import React, { useCallback, useEffect, useRef, useState } from 'react'

export type PopoverPlacement =
  | 'top-start' | 'top-end'
  | 'bottom-start' | 'bottom-end'
  | 'left-start' | 'right-start'

interface PopoverProps {
  /** Ref to the anchor element the popover is positioned relative to. */
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  placement?: PopoverPlacement
  /** px gap between anchor and popover. */
  offset?: number
  /** Pass-through className to the outer popover card. */
  className?: string
  children: React.ReactNode
}

/**
 * Popover — generic floating layer anchored to a trigger element, §10.6.
 *
 * Handles positioning via getBoundingClientRect, click-outside, and
 * Escape to close. Rendered with the same shape as menus (raised fill,
 * subtle border, shadow-md). Children own their internal keyboard nav.
 */
export function Popover({
  anchorRef,
  open,
  onClose,
  placement = 'bottom-start',
  offset = 6,
  className = '',
  children
}: PopoverProps): React.JSX.Element | null {
  const popRef = useRef<HTMLDivElement | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const position = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let top = 0, left = 0
    switch (placement) {
      case 'top-start':    top = r.top - offset;    left = r.left;  break
      case 'top-end':      top = r.top - offset;    left = r.right; break
      case 'bottom-start': top = r.bottom + offset; left = r.left;  break
      case 'bottom-end':   top = r.bottom + offset; left = r.right; break
      case 'left-start':   top = r.top;             left = r.left - offset; break
      case 'right-start':  top = r.top;             left = r.right + offset; break
    }
    setCoords({ top, left })
  }, [anchorRef, placement, offset])

  useEffect(() => {
    if (!open) { setCoords(null); return }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open, position])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      const pop = popRef.current
      const anch = anchorRef.current
      if (!pop) return
      const target = e.target as Node
      if (pop.contains(target)) return
      if (anch && anch.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open || !coords) return null

  const translate: Record<PopoverPlacement, string> = {
    'top-start':    'translate(0, -100%)',
    'top-end':      'translate(-100%, -100%)',
    'bottom-start': 'translate(0, 0)',
    'bottom-end':   'translate(-100%, 0)',
    'left-start':   'translate(-100%, 0)',
    'right-start':  'translate(0, 0)'
  }

  return (
    <div
      ref={popRef}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        transform: translate[placement],
        zIndex: 30
      }}
      className={`rounded-lg bg-raised border border-subtle shadow-md p-1 ${className}`}
    >
      {children}
    </div>
  )
}
