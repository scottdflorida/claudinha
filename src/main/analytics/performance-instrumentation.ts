import { app } from 'electron'
import { trackEvent } from './analytics-bus'
import { getInstallationId, isAnalyticsEnabled } from './analytics-config'
import { makeEvent } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'

// ---------------------------------------------------------------------------
// Performance telemetry (B-082)
//
// Tracks: app launch time, PTY spawn latency, periodic memory snapshots.
// All timing values are rounded to prevent fingerprinting.
// ---------------------------------------------------------------------------

// Capture module-load time as a proxy for "app ready" baseline
const MODULE_LOAD_TIME = Date.now()

// Per-pane spawn start times (cleared after first onData)
const ptySpawnStartTimes = new Map<string, number>()

// Memory snapshot interval handle
let memorySnapshotTimer: ReturnType<typeof setInterval> | null = null

const MEMORY_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

function ctx(): EventContext {
  return {
    installation_id: getInstallationId(),
    app_version: app.getVersion(),
    platform: process.platform
  }
}

// ---------------------------------------------------------------------------
// App launch time
// ---------------------------------------------------------------------------

/**
 * Call once, passing the BrowserWindow that was created first.
 * Fires `app_launched` when the window's renderer finishes loading.
 */
export function trackAppLaunch(win: Electron.BrowserWindow): void {
  const onLoad = (): void => {
    const elapsedMs = Date.now() - MODULE_LOAD_TIME
    const rounded = Math.round(elapsedMs / 100) * 100 // nearest 100ms
    trackEvent(makeEvent(ctx(), {
      event_name: 'app_launched',
      time_to_first_window_ms: rounded
    }))
  }

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', onLoad)
  } else {
    onLoad()
  }
}

// ---------------------------------------------------------------------------
// PTY spawn latency
// ---------------------------------------------------------------------------

/** Call at the start of the pane:spawn IPC handler (before PTY is created) */
export function recordPtySpawnStart(paneId: string): void {
  ptySpawnStartTimes.set(paneId, Date.now())
}

/**
 * Call from the PTY's onData callback, the first time data arrives.
 * Fires `pty_spawned` with the spawn latency, then cleans up.
 */
export function recordPtyFirstData(paneId: string): void {
  const start = ptySpawnStartTimes.get(paneId)
  if (start === undefined) return

  // Only fire once per pane
  ptySpawnStartTimes.delete(paneId)

  const elapsedMs = Date.now() - start
  const rounded = Math.round(elapsedMs / 50) * 50 // nearest 50ms
  trackEvent(makeEvent(ctx(), {
    event_name: 'pty_spawned',
    spawn_latency_ms: rounded
  }))
}

/** Clean up tracking entry if a pane closes before first data */
export function clearPtySpawnTracking(paneId: string): void {
  ptySpawnStartTimes.delete(paneId)
}

// ---------------------------------------------------------------------------
// Memory snapshots
// ---------------------------------------------------------------------------

function takeMemorySnapshot(paneCount: number): void {
  if (!isAnalyticsEnabled()) return

  const { heapUsed, external } = process.memoryUsage()
  const heapMb = Math.round(heapUsed / 1024 / 1024 / 10) * 10  // nearest 10MB
  const extMb = Math.round(external / 1024 / 1024 / 10) * 10   // nearest 10MB

  trackEvent(makeEvent(ctx(), {
    event_name: 'memory_snapshot',
    heap_used_mb: heapMb,
    external_mb: extMb,
    pane_count: paneCount
  }))
}

/**
 * Start the 5-minute memory snapshot timer.
 * `getPaneCount` is a callback to avoid importing sessionRegistry here.
 */
export function startMemorySnapshots(getPaneCount: () => number): void {
  if (memorySnapshotTimer) return
  memorySnapshotTimer = setInterval(() => {
    takeMemorySnapshot(getPaneCount())
  }, MEMORY_SNAPSHOT_INTERVAL_MS)
}

export function stopMemorySnapshots(): void {
  if (memorySnapshotTimer) {
    clearInterval(memorySnapshotTimer)
    memorySnapshotTimer = null
  }
}
