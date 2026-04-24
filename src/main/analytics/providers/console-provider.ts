import type { AnalyticsProvider, AnalyticsConfig } from '../analytics-provider'
import type { AnalyticsEvent } from '../../../shared/analytics-events'

// ---------------------------------------------------------------------------
// Console analytics provider (B-079)
//
// Logs events to stdout. Used in development or with --analytics-dry-run.
// Zero network calls, zero side effects.
// ---------------------------------------------------------------------------

export class ConsoleProvider implements AnalyticsProvider {
  async initialize(_config: AnalyticsConfig): Promise<void> {
    console.log('[analytics:console] ConsoleProvider initialized — events will be logged to stdout')
  }

  async sendBatch(events: AnalyticsEvent[], gzipped: boolean, _body: Buffer): Promise<void> {
    console.log(`[analytics:console] Flushing ${events.length} event(s) (gzipped=${gzipped}):`)
    for (const event of events) {
      console.log(`  ${event.event_name}`, JSON.stringify(event))
    }
  }

  async shutdown(): Promise<void> {
    console.log('[analytics:console] ConsoleProvider shutdown')
  }
}
