/**
 * Unit tests for the new-in-this-pass instrumentation modules:
 *   - workspace-instrumentation (workspace_created/archived/unarchived/deleted_archived)
 *   - completion-instrumentation (merge_completed / pr_opened)
 *   - plan-sequence-instrumentation (plan_sequence_started / plan_sequence_completed)
 *   - system-instrumentation (app_session_started)
 *
 * Mocks mirror tests/analytics/analytics-pipeline.test.ts so consent is forced
 * on and event construction doesn't need a real Electron runtime.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnalyticsEvent } from '../../src/shared/analytics-events'

const capturedEvents: AnalyticsEvent[] = []

vi.mock('electron-store', () => {
  class MockStore {
    private data = new Map<string, unknown>()
    get(key: string, def?: unknown): unknown {
      return this.data.has(key) ? this.data.get(key) : def
    }
    set(key: string, val: unknown): void {
      this.data.set(key, val)
    }
    delete(key: string): void {
      this.data.delete(key)
    }
  }
  return { default: MockStore }
})

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.1.0'),
    getPath: vi.fn(() => '/tmp/test')
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}))

vi.mock('../../src/main/analytics/analytics-config', () => ({
  isAnalyticsEnabled: () => true,
  getInstallationId: () => 'test-install-id',
  getConsentState: () => 'granted'
}))

vi.mock('../../src/main/analytics/analytics-bus', () => ({
  trackEvent: (event: AnalyticsEvent) => {
    capturedEvents.push(event)
  }
}))

import {
  trackWorkspaceCreated,
  trackWorkspaceArchived,
  trackWorkspaceUnarchived,
  trackWorkspaceDeletedArchived
} from '../../src/main/analytics/workspace-instrumentation'
import {
  trackMergeCompleted,
  trackPrOpened
} from '../../src/main/analytics/completion-instrumentation'
import {
  trackPlanSequenceStarted,
  trackPlanSequenceCompleted
} from '../../src/main/analytics/plan-sequence-instrumentation'
import { trackAppSessionStarted } from '../../src/main/analytics/system-instrumentation'

beforeEach(() => {
  capturedEvents.length = 0
})

describe('workspace-instrumentation', () => {
  it('trackWorkspaceCreated emits workspace_created with type + count', () => {
    trackWorkspaceCreated('repo', 3)
    expect(capturedEvents).toHaveLength(1)
    const ev = capturedEvents[0]
    expect(ev.event_name).toBe('workspace_created')
    expect((ev as { workspace_type: string }).workspace_type).toBe('repo')
    expect((ev as { workspace_count: number }).workspace_count).toBe(3)
  })

  it('trackWorkspaceArchived emits workspace_archived with archived_count', () => {
    trackWorkspaceArchived('worktree-branch', 7)
    expect(capturedEvents[0].event_name).toBe('workspace_archived')
    expect((capturedEvents[0] as { archived_count: number }).archived_count).toBe(7)
  })

  it('trackWorkspaceUnarchived emits workspace_unarchived', () => {
    trackWorkspaceUnarchived('general')
    expect(capturedEvents[0].event_name).toBe('workspace_unarchived')
  })

  it('trackWorkspaceDeletedArchived emits workspace_deleted_archived', () => {
    trackWorkspaceDeletedArchived('repo')
    expect(capturedEvents[0].event_name).toBe('workspace_deleted_archived')
  })
})

describe('completion-instrumentation', () => {
  it.each([
    ['succeeded', 'rebase-ff'],
    ['failed', 'squash'],
    ['paused_conflict', 'merge-commit'],
    ['aborted', 'rebase-ff']
  ] as const)('emits merge_completed with outcome=%s strategy=%s', (outcome, strategy) => {
    trackMergeCompleted(outcome, strategy)
    const ev = capturedEvents[0] as { outcome: string; strategy: string; event_name: string }
    expect(ev.event_name).toBe('merge_completed')
    expect(ev.outcome).toBe(outcome)
    expect(ev.strategy).toBe(strategy)
  })

  it('trackPrOpened preserves the draft flag', () => {
    trackPrOpened(true)
    trackPrOpened(false)
    expect(capturedEvents).toHaveLength(2)
    expect((capturedEvents[0] as { draft: boolean }).draft).toBe(true)
    expect((capturedEvents[1] as { draft: boolean }).draft).toBe(false)
  })
})

describe('plan-sequence-instrumentation', () => {
  it('trackPlanSequenceStarted emits the start event', () => {
    trackPlanSequenceStarted()
    expect(capturedEvents[0].event_name).toBe('plan_sequence_started')
  })

  it('trackPlanSequenceCompleted buckets the approved count', () => {
    trackPlanSequenceCompleted('succeeded', 0)
    trackPlanSequenceCompleted('succeeded', 1)
    trackPlanSequenceCompleted('succeeded', 3)
    trackPlanSequenceCompleted('succeeded', 99)
    const buckets = capturedEvents.map(
      (e) => (e as { approved_count_bucket: string }).approved_count_bucket
    )
    expect(buckets).toEqual(['0', '1', '2-5', '6+'])
  })

  it('preserves cancellation and watchdog outcomes', () => {
    trackPlanSequenceCompleted('cancelled', 2)
    trackPlanSequenceCompleted('watchdog_timeout', 5)
    const outcomes = capturedEvents.map((e) => (e as { outcome: string }).outcome)
    expect(outcomes).toEqual(['cancelled', 'watchdog_timeout'])
  })
})

describe('system-instrumentation', () => {
  it('trackAppSessionStarted emits app_session_started with version fields', () => {
    trackAppSessionStarted()
    const ev = capturedEvents[0]
    expect(ev.event_name).toBe('app_session_started')
    // Versions come from process.versions; at least the keys must be strings.
    expect(
      typeof (ev as { electron_version: string }).electron_version
    ).toBe('string')
    expect(typeof (ev as { node_version: string }).node_version).toBe('string')
    expect(typeof (ev as { chrome_version: string }).chrome_version).toBe('string')
  })
})

describe('bucketing helpers round-trip through events', () => {
  it('bucketApprovedCount is deterministic across a range', () => {
    trackPlanSequenceCompleted('succeeded', -5)
    trackPlanSequenceCompleted('succeeded', 0)
    trackPlanSequenceCompleted('succeeded', 1)
    trackPlanSequenceCompleted('succeeded', 5)
    trackPlanSequenceCompleted('succeeded', 6)
    trackPlanSequenceCompleted('succeeded', 100)
    const buckets = capturedEvents.map(
      (e) => (e as { approved_count_bucket: string }).approved_count_bucket
    )
    expect(buckets).toEqual(['0', '0', '1', '2-5', '6+', '6+'])
  })
})
