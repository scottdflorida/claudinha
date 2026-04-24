// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BrandMark } from '../../src/renderer/components/ui/BrandMark'

describe('BrandMark', () => {
  it('renders an svg with the default 28px size', () => {
    const { container } = render(<BrandMark />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('28')
    expect(svg.getAttribute('height')).toBe('28')
  })

  it('uses var(--color-brand) for the body fill by default', () => {
    const { container } = render(<BrandMark size={48} />)
    const rects = Array.from(container.querySelectorAll('rect'))
    // All body-colored shapes (body + feet) default to the brand token.
    for (const rect of rects) {
      expect(rect.getAttribute('fill')).toBe('var(--color-brand)')
    }
  })

  it('honors a custom color override on body + feet', () => {
    const { container } = render(<BrandMark color="#ff0000" />)
    const rects = Array.from(container.querySelectorAll('rect'))
    for (const rect of rects) {
      expect(rect.getAttribute('fill')).toBe('#ff0000')
    }
  })

  it('keeps the eye color fixed regardless of body color override', () => {
    const { container } = render(<BrandMark color="#ff0000" />)
    const circles = Array.from(container.querySelectorAll('circle'))
    expect(circles).toHaveLength(2)
    for (const circle of circles) {
      expect(circle.getAttribute('fill')).toBe('#17328F')
    }
  })

  it('applies the blink class only when blink=true', () => {
    const { rerender, container } = render(<BrandMark blink />)
    expect(container.querySelector('svg')!.classList.contains('brand-mark-blink')).toBe(true)
    rerender(<BrandMark />)
    expect(container.querySelector('svg')!.classList.contains('brand-mark-blink')).toBe(false)
  })

  it('sets the accessible label to Claudinha by default', () => {
    const { container } = render(<BrandMark />)
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Claudinha')
  })

  it('renders a critter silhouette: body rect + two feet rects + two eye circles', () => {
    const { container } = render(<BrandMark size={100} />)
    const rects = Array.from(container.querySelectorAll('rect'))
    const circles = Array.from(container.querySelectorAll('circle'))
    // Three rectangles: two feet drawn first (behind) + one body on top.
    expect(rects).toHaveLength(3)
    // Two eye circles.
    expect(circles).toHaveLength(2)
    // The body is the widest rect (78 in the 100-unit viewBox; wider than it is tall).
    const widths = rects.map((r) => Number(r.getAttribute('width')))
    expect(Math.max(...widths)).toBe(78)
    // And the body is wider than it is tall.
    const bodyRect = rects.find((r) => Number(r.getAttribute('width')) === 78)!
    expect(Number(bodyRect.getAttribute('width'))).toBeGreaterThan(
      Number(bodyRect.getAttribute('height'))
    )
  })

  it('uses a fixed 100-unit viewBox so proportions stay constant across sizes', () => {
    const { container } = render(<BrandMark size={42} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100')
    expect(svg.getAttribute('width')).toBe('42')
    expect(svg.getAttribute('height')).toBe('42')
  })
})
