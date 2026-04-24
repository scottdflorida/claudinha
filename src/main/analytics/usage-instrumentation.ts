import { app } from 'electron'
import { trackEvent } from './analytics-bus'
import { getInstallationId } from './analytics-config'
import { makeEvent } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'

// ---------------------------------------------------------------------------
// Usage event instrumentation (B-080)
//
// One function per instrumentation point. Each call is a single line at
// the call site. No complex logic here — just event construction.
// ---------------------------------------------------------------------------

function ctx(): EventContext {
  return {
    installation_id: getInstallationId(),
    app_version: app.getVersion(),
    platform: process.platform
  }
}

/** Bucket session duration in seconds into a human-readable band */
function durationBucket(durationMs: number): string {
  const s = durationMs / 1000
  if (s < 60) return '<1m'
  if (s < 300) return '1-5m'
  if (s < 1800) return '5-30m'
  if (s < 7200) return '30m-2h'
  return '>2h'
}

// ---------------------------------------------------------------------------
// Usage events
// ---------------------------------------------------------------------------

export function trackPaneSpawned(spawnMode: string, paneCount: number): void {
  trackEvent(makeEvent(ctx(), { event_name: 'pane_spawned', spawn_mode: spawnMode, pane_count: paneCount }))
}

export function trackPaneClosed(createdAt: number, finalStatus: string, paneCount: number): void {
  const durationMs = Date.now() - createdAt
  trackEvent(makeEvent(ctx(), {
    event_name: 'pane_closed',
    close_trigger: 'manual',
    // We add duration/status as extra fields — they fit the no-PII rule
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    duration_bucket: durationBucket(durationMs) as any,
    final_status: finalStatus as any,
    pane_count: paneCount as any
  }))
}

export function trackPaneMoved(sourcePaneCount: number, targetPaneCount: number): void {
  trackEvent(makeEvent(ctx(), {
    event_name: 'pane_moved',
    // Extra anonymous counts — no IDs
    source_pane_count: sourcePaneCount as any,
    target_pane_count: targetPaneCount as any
  }))
}

export function trackWindowCreated(trigger: string, windowCount: number): void {
  trackEvent(makeEvent(ctx(), {
    event_name: 'window_created',
    window_count: windowCount,
    trigger: trigger as any
  }))
}

export function trackWindowClosed(hadActiveSessions: boolean, windowCount: number): void {
  trackEvent(makeEvent(ctx(), {
    event_name: 'window_closed',
    active_pane_count: 0, // satisfies the interface; specific count not always known at close
    had_active_sessions: hadActiveSessions as any,
    window_count: windowCount as any
  }))
}

export function trackSpawnModeSelected(mode: string): void {
  trackEvent(makeEvent(ctx(), { event_name: 'spawn_mode_selected', mode }))
}

export function trackKeyboardShortcutUsed(action: string): void {
  trackEvent(makeEvent(ctx(), { event_name: 'keyboard_shortcut_used', action }))
}

export function trackPaneCollapsed(): void {
  trackEvent(makeEvent(ctx(), { event_name: 'pane_collapsed' }))
}

export function trackPaneExpanded(): void {
  trackEvent(makeEvent(ctx(), { event_name: 'pane_expanded' }))
}

export function trackFeedbackSubmitted(feedbackType: string, messageLength: number): void {
  const lengthBucket =
    messageLength <= 50 ? '0-50' :
    messageLength <= 200 ? '51-200' :
    messageLength <= 500 ? '201-500' : '500+'
  trackEvent(makeEvent(ctx(), {
    event_name: 'feedback_submitted',
    length_bucket: lengthBucket,
    feedback_type: feedbackType as any
  }))
}
