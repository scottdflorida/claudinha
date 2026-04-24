import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Model } from '../../shared/types'

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

interface MenuItem {
  id: Model
  label: string
}

const CHOICES: MenuItem[] = [
  { id: 'opus', label: 'Opus 4.7' },
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'haiku', label: 'Haiku 4.5' }
]

// ---------------------------------------------------------------------------
// ModelPopover
// ---------------------------------------------------------------------------

interface ModelPopoverProps {
  isOpen: boolean
  onClose: () => void
  /** The pane's currently selected model. */
  model: Model
  /**
   * Called when the user picks a model. The parent fires the PANE_MODEL IPC
   * and sends a `/model <name>` slash command to the live PTY so the running
   * Claude session switches in place.
   */
  onSelect: (model: Model) => void
}

/**
 * ModelPopover — per-pane Claude model picker.
 *
 * Arrow-key nav, Enter to apply, Esc to close, click-outside to dismiss.
 * Selecting a model fires onSelect and closes the popover.
 */
export function ModelPopover({
  isOpen,
  onClose,
  model,
  onSelect
}: ModelPopoverProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    if (isOpen) {
      const idx = CHOICES.findIndex((c) => c.id === model)
      setSelectedIndex(idx >= 0 ? idx : 0)
    }
  }, [isOpen, model])

  const handleSelect = useCallback(
    (m: Model) => {
      onSelect(m)
      onClose()
    },
    [onSelect, onClose]
  )

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        setSelectedIndex((i) => (i + dir + CHOICES.length) % CHOICES.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const choice = CHOICES[selectedIndex]
        if (choice) handleSelect(choice.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, selectedIndex, onClose, handleSelect])

  // Click-outside close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={containerRef}
      className="absolute z-popover right-0 mt-1 min-w-[160px] border border-subtle rounded-md shadow-md py-1"
      style={{ top: '100%', backgroundColor: 'var(--color-bg-overlay)' }}
    >
      <div className="px-3 py-1 text-xs font-[500] text-fg-muted uppercase tracking-wide">
        Model
      </div>
      {CHOICES.map((choice, i) => {
        const isActive = choice.id === model
        const isHighlighted = i === selectedIndex
        return (
          <button
            key={choice.id}
            type="button"
            onClick={() => handleSelect(choice.id)}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`ui-btn w-full text-left px-3 h-7 text-sm flex items-center gap-2 transition-colors duration-[80ms]
              ${isHighlighted
                ? 'bg-raised text-fg-primary'
                : 'text-fg-secondary hover:bg-raised hover:text-fg-primary'
              }`}
          >
            <span className={`flex-1 ${isActive ? 'font-[500]' : ''}`}>{choice.label}</span>
            {isActive && <span className="text-xs text-accent">active</span>}
          </button>
        )
      })}
    </div>
  )
}
