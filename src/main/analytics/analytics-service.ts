import { app } from 'electron'
import { analyticsBus } from './analytics-bus'
import { getInstallationId } from './analytics-config'
import { PostHogProvider } from './providers/posthog-provider'
import { ConsoleProvider } from './providers/console-provider'
import type { AnalyticsProvider } from './analytics-provider'

// ---------------------------------------------------------------------------
// Analytics service (B-079)
//
// Selects and initializes the correct analytics provider, then wires it
// into the analytics bus as the flush function.
// ---------------------------------------------------------------------------

// Build-time injected constants (see electron.vite.config.ts)
declare const __POSTHOG_API_KEY__: string
declare const __POSTHOG_HOST__: string

let provider: AnalyticsProvider | null = null

/**
 * Call once on app ready, after analyticsBus.start().
 * Selects PostHog in production, ConsoleProvider if --analytics-dry-run flag is set.
 */
export async function initAnalyticsService(): Promise<void> {
  const isDryRun = process.argv.includes('--analytics-dry-run')

  if (isDryRun) {
    provider = new ConsoleProvider()
  } else {
    provider = new PostHogProvider()
  }

  await provider.initialize({
    apiKey: __POSTHOG_API_KEY__,
    host: __POSTHOG_HOST__,
    installationId: getInstallationId(),
    appVersion: app.getVersion()
  })

  // Wire the provider's sendBatch into the bus as the flush function
  analyticsBus.setFlushFn((events, gzipped, body) =>
    provider!.sendBatch(events, gzipped, body)
  )
}

export async function shutdownAnalyticsService(): Promise<void> {
  if (provider) {
    await provider.shutdown().catch(() => {/* ignore */})
    provider = null
  }
}
