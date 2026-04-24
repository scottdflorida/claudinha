import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EffortLevel, Model } from '../../shared/types'
import { EFFORT_ICONS } from '../lib/constants'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

interface MenuItem {
  id: EffortLevel
  label: string
}

// Labels resolved at render time via useStrings; values are stable IPC ids.
const ALL_CHOICE_IDS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

const OPUS_ONLY: EffortLevel[] = ['xhigh', 'max']

// ---------------------------------------------------------------------------
// EffortPopover
// ---------------------------------------------------------------------------

interface EffortPopoverProps {
  isOpen: boolean
  onClose: () => void
  currentEffort: EffortLevel
  onSelect: (effort: EffortLevel) => void
  /** If provided, gates xhigh/max to Opus only. Omit to show all levels. */
  model?: Model
}

/**
 * EffortPopover — global reasoning-effort picker for the workspace toolbar.
 *
 * Mirrors ModelPopover: arrow keys navigate, Enter applies, Esc closes,
 * click-outside dismisses. Selecting an effort closes the popover.
 */
export function EffortPopover({
  isOpen,
  onClose,
  currentEffort,
  onSelect,
  model
}: EffortPopoverProps): React.JSX.Element | null {
  const t = useStrings()
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const labelFor = (id: EffortLevel): string => {
    switch (id) {
      case 'low': return t.effortPopover.low
      case 'medium': return t.effortPopover.medium
      case 'high': return t.effortPopover.high
      case 'xhigh': return t.effortPopover.xhigh
      case 'max': return t.effortPopover.max
      default: return id
    }
  }

  const ALL_CHOICES: MenuItem[] = ALL_CHOICE_IDS.map((id) => ({ id, label: labelFor(id) }))

  const choices = useMemo<MenuItem[]>(() => {
    if (model === undefined || model === 'opus') return ALL_CHOICES
    return ALL_CHOICES.filter((c) => !OPUS_ONLY.includes(c.id))
  }, [model, t])

  useEffect(() => {
    if (isOpen) {
      const idx = choices.findIndex((c) => c.id === currentEffort)
      setSelectedIndex(idx >= 0 ? idx : 0)
    }
  }, [isOpen, currentEffort, choices])

  const handleSelect = useCallback(
    (level: EffortLevel) => {
      onSelect(level)
      onClose()
    },
    [onSelect, onClose]
  )

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        setSelectedIndex((i) => (i + dir + choices.length) % choices.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const choice = choices[selectedIndex]
        if (choice) handleSelect(choice.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, selectedIndex, onClose, handleSelect, choices])

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
        Effort
      </div>
      {choices.map((choice, i) => {
        const isActive = choice.id === currentEffort
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
            <span className="w-4 text-center tabular-nums" aria-hidden>{EFFORT_ICONS[choice.id]}</span>
            <span className={`flex-1 ${isActive ? 'font-[500]' : ''}`}>{choice.label}</span>
            {isActive && <span className="text-xs text-accent">active</span>}
          </button>
        )
      })}
    </div>
  )
}
