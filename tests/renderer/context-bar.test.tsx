// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ContextBar, contextFillColor } from '../../src/renderer/components/ContextBar'

describe('contextFillColor', () => {
  it('returns warm-gray fill at 0%', () => {
    expect(contextFillColor(0)).toBe('var(--color-border-strong)')
  })

  it('stays on warm-gray fill across the mid-range', () => {
    expect(contextFillColor(50)).toBe('var(--color-border-strong)')
  })

  it('stays on warm-gray fill just below the warning threshold', () => {
    expect(contextFillColor(69)).toBe('var(--color-border-strong)')
  })

  it('switches to darkish-red fill exactly at the warning threshold', () => {
    expect(contextFillColor(70)).toBe('var(--rate-limit-fill-warning)')
  })

  it('stays on darkish-red fill at 100%', () => {
    expect(contextFillColor(100)).toBe('var(--rate-limit-fill-warning)')
  })

  it('treats negatives as below threshold (warm-gray fill)', () => {
    expect(contextFillColor(-10)).toBe('var(--color-border-strong)')
  })

  it('treats overshoots as above threshold (darkish-red fill)', () => {
    expect(contextFillColor(150)).toBe('var(--rate-limit-fill-warning)')
  })
})

describe('ContextBar rendering', () => {
  afterEach(() => cleanup())

  it('renders the ctx label and a progress fill scaled to the percent', () => {
    const { container, getByText } = render(
      <ContextBar contextPercent={35} />
    )
    expect(getByText(/ctx 35%/)).toBeTruthy()
    const fill = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(fill).toBeTruthy()
    expect(fill.style.width).toBe('35%')
    // Text color routes through a CSS custom property so themes can swap.
    const textSpan = fill.parentElement!.querySelector('span:not([aria-hidden="true"])') as HTMLElement
    expect(textSpan.style.color).toBe('var(--rate-limit-text)')
  })

  it('rounds fractional percents before rendering', () => {
    const { getByText, container } = render(
      <ContextBar contextPercent={35.6} />
    )
    expect(getByText(/ctx 36%/)).toBeTruthy()
    const fill = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(fill.style.width).toBe('36%')
  })

  it('uses the warm-gray fill below 70%', () => {
    const { container } = render(<ContextBar contextPercent={69} />)
    const fill = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(fill.style.backgroundColor).toBe('var(--color-border-strong)')
    // Border stays neutral below threshold.
    const wrapper = fill.parentElement as HTMLElement
    expect(wrapper.style.border).toContain('var(--color-border-strong)')
  })

  it('switches to darkish-red fill at 70% and flips the border to the warning color', () => {
    const { container } = render(<ContextBar contextPercent={70} />)
    const fill = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(fill.style.backgroundColor).toBe('var(--rate-limit-fill-warning)')
    const wrapper = fill.parentElement as HTMLElement
    // #DB4D3F = RATE_LIMIT_WARNING_COLOR
    expect(wrapper.style.borderColor).toBe('rgb(219, 77, 63)')
  })

  it('keeps the warning fill at 100%', () => {
    const { container } = render(<ContextBar contextPercent={100} />)
    const fill = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(fill.style.backgroundColor).toBe('var(--rate-limit-fill-warning)')
    expect(fill.style.width).toBe('100%')
  })

  it('clamps overshoots so the fill never exceeds 100%', () => {
    const { container } = render(<ContextBar contextPercent={150} />)
    const fill = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('clamps negatives to 0% so the fill never goes below zero', () => {
    const { container } = render(<ContextBar contextPercent={-5} />)
    const fill = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(fill.style.width).toBe('0%')
  })

  it('renders a placeholder pill with "ctx —" when contextPercent is null', () => {
    const { container, getByText } = render(<ContextBar contextPercent={null} />)
    expect(getByText('ctx —')).toBeTruthy()
    // No aria-hidden fill span on the placeholder.
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull()
  })

  it('placeholder preserves the same outer width as a live gauge so neighbours do not reflow', () => {
    const live = render(<ContextBar contextPercent={42} />)
    const liveWrapper = live.container.querySelector('span[aria-hidden="true"]')!.parentElement as HTMLElement
    const liveWidth = liveWrapper.style.width
    cleanup()

    const placeholder = render(<ContextBar contextPercent={null} />)
    const placeholderWrapper = placeholder.container.firstChild as HTMLElement
    expect(placeholderWrapper.style.width).toBe(liveWidth)
    expect(placeholderWrapper.style.textAlign).toBe('center')
  })
})
