// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Toggle } from '../../src/renderer/components/ui/Toggle'

describe('Toggle', () => {
  it('renders as a switch with aria-checked reflecting state', () => {
    const { getByRole, rerender } = render(<Toggle checked={false} onChange={() => {}} />)
    const sw = getByRole('switch')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    rerender(<Toggle checked={true} onChange={() => {}} />)
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('fires onChange with the inverted value on click', () => {
    const onChange = vi.fn()
    const { getByRole } = render(<Toggle checked={false} onChange={onChange} />)
    fireEvent.click(getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('toggles on Space and Enter when focused', () => {
    const onChange = vi.fn()
    const { getByRole } = render(<Toggle checked={true} onChange={onChange} />)
    const sw = getByRole('switch')
    fireEvent.keyDown(sw, { key: ' ' })
    expect(onChange).toHaveBeenLastCalledWith(false)
    fireEvent.keyDown(sw, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn()
    const { getByRole } = render(<Toggle checked={false} disabled onChange={onChange} />)
    fireEvent.click(getByRole('switch'))
    fireEvent.keyDown(getByRole('switch'), { key: ' ' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies bg-accent on the track when checked', () => {
    const { getByRole, rerender } = render(<Toggle checked={false} onChange={() => {}} />)
    expect(getByRole('switch').className).toContain('bg-overlay')
    rerender(<Toggle checked={true} onChange={() => {}} />)
    expect(getByRole('switch').className).toContain('bg-accent')
  })
})
