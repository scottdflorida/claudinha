import { PostHog } from 'posthog-node'
import type { AnalyticsProvider, AnalyticsConfig } from '../analytics-provider'
import type { AnalyticsEvent } from '../../../shared/analytics-events'

// ---------------------------------------------------------------------------
// PostHog analytics provider (B-079)
//
// Sends batches of events to PostHog using the posthog-node SDK.
// The SDK handles its own HTTP transport, retries, and shutdown flush.
// ---------------------------------------------------------------------------

export class PostHogProvider implements AnalyticsProvider {
  private client: PostHog | null = null
  private installationId = ''

  async initialize(config: AnalyticsConfig): Promise<void> {
    if (!config.apiKey) {
      // No API key — stay in no-op mode (safe for dev builds)
      return
    }
    this.installationId = config.installationId
    this.client = new PostHog(config.apiKey, {
      host: config.host,
      flushAt: 1,       // We control batching in analytics-bus; send immediately on flush
      flushInterval: 0  // Disable SDK's own timer — bus owns the schedule
    })
  }

  async sendBatch(events: AnalyticsEvent[], _gzipped: boolean, _body: Buffer): Promise<void> {
    if (!this.client) return

    for (const event of events) {
      this.client.capture({
        distinctId: this.installationId,
        event: event.event_name,
        properties: {
          ...event,
          // Remove the fields PostHog handles itself to avoid duplication
          event_name: undefined,
          timestamp: undefined
        },
        timestamp: new Date(event.timestamp)
      })
    }

    // Flush the PostHog SDK buffer
    await this.client.flush()
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.shutdown()
      this.client = null
    }
  }
}
