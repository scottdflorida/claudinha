import { app } from 'electron'
import { trackEvent } from './analytics-bus'
import { getInstallationId } from './analytics-config'
import { makeEvent } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'

// ---------------------------------------------------------------------------
// Error and crash telemetry (B-083)
//
// Scrubs paths and secrets from all error content before sending.
// Rate-limits each error type to max 10 events per minute.
// All events gated on consent via trackEvent() → isAnalyticsEnabled().
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------

// Matches Unix/Windows absolute and relative file paths
const PATH_PATTERN = /[/\\][\w.\-/\\]+/g

// Matches common secret patterns
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9\-_]{10,}/g,           // Anthropic / OpenAI style API keys
  /key-[A-Za-z0-9\-_]{10,}/g,          // Generic key- prefix
  /token-?[A-Za-z0-9\-_]{10,}/gi,      // token prefix
  /[A-Za-z0-9+/]{20,}={0,2}/g          // Base64 blocks ≥ 20 chars
]

/** Remove file paths and secret-looking strings from an error message */
export function scrubMessage(msg: string): string {
  let s = msg
  s = s.replace(PATH_PATTERN, '<path>')
  for (const pattern of SECRET_PATTERNS) {
    s = s.replace(pattern, '<redacted>')
  }
  return s
}

// ---------------------------------------------------------------------------
// Rate limiting — max 10 events per error type per minute
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

const rateLimitCounters = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(eventType: string): boolean {
  const now = Date.now()
  const entry = rateLimitCounters.get(eventType)

  if (!entry || now >= entry.resetAt) {
    rateLimitCounters.set(eventType, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }

  if (entry.count >= RATE_LIMIT_MAX) return true

  entry.count++
  return false
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ctx(): EventContext {
  return {
    installation_id: getInstallationId(),
    app_version: app.getVersion(),
    platform: process.platform
  }
}

function paneAgeBucket(createdAt: number): string {
  const ageMs = Date.now() - createdAt
  const m = ageMs / 60_000
  if (m < 1) return '<1m'
  if (m < 10) return '1-10m'
  return '10m+'
}

// ---------------------------------------------------------------------------
// Public track functions
// ---------------------------------------------------------------------------

export function trackUnhandledError(err: unknown, processName: 'main' | 'renderer'): void {
  if (isRateLimited('unhandled_error')) return
  const errorType = err instanceof Error ? err.constructor.name : typeof err
  trackEvent(makeEvent(ctx(), {
    event_name: 'unhandled_error',
    error_type: errorType,
    process: processName
  }))
}

export function trackPtyCrashed(exitCode: number | null, paneCreatedAt: number): void {
  if (isRateLimited('pty_crashed')) return
  trackEvent(makeEvent(ctx(), {
    event_name: 'pty_crashed',
    exit_code: exitCode,
    pane_age_bucket: paneAgeBucket(paneCreatedAt) as any
  }))
}

export function trackHookFailure(hookEventType: string): void {
  if (isRateLimited('hook_failure')) return
  trackEvent(makeEvent(ctx(), {
    event_name: 'hook_failure',
    hook_event_type: hookEventType
  }))
}

export function trackFallbackActivated(): void {
  if (isRateLimited('fallback_activated')) return
  trackEvent(makeEvent(ctx(), {
    event_name: 'fallback_activated'
  }))
}

export function trackSettingsMergeError(errorType: string): void {
  if (isRateLimited('settings_merge_error')) return
  trackEvent(makeEvent(ctx(), {
    event_name: 'settings_merge_error',
    error_type: scrubMessage(errorType)
  }))
}
