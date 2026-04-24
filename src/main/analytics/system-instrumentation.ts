import { app } from 'electron'
import { trackEvent } from './analytics-bus'
import { getInstallationId } from './analytics-config'
import { makeEvent } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'

// ---------------------------------------------------------------------------
// System-level telemetry
//
// Fires once per app launch to pin environment context (Electron / Node /
// Chrome versions). No PII — purely runtime identifiers.
// ---------------------------------------------------------------------------

function ctx(): EventContext {
  return {
    installation_id: getInstallationId(),
    app_version: app.getVersion(),
    platform: process.platform
  }
}

/** Fires `app_session_started`. Call once on app ready, before window creation. */
export function trackAppSessionStarted(): void {
  try {
    trackEvent(
      makeEvent(ctx(), {
        event_name: 'app_session_started',
        electron_version: process.versions.electron ?? '',
        node_version: process.versions.node ?? '',
        chrome_version: process.versions.chrome ?? ''
      })
    )
  } catch {
    // Never throw from instrumentation
  }
}
