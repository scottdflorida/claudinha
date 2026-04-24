import React from 'react'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  id?: string
  className?: string
}

/**
 * Toggle — pill-switch control matching design-system §10.8.
 *
 * 32×18 track, 14px thumb with 2px inset. Off: overlay track + muted
 * thumb. On: accent (blue) track + primary-fg thumb. The thumb is
 * absolutely positioned so its geometry is deterministic — earlier
 * inline-flex + transform-on-inline-block caused the thumb to paint
 * outside the track on some browsers.
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  id,
  className = '',
  ...aria
}: ToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      id={id}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange(!checked)
        }
      }}
      className={`
        relative inline-block shrink-0 rounded-full p-0
        transition-colors duration-base ease-in-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas
        ${checked ? 'bg-accent' : 'bg-overlay'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
      style={{ width: 32, height: 18 }}
      {...aria}
    >
      <span
        aria-hidden
        className={`
          absolute rounded-full top-0.5
          transition-[left,background-color] duration-base ease-in-out
          ${checked ? 'bg-fg-primary' : 'bg-fg-muted'}
        `.trim().replace(/\s+/g, ' ')}
        style={{
          width: 14,
          height: 14,
          left: checked ? 16 : 2
        }}
      />
    </button>
  )
}
