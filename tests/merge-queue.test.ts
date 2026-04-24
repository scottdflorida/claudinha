/**
 * MergeQueue unit tests.
 *
 * Covers per-repo FIFO serialization, pause/resume, cancellation, and the
 * per-entry completion promise used by CompletionExecutor.
 */

import { describe, it, expect, vi } from 'vitest'
import { MergeQueue, type MergeQueueEntry } from '../src/main/merge-queue'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(paneId: string, repoRoot: string, strategy: 'rebase-ff' | 'squash' | 'merge-commit' = 'rebase-ff'): MergeQueueEntry {
  return { paneId, repoRoot, strategy, enqueuedAt: Date.now() }
}

/**
 * Build a queue whose processor captures processed entries in order and
 * returns a promise the caller can resolve manually. This lets tests drive
 * the queue one step at a time.
 */
function makeManualQueue(): {
  queue: MergeQueue
  processed: MergeQueueEntry[]
  /** Resolve the pending processor promise to advance the queue */
  resolveNext: () => void
} {
  const processed: MergeQueueEntry[] = []
  let pendingResolve: (() => void) | null = null
  const processor = vi.fn(async (entry: MergeQueueEntry) => {
    processed.push(entry)
    await new Promise<void>((resolve) => {
      pendingResolve = resolve
    })
  })
  const queue = new MergeQueue(processor)
  return {
    queue,
    processed,
    resolveNext: () => {
      if (!pendingResolve) throw new Error('No pending processor to resolve')
      const r = pendingResolve
      pendingResolve = null
      r()
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MergeQueue', () => {
  it('processes a single entry immediately when the queue is empty', () => {
    const { queue, processed } = makeManualQueue()
    const { position, active } = queue.enqueue(makeEntry('pane-1', '/repo-a'))
    expect(active).toBe(true)
    expect(position).toBe(0)
    expect(processed).toEqual([expect.objectContaining({ paneId: 'pane-1' })])
  })

  it('queues a second entry behind an active one for the same repo', () => {
    const { queue, processed } = makeManualQueue()
    queue.enqueue(makeEntry('pane-1', '/repo-a'))
    const { position, active } = queue.enqueue(makeEntry('pane-2', '/repo-a'))
    expect(active).toBe(false)
    expect(position).toBe(1)
    // Second entry is NOT processed yet — still behind the active one.
    expect(processed.map((e) => e.paneId)).toEqual(['pane-1'])
  })

  it('processes the next entry after complete() is called', async () => {
    const { queue, processed, resolveNext } = makeManualQueue()
    queue.enqueue(makeEntry('pane-1', '/repo-a'))
    queue.enqueue(makeEntry('pane-2', '/repo-a'))

    expect(processed.map((e) => e.paneId)).toEqual(['pane-1'])
    resolveNext() // let processor for pane-1 finish
    // Let microtasks drain
    await Promise.resolve()
    queue.complete('pane-1')
    expect(processed.map((e) => e.paneId)).toEqual(['pane-1', 'pane-2'])
  })

  it('serializes per repo — different repos do not block each other', () => {
    const { queue, processed } = makeManualQueue()
    queue.enqueue(makeEntry('pane-1', '/repo-a'))
    queue.enqueue(makeEntry('pane-2', '/repo-b'))
    expect(processed.map((e) => e.paneId).sort()).toEqual(['pane-1', 'pane-2'])
  })

  it('pause() halts advancement for that repo until resume()', async () => {
    const { queue, processed, resolveNext } = makeManualQueue()
    queue.enqueue(makeEntry('pane-1', '/repo-a'))
    queue.enqueue(makeEntry('pane-2', '/repo-a'))

    // Simulate a conflict on pane-1: pause the repo, then complete the
    // active slot (but leave the queue paused).
    queue.pause('/repo-a')
    resolveNext()
    await Promise.resolve()
    queue.complete('pane-1')
    // pane-2 should NOT start yet because the repo is paused.
    expect(processed.map((e) => e.paneId)).toEqual(['pane-1'])

    queue.resume('/repo-a')
    expect(processed.map((e) => e.paneId)).toEqual(['pane-1', 'pane-2'])
  })

  it('cancel() removes a queued entry and does not invoke the processor for it', () => {
    const { queue, processed } = makeManualQueue()
    queue.enqueue(makeEntry('pane-1', '/repo-a'))
    queue.enqueue(makeEntry('pane-2', '/repo-a'))

    const cancelled = queue.cancel('pane-2')
    expect(cancelled).toBe(true)
    // After cancel, processor list should still only contain pane-1.
    expect(processed.map((e) => e.paneId)).toEqual(['pane-1'])
  })

  it('cancel() returns false for a pane that is actively processing', () => {
    const { queue } = makeManualQueue()
    queue.enqueue(makeEntry('pane-1', '/repo-a'))
    // pane-1 is now active. cancel() should not remove it from the queue
    // (since it's not in the queue anymore — it's in the active map).
    expect(queue.cancel('pane-1')).toBe(false)
  })

  it('completion promise resolves when the entry finishes', async () => {
    const { queue, resolveNext } = makeManualQueue()
    const { completion } = queue.enqueue(makeEntry('pane-1', '/repo-a'))

    let resolved = false
    completion.then(() => { resolved = true })

    expect(resolved).toBe(false)
    resolveNext()
    await Promise.resolve()
    queue.complete('pane-1')
    await completion
    expect(resolved).toBe(true)
  })

  it('completion promise resolves when a queued entry is cancelled', async () => {
    const { queue } = makeManualQueue()
    queue.enqueue(makeEntry('pane-1', '/repo-a'))
    const { completion } = queue.enqueue(makeEntry('pane-2', '/repo-a'))

    let resolved = false
    completion.then(() => { resolved = true })

    queue.cancel('pane-2')
    await completion
    expect(resolved).toBe(true)
  })

  it('getPosition returns 0 for active, 1-indexed for queued, null for unknown', () => {
    const { queue } = makeManualQueue()
    queue.enqueue(makeEntry('pane-1', '/repo-a'))
    queue.enqueue(makeEntry('pane-2', '/repo-a'))
    queue.enqueue(makeEntry('pane-3', '/repo-a'))
    expect(queue.getPosition('pane-1')).toBe(0)
    expect(queue.getPosition('pane-2')).toBe(1)
    expect(queue.getPosition('pane-3')).toBe(2)
    expect(queue.getPosition('nonexistent')).toBeNull()
  })

  it('isPaused reports paused state correctly', () => {
    const { queue } = makeManualQueue()
    expect(queue.isPaused('/repo-a')).toBe(false)
    queue.pause('/repo-a')
    expect(queue.isPaused('/repo-a')).toBe(true)
    queue.resume('/repo-a')
    expect(queue.isPaused('/repo-a')).toBe(false)
  })
})
