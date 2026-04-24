import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

type DialogSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_MAX_WIDTH: Record<DialogSize, number> = {
  xs: 360, sm: 480, md: 560, lg: 720, xl: 900
}

interface DialogProps {
  title: string
  subtitle?: string
  size?: DialogSize
  /** Prevents Esc + backdrop dismiss (for blocking / destructive dialogs) */
  blocking?: boolean
  /** Hide the X close button (for blocking dialogs) */
  showClose?: boolean
  onClose?: () => void
  footer?: React.ReactNode
  /** Optional full-bleed strip rendered above the header — used by flows that
   *  need extra chrome (e.g., workspace close sequence banner). */
  banner?: React.ReactNode
  children: React.ReactNode
}

/**
 * Dialog — native <dialog> wrapper with panel chrome.
 *
 * Uses showModal() for built-in focus-trap and Esc handling.
 * Backdrop is styled via dialog::backdrop in globals.css.
 * Panel entrance: 300ms ease-out opacity + scale.
 */
export function Dialog({
  title,
  subtitle,
  size = 'sm',
  blocking = false,
  showClose = true,
  onClose,
  footer,
  banner,
  children
}: DialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    el.showModal()

    const handleCancel = (e: Event) => {
      e.preventDefault()
      if (!blocking) onClose?.()
    }
    el.addEventListener('cancel', handleCancel)
    return () => {
      el.removeEventListener('cancel', handleCancel)
      if (el.open) el.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (!blocking && e.target === e.currentTarget) onClose?.()
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className="fixed top-1/2 left-1/2 z-modal bg-raised border border-[var(--color-border-strong)] rounded-2xl shadow-lg p-0 m-0 overflow-hidden"
      style={{
        maxWidth: SIZE_MAX_WIDTH[size],
        width: '100%',
        transform: 'translate(-50%, -50%)',
        animation: 'dialog-enter 260ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards'
      }}
    >
      {banner && (
        <>
          <div className="px-6 py-3 bg-surface flex items-center gap-4">
            {banner}
          </div>
          <div className="h-px bg-border-subtle" />
        </>
      )}
      {/* Header */}
      <div className="flex items-start justify-between px-6 pt-6 pb-4">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h2 className="text-lg font-[600] text-fg-primary leading-tight">{title}</h2>
          {subtitle && (
            <p className="text-sm text-fg-secondary">{subtitle}</p>
          )}
        </div>
        {showClose && onClose && (
          <button
            onClick={onClose}
            className="ui-btn ml-4 mt-0.5 flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-fg-muted hover:bg-raised hover:text-fg-primary transition-colors duration-[80ms]"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-border-subtle mx-0" />

      {/* Body */}
      <div className="px-6 py-5 text-sm text-fg-secondary">
        {children}
      </div>

      {footer && (
        <>
          {/* Divider */}
          <div className="h-px bg-border-subtle" />
          {/* Footer */}
          <div className="px-6 py-4 flex items-center justify-between gap-3">
            {footer}
          </div>
        </>
      )}
    </dialog>
  )
}

// ---------------------------------------------------------------------------
// DialogFooter helpers
// ---------------------------------------------------------------------------

/** Slot for the Cancel / left action */
export function DialogCancel({ children, onClick }: { children: React.ReactNode; onClick?: () => void }): React.JSX.Element {
  return (
    <Button variant="ghost" onClick={onClick}>
      {children}
    </Button>
  )
}

/** Slot for the right-aligned primary action */
export function DialogActions({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex items-center gap-2 ml-auto">{children}</div>
}
