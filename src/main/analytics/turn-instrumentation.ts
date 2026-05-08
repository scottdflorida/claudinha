/**
 * Telemetry helpers for the v2 turn-as-commit completion-actions stack.
 * Mirrors the shape of error-instrumentation.ts: each public function
 * builds a typed AnalyticsEvent and forwards via `trackEvent`. Consent
 * gating is enforced inside the bus, so callers can fire freely.
 */

import { app } from 'electron'
import { trackEvent } from './analytics-bus'
import { makeEvent } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'
import { getInstallationId } from './analytics-config'

function ctx(): EventContext {
  // `app` is only available once Electron has bootstrapped; call sites
  // can fire from integration tests where it isn't initialized. Guard
  // both `app.getVersion()` and `getInstallationId()` so a missing
  // bootstrap turns into a no-op event rather than an unhandled
  // rejection.
  try {
    return {
      installation_id: getInstallationId(),
      app_version: app.getVersion(),
      platform: process.platform
    }
  } catch {
    return {
      installation_id: 'test',
      app_version: '0.0.0',
      platform: process.platform
    }
  }
}

function safeTrack(fn: () => void): void {
  try { fn() } catch { /* analytics must never break a publish flow */ }
}

function bucketCount(n: number): string {
  if (n <= 1) return '1'
  if (n <= 5) return '2-5'
  return '6+'
}

export function trackTurnPublished(args: {
  path: 'push-branch' | 'direct-merge' | 'pr' | 'draft-pr'
  turnCount: number
  ok: boolean
  source: 'per-terminal' | 'bulk'
}): void {
  safeTrack(() => trackEvent(makeEvent(ctx(), {
    event_name: 'turn_published',
    path: args.path,
    turn_count_bucket: bucketCount(args.turnCount),
    outcome: args.ok ? 'succeeded' : 'failed',
    source: args.source
  })))
}

export function trackTurnSplit(args: { ok: boolean; filesChanged: number }): void {
  safeTrack(() => trackEvent(makeEvent(ctx(), {
    event_name: 'turn_split',
    outcome: args.ok ? 'succeeded' : 'failed',
    files_changed_bucket: bucketCount(args.filesChanged)
  })))
}

export function trackTurnDiscarded(args: {
  ok: boolean
  cascade: boolean
}): void {
  safeTrack(() => trackEvent(makeEvent(ctx(), {
    event_name: 'turn_discarded',
    variant: args.cascade ? 'cascade' : 'tip',
    outcome: args.ok ? 'succeeded' : 'failed'
  })))
}

export function trackBulkRunCompleted(args: {
  action: string
  paneCount: number
  successCount: number
  failureCount: number
  cancelled: boolean
}): void {
  safeTrack(() => trackEvent(makeEvent(ctx(), {
    event_name: 'bulk_run_completed',
    action: args.action,
    pane_count_bucket: bucketCount(args.paneCount),
    success_count_bucket: bucketCount(args.successCount),
    failure_count_bucket: bucketCount(args.failureCount),
    cancelled: args.cancelled
  })))
}
