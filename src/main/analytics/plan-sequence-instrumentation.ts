import { app } from 'electron'
import { trackEvent } from './analytics-bus'
import { getInstallationId } from './analytics-config'
import { makeEvent, bucketApprovedCount } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'

// ---------------------------------------------------------------------------
// Plan-approval sequencer telemetry
//
// Fires on sequencer start + completion so the outcome distribution
// (succeeded / cancelled / watchdog) is visible across installs. The approved
// count is bucketed to avoid fingerprinting small-cohort behavior.
// ---------------------------------------------------------------------------

export type PlanSequenceOutcome = 'succeeded' | 'cancelled' | 'watchdog_timeout'

function ctx(): EventContext {
  return {
    installation_id: getInstallationId(),
    app_version: app.getVersion(),
    platform: process.platform
  }
}

export function trackPlanSequenceStarted(): void {
  try {
    trackEvent(
      makeEvent(ctx(), {
        event_name: 'plan_sequence_started'
      })
    )
  } catch {
    // Never throw from instrumentation
  }
}

export function trackPlanSequenceCompleted(
  outcome: PlanSequenceOutcome,
  approvedCount: number
): void {
  try {
    trackEvent(
      makeEvent(ctx(), {
        event_name: 'plan_sequence_completed',
        outcome,
        approved_count_bucket: bucketApprovedCount(approvedCount)
      })
    )
  } catch {
    // Never throw from instrumentation
  }
}
