// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Badge } from '../../src/renderer/components/ui/Badge'

describe('Badge', () => {
  it('renders a "NEW" badge with uppercase styling', () => {
    const { container, getByText } = render(<Badge variant="new">New</Badge>)
    expect(getByText('New')).toBeTruthy()
    expect(container.firstElementChild!.className).toMatch(/uppercase/)
    expect(container.firstElementChild!.className).toMatch(/bg-accent-subtle/)
  })

  it('renders "BETA" with muted fill', () => {
    const { container } = render(<Badge variant="beta">Beta</Badge>)
    expect(container.firstElementChild!.className).toMatch(/bg-overlay/)
  })

  it('renders a "count" chip as a tight fixed-size circle', () => {
    const { container } = render(<Badge variant="count">8</Badge>)
    const span = container.firstElementChild as HTMLElement
    expect(span.className).toMatch(/bg-accent/)
    expect(span.className).toMatch(/rounded-full/)
  })

  it('renders "interactive" with a leading dot', () => {
    const { container } = render(<Badge variant="interactive">Live</Badge>)
    const dot = container.querySelector('span > span')
    expect(dot).toBeTruthy()
  })
})
