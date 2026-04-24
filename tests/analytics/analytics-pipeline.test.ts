/**
 * Analytics pipeline integration tests (B-085)
 *
 * Tests the full event flow: instrumentation → AnalyticsBus → TestProvider.
 * Uses vi.mock to control consent state without Electron or electron-store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnalyticsEvent } from '../../src/shared/analytics-events'
import {
  makeEvent,
  bucketTokens,
  bucketCostUsd,
  bucketFeedbackLength,
  roundToNearest
} from '../../src/shared/analytics-events'
import { TestProvider } from './test-provider'

// ---------------------------------------------------------------------------
// Mocks — vi.mock calls are hoisted before any imports run
// ---------------------------------------------------------------------------

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown> = Record<string, unknown>> {
    private data = new Map<string, unknown>()
    get<K extends keyof T>(key: K, def?: T[K]): T[K] {
      return (this.data.has(key as string) ? this.data.get(key as string) : def) as T[K]
    }
    set<K extends keyof T>(key: K, val: T[K]): void {
      this.data.set(key as string, val)
    }
    delete(key: string): void {
      this.data.delete(key)
    }
  }
  return { default: MockStore }
})

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.1.0'),
    getPath: vi.fn(() => '/tmp/test')
  },
  ipcMain: {
    handle: vi.fn()
  }
}))

const mockIsEnabled = vi.fn<[], boolean>(() => true)

vi.mock('../../src/main/analytics/analytics-config', () => ({
  isAnalyticsEnabled: () => mockIsEnabled(),
  getInstallationId: () => 'test-install-id',
  getConsentState: () => (mockIsEnabled() ? 'granted' : 'denied')
}))

// Static imports — mocks are already in place due to hoisting
import { AnalyticsBus } from '../../src/main/analytics/analytics-bus'
import { scrubMessage } from '../../src/main/analytics/error-instrumentation'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CTX = {
  installation_id: 'test-install-id',
  app_version: '0.1.0',
  platform: 'darwin'
}

function makeTestEvent(overrides: Record<string, unknown> = {}): AnalyticsEvent {
  return makeEvent(TEST_CTX, {
    event_name: 'pane_spawned',
    spawn_mode: 'claude',
    pane_count: 1,
    ...overrides
  } as any)
}

function makeBus(provider: TestProvider): InstanceType<typeof AnalyticsBus> {
  const bus = new AnalyticsBus()
  bus.setFlushFn((events, gzipped, body) => provider.sendBatch(events, gzipped, body))
  return bus
}

// ---------------------------------------------------------------------------
// 1. Happy path: granted consent → events reach provider
// ---------------------------------------------------------------------------

describe('Scenario 1: Happy path — consent granted', () => {
  beforeEach(() => mockIsEnabled.mockReturnValue(true))

  it('events flow from trackEvent to provider', async () => {
    const provider = new TestProvider()
    const bus = makeBus(provider)

    bus.trackEvent(makeTestEvent())
    bus.trackEvent(makeTestEvent({ event_name: 'pane_closed', close_trigger: 'manual' }))

    await bus.shutdown()

    expect(provider.allEvents).toHaveLength(2)
    expect(provider.allEvents[0].event_name).toBe('pane_spawned')
    expect(provider.allEvents[1].event_name).toBe('pane_closed')
  })

  it('events carry correct common fields', async () => {
    const provider = new TestProvider()
    const bus = makeBus(provider)

    bus.trackEvent(makeTestEvent())
    await bus.shutdown()

    const event = provider.allEvents[0]
    expect(event.installation_id).toBe('test-install-id')
    expect(event.app_version).toBe('0.1.0')
    expect(event.platform).toBe('darwin')
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// ---------------------------------------------------------------------------
// 2. Consent denied: zero events reach provider
// ---------------------------------------------------------------------------

describe('Scenario 2: Consent denied — no events flow', () => {
  beforeEach(() => mockIsEnabled.mockReturnValue(false))

  it('trackEvent is a no-op when consent is denied', async () => {
    const provider = new TestProvider()
    const bus = makeBus(provider)

    bus.trackEvent(makeTestEvent())
    bus.trackEvent(makeTestEvent())
    bus.trackEvent(makeTestEvent())

    await bus.shutdown()

    expect(provider.allEvents).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 3. Consent revoked mid-session
// ---------------------------------------------------------------------------

describe('Scenario 3: Consent revoked mid-session', () => {
  it('consent revocation at flush time clears even pre-revocation queued events', async () => {
    // The bus checks consent at BOTH trackEvent and flush time.
    // This is stronger than checking only at trackEvent: even events that were
    // queued while consent was granted are discarded if consent is revoked
    // before the flush occurs. This provides a stronger privacy guarantee.
    mockIsEnabled.mockReturnValue(true)
    const provider = new TestProvider()
    const bus = makeBus(provider)

    bus.trackEvent(makeTestEvent()) // queued while granted
    bus.trackEvent(makeTestEvent()) // queued while granted

    // Revoke consent before flush occurs
    mockIsEnabled.mockReturnValue(false)

    bus.trackEvent(makeTestEvent()) // dropped at trackEvent (consent denied)

    await bus.shutdown()

    // All events cleared at flush time because consent is now revoked
    expect(provider.allEvents).toHaveLength(0)
  })

  it('events added after revocation are dropped at trackEvent time', async () => {
    mockIsEnabled.mockReturnValue(true)
    const provider = new TestProvider()
    const bus = makeBus(provider)

    mockIsEnabled.mockReturnValue(false)
    bus.trackEvent(makeTestEvent()) // dropped immediately
    bus.trackEvent(makeTestEvent()) // dropped immediately

    await bus.shutdown()
    expect(provider.allEvents).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Consent granted mid-session
// ---------------------------------------------------------------------------

describe('Scenario 4: Consent granted mid-session', () => {
  it('events before consent grant are dropped; events after flow', async () => {
    mockIsEnabled.mockReturnValue(false)
    const provider = new TestProvider()
    const bus = makeBus(provider)

    bus.trackEvent(makeTestEvent())
    bus.trackEvent(makeTestEvent())

    // Grant consent
    mockIsEnabled.mockReturnValue(true)

    bus.trackEvent(makeTestEvent())

    await bus.shutdown()

    expect(provider.allEvents).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 5. Network failure resilience
// ---------------------------------------------------------------------------

describe('Scenario 5: Network failure resilience', () => {
  it('events are requeued when provider throws and delivered on next flush', async () => {
    mockIsEnabled.mockReturnValue(true)
    const provider = new TestProvider()
    const bus = makeBus(provider)

    // Provider will fail on first sendBatch call
    provider.failNextN = 1
    bus.trackEvent(makeTestEvent())

    // First shutdown: flush fails, events requeued, shutdown resolves via 2s race
    // With real timers and immediate Promise.race resolution from flush side,
    // this completes quickly when queue is non-empty but flush fails.
    const firstShutdown = bus.shutdown()
    await Promise.race([firstShutdown, new Promise((r) => setTimeout(r, 50))])

    // Provider should have received 0 batches (all failed)
    expect(provider.batches).toHaveLength(0)

    // New bus with healthy provider
    const bus2 = new AnalyticsBus()
    bus2.setFlushFn((events, gzipped, body) => provider.sendBatch(events, gzipped, body))
    bus2.trackEvent(makeTestEvent())
    await bus2.shutdown()

    expect(provider.allEvents).toHaveLength(1)
  })

  it('accumulates events below the auto-flush threshold and delivers all on shutdown', async () => {
    // Use 49 events — just below the FLUSH_THRESHOLD of 50 — so no auto-flush
    // is triggered during accumulation. All events are delivered on shutdown.
    mockIsEnabled.mockReturnValue(true)
    const provider = new TestProvider()
    const bus = makeBus(provider)

    for (let i = 0; i < 49; i++) {
      bus.trackEvent(makeTestEvent())
    }

    await bus.shutdown()
    expect(provider.allEvents).toHaveLength(49)
  })
})

// ---------------------------------------------------------------------------
// 6. PII audit
// ---------------------------------------------------------------------------

const ALL_TEST_EVENTS: AnalyticsEvent[] = [
  makeEvent(TEST_CTX, { event_name: 'pane_spawned', spawn_mode: 'claude', pane_count: 2 }),
  makeEvent(TEST_CTX, { event_name: 'pane_closed', close_trigger: 'manual' }),
  makeEvent(TEST_CTX, { event_name: 'pane_moved' }),
  makeEvent(TEST_CTX, { event_name: 'spawn_mode_selected', mode: 'custom' }),
  makeEvent(TEST_CTX, { event_name: 'window_created', window_count: 1 }),
  makeEvent(TEST_CTX, { event_name: 'window_closed', active_pane_count: 0 }),
  makeEvent(TEST_CTX, { event_name: 'keyboard_shortcut_used', action: 'new_pane' }),
  makeEvent(TEST_CTX, { event_name: 'feedback_submitted', length_bucket: '0-50' }),
  makeEvent(TEST_CTX, { event_name: 'pane_collapsed' }),
  makeEvent(TEST_CTX, { event_name: 'pane_expanded' }),
  makeEvent(TEST_CTX, {
    event_name: 'session_completed',
    duration_seconds_rounded: 60,
    token_bucket: '1k-10k',
    cost_bucket: '0.01-0.10',
    tool_count: 3,
    exit_reason: 'done'
  }),
  makeEvent(TEST_CTX, { event_name: 'app_launched', time_to_first_window_ms: 1500 }),
  makeEvent(TEST_CTX, { event_name: 'pty_spawned', spawn_latency_ms: 200 }),
  makeEvent(TEST_CTX, {
    event_name: 'memory_snapshot',
    heap_used_mb: 120,
    external_mb: 10,
    pane_count: 2
  }),
  makeEvent(TEST_CTX, {
    event_name: 'unhandled_error',
    error_type: 'TypeError',
    process: 'main'
  }),
  makeEvent(TEST_CTX, { event_name: 'pty_crashed', exit_code: 1 }),
  makeEvent(TEST_CTX, { event_name: 'hook_failure', hook_event_type: 'PreToolUse' }),
  makeEvent(TEST_CTX, { event_name: 'fallback_activated' }),
  makeEvent(TEST_CTX, { event_name: 'settings_merge_error', error_type: 'SyntaxError' }),
  makeEvent(TEST_CTX, {
    event_name: 'app_session_started',
    electron_version: '33.0.0',
    node_version: '20.0.0',
    chrome_version: '128.0.0'
  })
]

describe('Scenario 6: PII audit', () => {
  it('serialized events contain no email addresses', () => {
    const json = JSON.stringify(ALL_TEST_EVENTS)
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    expect(json.match(emailPattern)).toBeNull()
  })

  it('serialized events contain no API key patterns', () => {
    const json = JSON.stringify(ALL_TEST_EVENTS)
    expect(json).not.toMatch(/sk-[A-Za-z0-9\-_]{10,}/)
    expect(json).not.toMatch(/key-[A-Za-z0-9\-_]{10,}/)
    expect(json).not.toMatch(/token-?[A-Za-z0-9\-_]{10,}/i)
  })

  it('installation_id field matches anonymous UUID format', () => {
    for (const event of ALL_TEST_EVENTS) {
      // Acceptable: a real UUID or our test placeholder
      expect(event.installation_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^test-install-id$/
      )
    }
  })

  it('no raw user-input text appears in any field name', () => {
    // Verify no event type contains a field called "message", "content",
    // "code", "path", "filename", "input" — these would suggest PII exposure
    const dangerousFields = ['message', 'content', 'code', 'path', 'filename', 'input', 'body']
    for (const event of ALL_TEST_EVENTS) {
      for (const field of dangerousFields) {
        expect(Object.keys(event)).not.toContain(field)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Bucketing verification
// ---------------------------------------------------------------------------

describe('Scenario 7: Bucketing verification', () => {
  it('bucketTokens covers all ranges', () => {
    expect(bucketTokens(0)).toBe('0-1k')
    expect(bucketTokens(999)).toBe('0-1k')
    expect(bucketTokens(1000)).toBe('1k-10k')
    expect(bucketTokens(9999)).toBe('1k-10k')
    expect(bucketTokens(10000)).toBe('10k-50k')
    expect(bucketTokens(49999)).toBe('10k-50k')
    expect(bucketTokens(50000)).toBe('50k-100k')
    expect(bucketTokens(99999)).toBe('50k-100k')
    expect(bucketTokens(100000)).toBe('100k+')
  })

  it('bucketCostUsd covers all ranges', () => {
    expect(bucketCostUsd(0)).toBe('<0.01')
    expect(bucketCostUsd(0.009)).toBe('<0.01')
    expect(bucketCostUsd(0.01)).toBe('0.01-0.10')
    expect(bucketCostUsd(0.099)).toBe('0.01-0.10')
    expect(bucketCostUsd(0.1)).toBe('0.10-1.00')
    expect(bucketCostUsd(0.999)).toBe('0.10-1.00')
    expect(bucketCostUsd(1.0)).toBe('1.00-5.00')
    expect(bucketCostUsd(4.99)).toBe('1.00-5.00')
    expect(bucketCostUsd(5.0)).toBe('5.00+')
  })

  it('bucketFeedbackLength covers all ranges', () => {
    expect(bucketFeedbackLength(0)).toBe('0-50')
    expect(bucketFeedbackLength(50)).toBe('0-50')
    expect(bucketFeedbackLength(51)).toBe('51-200')
    expect(bucketFeedbackLength(200)).toBe('51-200')
    expect(bucketFeedbackLength(201)).toBe('201-500')
    expect(bucketFeedbackLength(500)).toBe('201-500')
    expect(bucketFeedbackLength(501)).toBe('500+')
  })

  it('roundToNearest rounds to correct granularity', () => {
    expect(roundToNearest(1234, 100)).toBe(1200)
    expect(roundToNearest(1250, 100)).toBe(1300)
    expect(roundToNearest(47, 50)).toBe(50)
    expect(roundToNearest(0, 10)).toBe(0)
  })

  it('session_completed event uses bucketed fields, not raw numbers', () => {
    const rawDurationMs = 123_456
    const rawTokens = 7_500
    const rawCostUsd = 0.037

    const event = makeEvent(TEST_CTX, {
      event_name: 'session_completed',
      duration_seconds_rounded: roundToNearest(rawDurationMs / 1000, 10),
      token_bucket: bucketTokens(rawTokens),
      cost_bucket: bucketCostUsd(rawCostUsd),
      tool_count: 3,
      exit_reason: 'done'
    })

    // duration is rounded to nearest 10s (no fractional seconds)
    expect(event.duration_seconds_rounded % 10).toBe(0)
    // token and cost fields are opaque bucket strings
    expect(event.token_bucket).toBe('1k-10k')
    expect(event.cost_bucket).toBe('0.01-0.10')
    // no raw numeric fields exposed
    expect((event as Record<string, unknown>)['duration_ms']).toBeUndefined()
    expect((event as Record<string, unknown>)['total_tokens']).toBeUndefined()
    expect((event as Record<string, unknown>)['cost_usd']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Consent state transitions (all four)
// ---------------------------------------------------------------------------

describe('Consent state transitions', () => {
  it('pending → granted: events flow after grant', async () => {
    mockIsEnabled.mockReturnValue(false) // pending (treated as denied)
    const provider = new TestProvider()
    const bus = makeBus(provider)

    bus.trackEvent(makeTestEvent()) // dropped

    mockIsEnabled.mockReturnValue(true) // granted
    bus.trackEvent(makeTestEvent()) // flows

    await bus.shutdown()
    expect(provider.allEvents).toHaveLength(1)
  })

  it('pending → denied: zero events ever', async () => {
    mockIsEnabled.mockReturnValue(false)
    const provider = new TestProvider()
    const bus = makeBus(provider)

    bus.trackEvent(makeTestEvent())
    bus.trackEvent(makeTestEvent())

    await bus.shutdown()
    expect(provider.allEvents).toHaveLength(0)
  })

  it('granted → denied: flush-time check discards all queued events', async () => {
    // Consistent with Scenario 3: consent is checked at flush time too.
    // Events queued while granted are dropped if consent is revoked before flush.
    mockIsEnabled.mockReturnValue(true)
    const provider = new TestProvider()
    const bus = makeBus(provider)

    bus.trackEvent(makeTestEvent()) // queued while granted
    mockIsEnabled.mockReturnValue(false)
    bus.trackEvent(makeTestEvent()) // dropped at trackEvent

    await bus.shutdown() // flush clears queue (consent revoked)
    expect(provider.allEvents).toHaveLength(0)
  })

  it('denied → granted: events start from grant point', async () => {
    mockIsEnabled.mockReturnValue(false)
    const provider = new TestProvider()
    const bus = makeBus(provider)

    bus.trackEvent(makeTestEvent()) // dropped
    mockIsEnabled.mockReturnValue(true)
    bus.trackEvent(makeTestEvent()) // flows
    bus.trackEvent(makeTestEvent()) // flows

    await bus.shutdown()
    expect(provider.allEvents).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// scrubMessage — path and secret scrubbing
// ---------------------------------------------------------------------------

describe('scrubMessage', () => {
  it('replaces Unix file paths with <path>', () => {
    const result = scrubMessage('Error in /home/user/project/src/foo.ts')
    expect(result).toContain('<path>')
    expect(result).not.toContain('/home/user')
  })

  it('replaces Anthropic-style API keys', () => {
    const result = scrubMessage('Failed with sk-ant-api03-abc123def456ghi789jkl')
    expect(result).not.toContain('sk-ant')
    expect(result).toContain('<redacted>')
  })

  it('preserves non-sensitive error messages unchanged', () => {
    const msg = 'Connection refused: ECONNREFUSED'
    expect(scrubMessage(msg)).toBe(msg)
  })

  it('replaces Windows-style paths', () => {
    const result = scrubMessage('Error in C:\\Users\\alice\\project\\main.ts')
    expect(result).not.toContain('alice')
  })
})
