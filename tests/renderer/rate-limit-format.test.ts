// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import {
  formatCountdown,
  formatRateLimitLabel,
  rateLimitFillColor,
  RateLimitBar
} from '../../src/renderer/components/RateLimitBar'

const NOW = new Date('2026-04-08T12:00:00Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('formatCountdown', () => {
  it('separates hours and minutes with a space', () => {
    const target = new Date(NOW + (1 * 60 * 60 * 1000) + (16 * 60 * 1000)).toISOString()
    expect(formatCountdown(target)).toBe('1h 16m')
  })

  it('separates days, hours, and minutes with spaces', () => {
    const target = new Date(NOW + (2 * 24 * 60 * 60 * 1000) + (5 * 60 * 60 * 1000) + (30 * 60 * 1000)).toISOString()
    expect(formatCountdown(target)).toBe('2d 5h 30m')
  })

  it('omits zero units cleanly without leaving stray spaces', () => {
    const target = new Date(NOW + (3 * 60 * 60 * 1000)).toISOString()
    expect(formatCountdown(target)).toBe('3h')
  })

  it('returns "<1m" when less than one minute remains', () => {
    const target = new Date(NOW + 30 * 1000).toISOString()
    expect(formatCountdown(target)).toBe('<1m')
  })
})

describe('formatRateLimitLabel', () => {
  it('embeds the spaced countdown in the label', () => {
    const target = new Date(NOW + (1 * 60 * 60 * 1000) + (16 * 60 * 1000)).toISOString()
    const result = formatRateLimitLabel('5h', { usedPercentage: 42, resetsAt: target }, 90)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('5h: 42% resets in 1h 16m')
    expect(result!.isWarning).toBe(false)
  })

  it('flags warning at or above the threshold', () => {
    const target = new Date(NOW + 30 * 60 * 1000).toISOString()
    const result = formatRateLimitLabel('7d', { usedPercentage: 91, resetsAt: target }, 90)
    expect(result!.isWarning).toBe(true)
    expect(result!.text.startsWith('\u26A0 ')).toBe(true)
  })

  it('still returns a label within the 60s grace past resetsAt', () => {
    // At and just past resetsAt the "now" / "<1m" flicker is legit —
    // we keep the gauge live so the bar doesn't thrash at the boundary.
    const target = new Date(NOW - 30 * 1000).toISOString()
    const result = formatRateLimitLabel('5h', { usedPercentage: 85, resetsAt: target }, 90)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('5h: 85% resets in now')
  })

  it('returns null when resetsAt is more than 60s in the past (stale data)', () => {
    // Beyond the grace, upstream has rolled over but no fresh statusline
    // push has arrived. Null forces the placeholder so we don't parrot
    // frozen "85% resets in now" — the bar stays structurally present.
    const target = new Date(NOW - 2 * 60 * 1000).toISOString()
    const result = formatRateLimitLabel('5h', { usedPercentage: 85, resetsAt: target }, 90)
    expect(result).toBeNull()
  })
})

