import React from 'react'
import { BrandMark } from './BrandMark'

interface ViewModePreviewProps {
  variant: 'kanban' | 'wall'
  selected: boolean
  onClick: () => void
  className?: string
}

/**
 * Tiny window illustration that schematically shows the Kanban or Wall
 * layout. Rendered below the View mode SegmentedControl as a secondary
 * click target — clicking selects the same view mode the segmented
 * control controls. Uses <BrandMark/> as the critter glyph inside each
 * terminal region.
 */
export function ViewModePreview({
  variant,
  selected,
  onClick,
  className = ''
}: ViewModePreviewProps): React.JSX.Element {
  const label = variant === 'kanban' ? 'Kanban layout preview' : 'Wall layout preview'

  const base =
    'ui-btn group flex-1 h-[90px] rounded-md border bg-sunken shadow-sm transition-all duration-[120ms] cursor-pointer p-2 flex items-center justify-center'
  const hover = 'hover:bg-raised hover:shadow-md'
  const selectedCls = selected
    ? 'border-[color-mix(in_oklab,var(--color-brand)_60%,transparent)] bg-raised shadow-md'
    : 'border-[var(--color-border-subtle)]'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      className={`${base} ${hover} ${selectedCls} ${className}`}
    >
      {variant === 'kanban' ? <KanbanWindow /> : <WallWindow />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Internal window illustrations
//
// Both previews omit the title bar / traffic-light dots by request — the
// outer rounded rectangle IS the window. Thin dividers use the same
// border-subtle token as the SegmentedControl itself.
// ---------------------------------------------------------------------------

function KanbanWindow(): React.JSX.Element {
  return (
    <div
      className="relative w-full h-full rounded-sm border border-[var(--color-border-subtle)] overflow-hidden bg-transparent"
      aria-hidden="true"
    >
      {/* Top pane: 5 columns */}
      <div className="absolute inset-x-0 top-0 h-[22%] flex border-b border-[var(--color-border-subtle)]">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`flex-1 ${i < 4 ? 'border-r border-[var(--color-border-subtle)]' : ''}`}
          />
        ))}
      </div>
      {/* Middle row: left sidebar + terminal pane */}
      <div className="absolute inset-x-0 top-[22%] bottom-0 flex">
        <div className="w-[22%] border-r border-[var(--color-border-subtle)]" />
        <div className="flex-1 flex items-center justify-center">
          <BrandMark size={18} />
        </div>
      </div>
    </div>
  )
}

function WallWindow(): React.JSX.Element {
  return (
    <div
      className="relative w-full h-full rounded-sm border border-[var(--color-border-subtle)] overflow-hidden bg-transparent grid grid-cols-3 grid-rows-3"
      aria-hidden="true"
    >
      {Array.from({ length: 9 }).map((_, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const borderRight = col < 2 ? 'border-r border-[var(--color-border-subtle)]' : ''
        const borderBottom = row < 2 ? 'border-b border-[var(--color-border-subtle)]' : ''
        return (
          <div key={i} className={`flex items-center justify-center ${borderRight} ${borderBottom}`}>
            <BrandMark size={12} />
          </div>
        )
      })}
    </div>
  )
}
