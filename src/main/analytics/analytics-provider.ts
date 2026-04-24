import type { AnalyticsEvent } from '../../shared/analytics-events'

// ---------------------------------------------------------------------------
// Analytics provider interface (B-079)
//
// Implement this interface to swap analytics backends without touching
// any instrumentation code.
// ---------------------------------------------------------------------------

export interface AnalyticsConfig {
  /** API key for the analytics service — injected at build time */
  apiKey: string
  /** Host URL for the analytics service */
  host: string
  /** Installation ID (anonymous UUID) */
  installationId: string
  /** Semantic app version */
  appVersion: string
}

export interface AnalyticsProvider {
  initialize(config: AnalyticsConfig): Promise<void>
  sendBatch(events: AnalyticsEvent[], gzipped: boolean, body: Buffer): Promise<void>
  shutdown(): Promise<void>
}
