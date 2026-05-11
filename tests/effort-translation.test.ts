import { describe, it, expect } from 'vitest'
import { effortLevelForSettings } from '../src/main/effort-translation'

describe('effortLevelForSettings', () => {
  it('passes low/medium/high/xhigh through unchanged', () => {
    expect(effortLevelForSettings('low')).toBe('low')
    expect(effortLevelForSettings('medium')).toBe('medium')
    expect(effortLevelForSettings('high')).toBe('high')
    expect(effortLevelForSettings('xhigh')).toBe('xhigh')
  })

  it('maps max to xhigh — settings.json schema does not accept "max"', () => {
    expect(effortLevelForSettings('max')).toBe('xhigh')
  })
})
