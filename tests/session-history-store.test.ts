/**
 * SessionHistoryStore unit tests (PE-06).
 *
 * Verifies persistence of session history entries with mocked electron-store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock electron-store — in-memory map simulating .get() / .set()
// ---------------------------------------------------------------------------

const mockStoreData = new Map<string, unknown>()

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      get(key: string, defaultValue?: unknown): unknown {
        return mockStoreData.has(key) ? mockStoreData.get(key) : defaultValue
      }
      set(key: string, value: unknown): void {
        mockStoreData.set(key, value)
      }
    }
  }
})

import { getSessionHistory, addSessionHistoryEntry } from '../src/main/session-history-store'
import type { SessionHistoryEntry } from '../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  return {
    sessionId: `sess-${Math.random().toString(16).slice(2, 8)}`,
    worktreePath: '/repo/worktree',
    repoName: 'my-repo',
    worktreeName: 'main',
    sessionTitle: null,
    completedAt: Date.now(),
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionHistoryStore', () => {
  beforeEach(() => {
    mockStoreData.clear()
  })

  it('returns empty array when no history exists', () => {
    expect(getSessionHistory()).toEqual([])
  })

  it('adds an entry and retrieves it', () => {
    const entry = makeEntry({ sessionId: 'abc-123', sessionTitle: 'Fix auth bug' })
    addSessionHistoryEntry(entry)

    const history = getSessionHistory()
    expect(history).toHaveLength(1)
    expect(history[0].sessionId).toBe('abc-123')
    expect(history[0].sessionTitle).toBe('Fix auth bug')
  })

  it('prepends new entries (most recent first)', () => {
    const first = makeEntry({ sessionId: 'first', completedAt: 1000 })
    const second = makeEntry({ sessionId: 'second', completedAt: 2000 })

    addSessionHistoryEntry(first)
    addSessionHistoryEntry(second)

    const history = getSessionHistory()
    expect(history).toHaveLength(2)
    expect(history[0].sessionId).toBe('second')
    expect(history[1].sessionId).toBe('first')
  })

  it('deduplicates by sessionId (updates existing entry)', () => {
    const entry = makeEntry({ sessionId: 'dup-id', sessionTitle: 'Original' })
    addSessionHistoryEntry(entry)

    const updated = makeEntry({ sessionId: 'dup-id', sessionTitle: 'Updated' })
    addSessionHistoryEntry(updated)

    const history = getSessionHistory()
    expect(history).toHaveLength(1)
    expect(history[0].sessionTitle).toBe('Updated')
  })

  it('caps entries at 50', () => {
    for (let i = 0; i < 55; i++) {
      addSessionHistoryEntry(makeEntry({ sessionId: `sess-${i}` }))
    }

    const history = getSessionHistory()
    expect(history).toHaveLength(50)
    // Most recent entry should be last added
    expect(history[0].sessionId).toBe('sess-54')
  })

  it('preserves all fields through round-trip', () => {
    const entry: SessionHistoryEntry = {
      sessionId: 'full-test',
      worktreePath: '/home/user/project/wt-1',
      repoName: 'project',
      worktreeName: 'wt-1',
      sessionTitle: 'Implement session resume',
      completedAt: 1710900000000
    }
    addSessionHistoryEntry(entry)

    const history = getSessionHistory()
    expect(history[0]).toEqual(entry)
  })
})
