import { app } from 'electron'
import { trackEvent } from './analytics-bus'
import { getInstallationId } from './analytics-config'
import { makeEvent } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'
import type { MergeStrategy } from '../../shared/types'

// ---------------------------------------------------------------------------
// Completion-flow telemetry
//
// merge_completed: terminal outcome of a merge attempt (success, failure,
//   paused-on-conflict, aborted). Carries the merge strategy enum and the
//   outcome — no branch/repo names.
// pr_opened: fired when a PR has been opened via the completion flow.
//   Carries only the draft flag.
// ---------------------------------------------------------------------------

export type MergeOutcome = 'succeeded' | 'failed' | 'paused_conflict' | 'aborted'

function ctx(): EventContext {
  return {
    installation_id: getInstallationId(),
    app_version: app.getVersion(),
    platform: process.platform
  }
}

export function trackMergeCompleted(outcome: MergeOutcome, strategy: MergeStrategy): void {
  try {
    trackEvent(
      makeEvent(ctx(), {
        event_name: 'merge_completed',
        outcome,
        strategy
      })
    )
  } catch {
    // Never throw from instrumentation
  }
}

export function trackPrOpened(draft: boolean): void {
  try {
    trackEvent(
      makeEvent(ctx(), {
        event_name: 'pr_opened',
        draft
      })
    )
  } catch {
    // Never throw from instrumentation
  }
}
