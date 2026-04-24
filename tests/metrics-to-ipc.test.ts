import { metricsToIpc } from '../src/shared/ipc-channels'
import type { PaneMetrics } from '../src/shared/types'

function makeMetrics(overrides?: Partial<PaneMetrics>): PaneMetrics {
  return {
    totalTokens: null,
    contextPercent: null,
    toolsUsed: null,
    totalCostUsd: null,
    durationMs: null,
    modelDisplayName: null,
    linesAdded: null,
    linesRemoved: null,
    sessionTitle: null,
    ...overrides
  }
}

describe('metricsToIpc', () => {
  it('converts all-null metrics', () => {
    const result = metricsToIpc(makeMetrics())
    expect(result.totalTokens).toBeNull()
    expect(result.toolsUsed).toBeNull()
    expect(result.totalCostUsd).toBeNull()
    expect(result.sessionTitle).toBeNull()
  })

  it('preserves scalar values', () => {
    const result = metricsToIpc(makeMetrics({
      totalTokens: 1234,
      contextPercent: 42.5,
      totalCostUsd: 0.05,
      durationMs: 30000,
      modelDisplayName: 's4.6',
      linesAdded: 10,
      linesRemoved: 3,
      sessionTitle: 'Fix bug'
    }))
    expect(result.totalTokens).toBe(1234)
    expect(result.contextPercent).toBe(42.5)
    expect(result.totalCostUsd).toBe(0.05)
    expect(result.durationMs).toBe(30000)
    expect(result.modelDisplayName).toBe('s4.6')
    expect(result.linesAdded).toBe(10)
    expect(result.linesRemoved).toBe(3)
    expect(result.sessionTitle).toBe('Fix bug')
  })

  it('converts Map<string,number> toolsUsed to plain Record', () => {
    const tools = new Map<string, number>([
      ['Read', 5],
      ['Edit', 3],
      ['Bash', 2]
    ])
    const result = metricsToIpc(makeMetrics({ toolsUsed: tools }))
    expect(result.toolsUsed).toEqual({ Read: 5, Edit: 3, Bash: 2 })
  })

  it('keeps toolsUsed null when null', () => {
    const result = metricsToIpc(makeMetrics({ toolsUsed: null }))
    expect(result.toolsUsed).toBeNull()
  })

  it('handles empty Map', () => {
    const result = metricsToIpc(makeMetrics({ toolsUsed: new Map() }))
    expect(result.toolsUsed).toEqual({})
  })
})
