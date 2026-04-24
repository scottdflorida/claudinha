import { trackEvent } from './analytics-bus'
import { getInstallationId } from './analytics-config'
import { makeEvent } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'
import type { PaneState } from '../../shared/types'
import { app } from 'electron'

// ---------------------------------------------------------------------------
// Session aggregate metrics collection (B-081)
//
// Fires `session_completed` on every pane close with bucketed metrics.
// All values are bucketed or rounded — no raw numbers, no PII.
// ---------------------------------------------------------------------------

// Module-level side-channel: tracks spawn mode per pane (not stored in PaneState)
const paneSpawnModes = new Map<string, string>()

function ctx(): EventContext {
  return {
    installation_id: getInstallationId(),
    app_version: app.getVersion(),
    platform: process.platform
  }
}

// ---------------------------------------------------------------------------
// Registration — called at pane spawn time
// ---------------------------------------------------------------------------

export function registerPaneSpawnMode(paneId: string, spawnMode: string): void {
  paneSpawnModes.set(paneId, spawnMode)
}

export function deregisterPaneSession(paneId: string): void {
  paneSpawnModes.delete(paneId)
}

// ---------------------------------------------------------------------------
// Bucketing helpers
// ---------------------------------------------------------------------------

function bucketDuration(durationMs: number): string {
  const s = durationMs / 1000
  if (s < 60) return '<1m'
  if (s < 300) return '1-5m'
  if (s < 1800) return '5-30m'
  if (s < 7200) return '30m-2h'
  return '>2h'
}

function bucketTokens(tokens: number | null): string {
  if (tokens === null) return 'unknown'
  if (tokens < 1_000) return '<1k'
  if (tokens < 10_000) return '1k-10k'
  if (tokens < 50_000) return '10k-50k'
  if (tokens < 200_000) return '50k-200k'
  return '>200k'
}

function bucketCost(usd: number | null): string {
  if (usd === null) return 'unknown'
  if (usd < 0.01) return '<$0.01'
  if (usd < 0.10) return '$0.01-$0.10'
  if (usd < 1.00) return '$0.10-$1.00'
  return '$1.00+'
}

function countTools(toolsUsed: PaneState['metrics']['toolsUsed']): number {
  if (!toolsUsed) return 0
  return toolsUsed.size
}

function sumToolInvocations(toolsUsed: PaneState['metrics']['toolsUsed']): number {
  if (!toolsUsed) return 0
  let total = 0
  for (const count of toolsUsed.values()) {
    total += count
  }
  return total
}

// ---------------------------------------------------------------------------
// Main instrumentation point — call on every pane close
// ---------------------------------------------------------------------------

export function trackSessionCompleted(pane: PaneState): void {
  try {
    const durationMs = Date.now() - pane.createdAt
    const spawnMode = paneSpawnModes.get(pane.id) ?? 'unknown'
    const { metrics } = pane

    trackEvent(makeEvent(ctx(), {
      event_name: 'session_completed',
      duration_seconds_rounded: Math.round(durationMs / 1000 / 10) * 10,
      token_bucket: bucketTokens(metrics.totalTokens),
      cost_bucket: pane.isApiBilling ? bucketCost(metrics.totalCostUsd) : 'n/a',
      tool_count: countTools(metrics.toolsUsed),
      exit_reason: pane.status === 'done' ? 'done' : 'terminated',
      // Extended fields (no PII)
      duration_bucket: bucketDuration(durationMs) as any,
      final_status: pane.status as any,
      spawn_mode: spawnMode as any,
      tool_invocations: sumToolInvocations(metrics.toolsUsed) as any,
      status_source: pane.statusSource as any,
      is_api_billing: pane.isApiBilling as any,
      context_percent: metrics.contextPercent !== null
        ? Math.round(metrics.contextPercent)
        : null as any
    }))
  } catch {
    // Never throw from instrumentation
  }
}
