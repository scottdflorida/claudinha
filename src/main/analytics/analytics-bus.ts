import { gzipSync } from 'zlib'
import Store from 'electron-store'
import type { AnalyticsEvent } from '../../shared/analytics-events'
import { isAnalyticsEnabled } from './analytics-config'

// ---------------------------------------------------------------------------
// Analytics event bus (B-078)
//
// Buffers events in memory and flushes them in batches to an injected
// transport function. Handles backoff, disk overflow, and shutdown flush.
// ---------------------------------------------------------------------------

const QUEUE_MAX = 500
const FLUSH_INTERVAL_MS = 30_000
const FLUSH_THRESHOLD = 50
const OVERFLOW_STORE_KEY = 'analytics.overflow'

// Exponential backoff steps in ms
const BACKOFF_STEPS = [30_000, 60_000, 120_000, 300_000]

interface BusStore {
  [OVERFLOW_STORE_KEY]: AnalyticsEvent[]
}

export type FlushFn = (events: AnalyticsEvent[], gzipped: boolean, body: Buffer) => Promise<void>

// ---------------------------------------------------------------------------
// AnalyticsBus
// ---------------------------------------------------------------------------

export class AnalyticsBus {
  private queue: AnalyticsEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private backoffIndex = 0
  private flushing = false
  private flushFn: FlushFn | null = null
  private store: Store<BusStore>

  constructor() {
    this.store = new Store<BusStore>({ name: 'analytics-bus' })
  }

  // ---------------------------------------------------------------------------
  // Transport registration — called by analytics-service (B-079)
  // ---------------------------------------------------------------------------

  setFlushFn(fn: FlushFn): void {
    this.flushFn = fn
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    // Recover any events that overflowed to disk on a previous run
    this.recoverFromDisk()

    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {/* handled internally */})
    }, FLUSH_INTERVAL_MS)
  }

  /** Best-effort final flush on app quit. Resolves after 2s timeout. */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    if (this.queue.length === 0) return

    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000))
    await Promise.race([this.flush(), timeout])
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Single entry point for all instrumentation. Synchronous, never throws. */
  trackEvent(event: AnalyticsEvent): void {
    try {
      if (!isAnalyticsEnabled()) return

      if (this.queue.length >= QUEUE_MAX) {
        // Overflow: evict the oldest event to disk
        const evicted = this.queue.shift()!
        this.appendToDisk(evicted)
      }

      this.queue.push(event)

      if (this.queue.length >= FLUSH_THRESHOLD) {
        // Don't await — fire-and-forget
        this.flush().catch(() => {/* handled internally */})
      }
    } catch {
      // trackEvent must never throw
    }
  }

  get queueSize(): number {
    return this.queue.length
  }

  // ---------------------------------------------------------------------------
  // Flush
  // ---------------------------------------------------------------------------

  private async flush(): Promise<void> {
    if (this.flushing) return
    if (this.queue.length === 0) return
    if (!isAnalyticsEnabled()) {
      this.queue = []
      return
    }
    if (!this.flushFn) return

    this.flushing = true
    const batch = this.queue.splice(0, this.queue.length)

    try {
      const { body, gzipped } = this.buildPayload(batch)
      await this.flushFn(batch, gzipped, body)
      // Success: reset backoff
      this.backoffIndex = 0
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }
    } catch {
      // Failure: put events back at front of queue and schedule retry
      this.queue.unshift(...batch)
      this.scheduleRetry()
    } finally {
      this.flushing = false
    }
  }

  private buildPayload(events: AnalyticsEvent[]): { body: Buffer; gzipped: boolean } {
    const json = JSON.stringify(events)
    const raw = Buffer.from(json, 'utf8')
    if (raw.byteLength > 10_240) {
      return { body: gzipSync(raw), gzipped: true }
    }
    return { body: raw, gzipped: false }
  }

  // ---------------------------------------------------------------------------
  // Backoff retry
  // ---------------------------------------------------------------------------

  private scheduleRetry(): void {
    if (this.retryTimer) return
    const delay = BACKOFF_STEPS[Math.min(this.backoffIndex, BACKOFF_STEPS.length - 1)]
    this.backoffIndex = Math.min(this.backoffIndex + 1, BACKOFF_STEPS.length - 1)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.flush().catch(() => {/* handled internally */})
    }, delay)
  }

  // ---------------------------------------------------------------------------
  // Disk overflow persistence
  // ---------------------------------------------------------------------------

  private appendToDisk(event: AnalyticsEvent): void {
    try {
      const existing = this.store.get(OVERFLOW_STORE_KEY, [])
      existing.push(event)
      // Cap disk overflow at 500 events too
      if (existing.length > QUEUE_MAX) existing.shift()
      this.store.set(OVERFLOW_STORE_KEY, existing)
    } catch {
      // Disk write failures are silently ignored
    }
  }

  private recoverFromDisk(): void {
    try {
      const overflowed = this.store.get(OVERFLOW_STORE_KEY, [])
      if (overflowed.length > 0) {
        this.queue.unshift(...overflowed)
        this.store.delete(OVERFLOW_STORE_KEY)
      }
    } catch {
      // Recovery failures are silently ignored
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

export const analyticsBus = new AnalyticsBus()

/** Convenience re-export so call sites only import from one place */
export function trackEvent(event: AnalyticsEvent): void {
  analyticsBus.trackEvent(event)
}
