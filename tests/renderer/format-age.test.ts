import { describe, it, expect } from 'vitest'
import { formatAge } from '../../src/renderer/lib/format-age'

describe('formatAge', () => {
  it('returns "just now" for deltas under one minute', () => {
    expect(formatAge(0)).toBe('just now')
    expect(formatAge(59_000)).toBe('just now')
  })

  it('reports whole minutes up to an hour', () => {
    expect(formatAge(60_000)).toBe('1m')
    expect(formatAge(5 * 60_000 + 30_000)).toBe('5m')
    expect(formatAge(59 * 60_000)).toBe('59m')
  })

  it('reports whole hours up to a day', () => {
    expect(formatAge(60 * 60_000)).toBe('1h')
    expect(formatAge(3 * 60 * 60_000 + 45 * 60_000)).toBe('3h')
    expect(formatAge(23 * 60 * 60_000)).toBe('23h')
  })

  it('reports whole days for anything ≥ 24 hours', () => {
    expect(formatAge(24 * 60 * 60_000)).toBe('1d')
    expect(formatAge(10 * 24 * 60 * 60_000)).toBe('10d')
  })

  it('clamps negative deltas (clock skew) to "just now"', () => {
    expect(formatAge(-5_000)).toBe('just now')
    expect(formatAge(-60 * 60_000)).toBe('just now')
  })

  it('returns "just now" for non-finite input rather than NaN text', () => {
    expect(formatAge(Number.NaN)).toBe('just now')
    expect(formatAge(Number.POSITIVE_INFINITY)).toBe('just now')
  })

  describe("mixed style", () => {
    it('returns "<1m" for sub-minute deltas', () => {
      expect(formatAge(0, 'mixed')).toBe('<1m')
      expect(formatAge(30_000, 'mixed')).toBe('<1m')
      expect(formatAge(-5_000, 'mixed')).toBe('<1m')
    })

    it('reports minutes only when under an hour', () => {
      expect(formatAge(60_000, 'mixed')).toBe('1m')
      expect(formatAge(45 * 60_000, 'mixed')).toBe('45m')
    })

    it('reports hours+minutes when under a day', () => {
      expect(formatAge(3 * 60 * 60_000 + 12 * 60_000, 'mixed')).toBe('3h12m')
      expect(formatAge(7 * 60 * 60_000 + 0, 'mixed')).toBe('7h')
      expect(formatAge(23 * 60 * 60_000 + 59 * 60_000, 'mixed')).toBe('23h59m')
    })

    it('reports days+hours when over a day', () => {
      expect(formatAge(24 * 60 * 60_000, 'mixed')).toBe('1d')
      expect(formatAge(2 * 24 * 60 * 60_000 + 4 * 60 * 60_000, 'mixed')).toBe('2d4h')
      expect(formatAge(5 * 24 * 60 * 60_000, 'mixed')).toBe('5d')
    })
  })
})