describe('RateLimitBar rendering', () => {
  afterEach(() => cleanup())

  it('renders the bar with both gauges and a progress fill scaled to usage', () => {
    const fiveHourReset = new Date(NOW + 1 * 60 * 60 * 1000 + 16 * 60 * 1000).toISOString()
    const sevenDayReset = new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString()
    const { container, getByText } = render(
      React.createElement(RateLimitBar, {
        fiveHour: { usedPercentage: 42, resetsAt: fiveHourReset },
        sevenDay: { usedPercentage: 77, resetsAt: sevenDayReset }
      })
    )
    expect(getByText('Rate Limits:')).toBeTruthy()
    expect(getByText('5h: 42% resets in 1h 16m')).toBeTruthy()
    expect(getByText('7d: 77% resets in 2d')).toBeTruthy()
    // Two progress fill spans should exist with explicit % widths
    const fills = container.querySelectorAll('span[aria-hidden="true"]')
    expect(fills).toHaveLength(2)
    expect((fills[0] as HTMLElement).style.width).toBe('42%')
    expect((fills[1] as HTMLElement).style.width).toBe('77%')
    // Both gauge wrappers share the same fixed width with centered text
    const wrappers = Array.from(fills).map((f) => f.parentElement as HTMLElement)
    expect(wrappers[0].style.width).toBe('240px')
    expect(wrappers[1].style.width).toBe('240px')
    expect(wrappers[0].style.textAlign).toBe('center')
    expect(wrappers[1].style.textAlign).toBe('center')
  })

  it('renders placeholder gauges when both windows are missing so the bar never disappears', () => {
    const { container, getByText } = render(
      React.createElement(RateLimitBar, { fiveHour: null, sevenDay: null })
    )
    // Bar is still present with the "Rate Limits:" label
    expect(getByText('Rate Limits:')).toBeTruthy()
    // Both placeholder labels render with em-dash
    expect(getByText('5h: —')).toBeTruthy()
    expect(getByText('7d: —')).toBeTruthy()
    // No fill bars exist (placeholders have no aria-hidden progress span)
    const fills = container.querySelectorAll('span[aria-hidden="true"]')
    expect(fills).toHaveLength(0)
    // Placeholders preserve the 240px gauge width so real data fills in without reflow
    const placeholders = container.querySelectorAll('span.text-fg-muted')
    expect(placeholders).toHaveLength(2)
    const wrappers = Array.from(placeholders).map((s) => s.parentElement as HTMLElement)
    expect(wrappers[0].style.width).toBe('240px')
    expect(wrappers[1].style.width).toBe('240px')
  })

  it('renders the placeholder for a window whose reset passed more than a minute ago', () => {
    // Stale-data guard: the upstream 5h window has rolled over but no fresh
    // statusline push has arrived yet. The bar stays structurally present,
    // but the gauge flips to "5h: —" instead of the frozen "85% resets in now"
    // it would otherwise parrot.
    const stale = new Date(NOW - 2 * 60 * 1000).toISOString()
    const fresh = new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString()
    const { container, getByText } = render(
      React.createElement(RateLimitBar, {
        fiveHour: { usedPercentage: 85, resetsAt: stale },
        sevenDay: { usedPercentage: 77, resetsAt: fresh }
      })
    )
    expect(getByText('5h: —')).toBeTruthy()
    expect(getByText('7d: 77% resets in 2d')).toBeTruthy()
    // Exactly one live fill (the 7d gauge) — the stale 5h has no progress span.
    const fills = container.querySelectorAll('span[aria-hidden="true"]')
    expect(fills).toHaveLength(1)
  })

  it('renders a placeholder for the missing window while showing a real gauge for the other', () => {
    const reset = new Date(NOW + 60 * 60 * 1000).toISOString()
    const { container, getByText } = render(
      React.createElement(RateLimitBar, {
        fiveHour: { usedPercentage: 42, resetsAt: reset },
        sevenDay: null
      })
    )
    expect(getByText('5h: 42% resets in 1h')).toBeTruthy()
    expect(getByText('7d: —')).toBeTruthy()
    const fills = container.querySelectorAll('span[aria-hidden="true"]')
    expect(fills).toHaveLength(1)
  })

  it('uses a bolder red border at 90% and above without recoloring the text', () => {
    const reset = new Date(NOW + 60 * 60 * 1000).toISOString()
    const { container } = render(
      React.createElement(RateLimitBar, {
        fiveHour: { usedPercentage: 92, resetsAt: reset },
        sevenDay: null
      })
    )
    const fill = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    const wrapper = fill.parentElement as HTMLElement
    // Bolder red border at the warning threshold (= status-lost / danger-fg-dark)
    expect(wrapper.style.borderColor).toBe('rgb(219, 77, 63)') // #DB4D3F
    // Text color routes through a CSS custom property so the gauge can pick a
    // light-text-on-dark-fill (dark mode) vs dark-text-on-vivid-fill (light mode).
    // jsdom doesn't compute custom properties, so the inline style stays literal.
    const textSpan = wrapper.querySelector('span:not([aria-hidden="true"])') as HTMLElement
    expect(textSpan.style.color).toBe('var(--rate-limit-text)')
    // Warning prefix is still rendered in the label
    expect(textSpan.textContent?.startsWith('\u26A0 ')).toBe(true)
  })

  it('uses a neutral gray border below the warning threshold', () => {
    const reset = new Date(NOW + 60 * 60 * 1000).toISOString()
    const { container } = render(
      React.createElement(RateLimitBar, {
        fiveHour: { usedPercentage: 42, resetsAt: reset },
        sevenDay: null
      })
    )
    const fill = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    const wrapper = fill.parentElement as HTMLElement
    expect(wrapper.style.border).toContain('var(--color-border-strong)')
  })
})

describe('rateLimitFillColor', () => {
  // Both colors are now CSS custom properties so the gauge can render
  // theme-appropriate fills (dark navy + near-white text in dark mode,
  // vivid blue + dark warm charcoal text in light mode). The function still
  // returns a single string per branch — only the resolution moves to CSS.
  it('returns the calm-fill custom property at 0%', () => {
    expect(rateLimitFillColor(0)).toBe('var(--rate-limit-fill)')
  })

  it('stays on the calm-fill custom property across the mid-range', () => {
    expect(rateLimitFillColor(50)).toBe('var(--rate-limit-fill)')
  })

  it('stays on the calm-fill custom property just below the warning threshold', () => {
    expect(rateLimitFillColor(89)).toBe('var(--rate-limit-fill)')
  })

  it('switches to the warning-fill custom property exactly at the warning threshold', () => {
    expect(rateLimitFillColor(90)).toBe('var(--rate-limit-fill-warning)')
  })

  it('stays on the warning-fill custom property at 100%', () => {
    expect(rateLimitFillColor(100)).toBe('var(--rate-limit-fill-warning)')
  })

  it('treats negatives as below threshold (calm fill)', () => {
    expect(rateLimitFillColor(-25)).toBe('var(--rate-limit-fill)')
  })

  it('treats overshoots as above threshold (warning fill)', () => {
    expect(rateLimitFillColor(150)).toBe('var(--rate-limit-fill-warning)')
  })
})
