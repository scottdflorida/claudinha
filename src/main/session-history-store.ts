import Store from 'electron-store'
import type { SessionHistoryEntry } from '../shared/types'

// ---------------------------------------------------------------------------
// Session history persistence (PE-06 — session resume support)
//
// Module-level singleton following the analytics-config.ts pattern.
// Stores recently completed sessions so they can be resumed from SpawnDialog.
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 50

interface SessionHistorySchema {
  'session-history.entries': SessionHistoryEntry[]
}

const store = new Store<SessionHistorySchema>({
  name: 'session-history'
})

/**
 * Returns all session history entries, most-recent-first.
 */
export function getSessionHistory(): SessionHistoryEntry[] {
  return store.get('session-history.entries', [])
}

/**
 * Add a completed session to history. Deduplicates by sessionId,
 * prepends the new entry, and caps at MAX_ENTRIES.
 */
export function addSessionHistoryEntry(entry: SessionHistoryEntry): void {
  const entries = store.get('session-history.entries', [])
  // Remove any existing entry with the same sessionId (update scenario)
  const filtered = entries.filter((e) => e.sessionId !== entry.sessionId)
  // Prepend new entry (most recent first)
  filtered.unshift(entry)
  // Cap at max
  if (filtered.length > MAX_ENTRIES) {
    filtered.length = MAX_ENTRIES
  }
  store.set('session-history.entries', filtered)
}
