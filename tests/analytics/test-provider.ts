import type { AnalyticsEvent } from '../../src/shared/analytics-events'
import type { AnalyticsConfig, AnalyticsProvider } from '../../src/main/analytics/analytics-provider'

// ---------------------------------------------------------------------------
// TestProvider — in-memory AnalyticsProvider for integration tests (B-085)
// ---------------------------------------------------------------------------

/**
 * Captures all event batches in memory for assertion.
 * Set `failNextN` to simulate transient network failures.
 */
export class TestProvider implements AnalyticsProvider {
  initialized = false
  shutdownCalled = false
  /** Set > 0 to make the next N sendBatch calls throw */
  failNextN = 0
  /** All batches received, in order */
  readonly batches: AnalyticsEvent[][] = []

  async initialize(_config: AnalyticsConfig): Promise<void> {
    this.initialized = true
  }

  async sendBatch(events: AnalyticsEvent[], _gzipped: boolean, _body: Buffer): Promise<void> {
    if (this.failNextN > 0) {
      this.failNextN--
      throw new Error('Simulated network failure')
    }
    this.batches.push([...events])
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true
  }

  /** Flat list of all events received across all batches */
  get allEvents(): AnalyticsEvent[] {
    return this.batches.flat()
  }

  reset(): void {
    this.batches.length = 0
    this.initialized = false
    this.shutdownCalled = false
    this.failNextN = 0
  }
}
