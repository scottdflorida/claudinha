// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Row } from '../../src/renderer/components/ui/Row'

describe('Row', () => {
  it('renders label and optional meta', () => {
    const { getByText } = render(<Row label="Session one" meta="5d ago" />)
    expect(getByText('Session one')).toBeTruthy()
    expect(getByText('5d ago')).toBeTruthy()
  })

  it('renders a status dot when requested', () => {
    const { container } = render(<Row label="x" statusDot="done" />)
    expect(container.querySelector('.bg-\\[var\\(--color-status-done\\)\\]')).toBeTruthy()
  })

  it('applies the selected treatment (left accent border)', () => {
    const { container } = render(<Row label="x" selected />)
    const btn = container.querySelector('button')!
    expect(btn.className).toMatch(/border-accent/)
    expect(btn.className).toMatch(/bg-surface/)
  })

  it('fires the onClick handler', () => {
    const onClick = vi.fn()
    const { getByRole } = render(<Row label="x" onClick={onClick} />)
    fireEvent.click(getByRole('button'))
    expect(onClick).toHaveBeenCalled()
  })

  it('hides the chevron when chevron=false', () => {
    const { container } = render(<Row label="x" chevron={false} />)
    expect(container.querySelector('svg')).toBeNull()
  })
})
