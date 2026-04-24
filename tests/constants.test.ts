import {
  abbreviateModel,
  getModelContextWindow,
  DEFAULT_CONTEXT_WINDOW,
  MODEL_ABBREVIATIONS,
  MODEL_CONTEXT_WINDOWS
} from '../src/main/constants'

// ---------------------------------------------------------------------------
// abbreviateModel
// ---------------------------------------------------------------------------

describe('abbreviateModel', () => {
  it('returns exact match for known models', () => {
    expect(abbreviateModel('claude-sonnet-4-6')).toBe('s4.6')
    expect(abbreviateModel('claude-opus-4-6')).toBe('o4.6')
    expect(abbreviateModel('claude-haiku-4-5')).toBe('h4.5')
  })

  it('returns prefix match for date-stamped or suffixed variants', () => {
    expect(abbreviateModel('claude-opus-4-6[1m]')).toBe('o4.6')
    expect(abbreviateModel('claude-haiku-4-5-20251001')).toBe('h4.5')
    expect(abbreviateModel('claude-sonnet-4-6-20260301')).toBe('s4.6')
  })

  it('strips claude- prefix for unknown models', () => {
    expect(abbreviateModel('claude-unknown-99')).toBe('unknown-99')
  })

  it('returns first 10 chars for completely unknown models', () => {
    expect(abbreviateModel('some-very-long-model-id')).toBe('some-very-')
  })

  it('handles short unknown model ids', () => {
    expect(abbreviateModel('gpt4')).toBe('gpt4')
  })
})

// ---------------------------------------------------------------------------
// getModelContextWindow
// ---------------------------------------------------------------------------

describe('getModelContextWindow', () => {
  it('returns exact match for known models', () => {
    expect(getModelContextWindow('claude-sonnet-4-6')).toBe(200_000)
    expect(getModelContextWindow('claude-opus-4-6')).toBe(200_000)
  })

  it('returns 1M for opus extended context', () => {
    expect(getModelContextWindow('claude-opus-4-6[1m]')).toBe(1_000_000)
  })

  it('returns prefix match for suffixed variants', () => {
    expect(getModelContextWindow('claude-sonnet-4-6-20260301')).toBe(200_000)
  })

  it('returns DEFAULT_CONTEXT_WINDOW for unknown models', () => {
    expect(getModelContextWindow('unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000)
  })
})
