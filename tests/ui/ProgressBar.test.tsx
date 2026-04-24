// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ProgressBar } from '../../src/renderer/components/ui/ProgressBar'

describe('ProgressBar', () => {
  it('renders with aria-valuenow and the correct width percentage', () => {
    const { container, getByRole } = render(<ProgressBar value={42} />)
    const bar = getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    const fill = container.querySelector('.bg-accent') as HTMLElement
    expect(fill.style.width).toBe('42%')
  })

  it('clamps values over max', () => {
    const { getByRole, container } = render(<ProgressBar value={150} max={100} />)
    expect(getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    expect((container.querySelector('.bg-accent') as HTMLElement).style.width).toBe('100%')
  })

  it('clamps negative values to 0', () => {
    const { getByRole, container } = render(<ProgressBar value={-5} />)
    expect(getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    expect((container.querySelector('.bg-accent') as HTMLElement).style.width).toBe('0%')
  })

  it('supports non-default max + size', () => {
    const { getByRole } = render(<ProgressBar value={7} max={15} size={4} label="Routines" />)
    const bar = getByRole('progressbar')
    expect(bar.getAttribute('aria-valuemax')).toBe('15')
    expect(bar.getAttribute('aria-label')).toBe('Routines')
    expect((bar as HTMLElement).style.height).toBe('4px')
  })
})
