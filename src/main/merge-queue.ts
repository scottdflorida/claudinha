import type { MergeStrategy } from '../shared/types'

/**
 * A single queued merge request. Created by CompletionExecutor when a pane
 * asks to merge but another merge is already in progress for the same repo.
 */
export interface MergeQueueEntry {
  paneId: string
  strategy: MergeStrategy
  repoRoot: string
  enqueuedAt: number
}

/**
 * Callback invoked when the queue is ready to process an entry. The executor
 * provides this at construction time. The processor must eventually call
 * {@link MergeQueue.complete} (success / terminal error) or
 * {@link MergeQueue.pause} (conflict) to either advance the queue or stop it.
 *
 * The processor returns a Promise that resolves when its work is done. The
 * queue uses that promise to back the `completion` handle returned by
 * {@link MergeQueue.enqueue}, so callers (and tests) can `await` until the
 * merge finishes.
 */
export type MergeQueueProcessor = (entry: MergeQueueEntry) => Promise<void>

/**
 * MergeQueue — per-repo FIFO queue that serializes merges for a single
 * repository. Each repo has its own queue keyed by the main repo root path.
 *
 * The queue is paused when a merge encounters a conflict. Pausing halts
 * advancement for that repo until the caller explicitly calls resume(),
 * typically after a Claude-assisted conflict resolution completes.
 *
 * This class has no knowledge of git, PTYs, or IPC — it's a pure state
 * machine. All side effects happen in CompletionExecutor via the processor
 * callback. That separation keeps the queue trivially testable.
 */
/** Deferred promise used to back per-entry completion handles. */
interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

export class MergeQueue {
  /** repoRoot → FIFO list of pending entries (does NOT include the active entry) */
  private readonly queues = new Map<string, MergeQueueEntry[]>()

  /** repoRoot → paneId of the entry currently being processed */
  private readonly active = new Map<string, string>()

  /** repoRoots whose queue is paused (e.g., because of an unresolved conflict) */
  private readonly paused = new Set<string>()

  /** paneId → deferred that resolves when this entry finishes (or is cancelled) */
  private readonly completions = new Map<string, Deferred>()

  constructor(private readonly processor: MergeQueueProcessor) {}

  /**
   * Enqueue a new merge request. If no merge is currently active for this
   * repo and the repo isn't paused, the processor fires immediately and
   * `position` is 0 (active slot). Otherwise the request joins the FIFO and
   * `position` is a 1-indexed queue position (1 = next up after the active
   * entry finishes).
   *
   * The returned `completion` promise resolves once this entry has finished
   * processing for any reason — success, terminal error, conflict pause, or
   * cancellation. This lets callers `await` the actual work when they don't
   * want queue-vs-direct behavior to leak into their API (see how
   * CompletionExecutor.executeMerge uses it).
   */
  enqueue(entry: MergeQueueEntry): { position: number; active: boolean; completion: Promise<void> } {
    const { repoRoot } = entry
    const repoQueue = this.getQueue(repoRoot)
    const alreadyActive = this.active.has(repoRoot)
    const isPaused = this.paused.has(repoRoot)

    const deferred = createDeferred()
    this.completions.set(entry.paneId, deferred)

    if (!alreadyActive && !isPaused) {
      // Free slot, not paused → process right now.
      this.active.set(repoRoot, entry.paneId)
      // Fire-and-forget; the processor's own resolution triggers complete()
      // which will resolve the deferred.
      void this.processor(entry)
      return { position: 0, active: true, completion: deferred.promise }
    }

    // Otherwise queue it.
    repoQueue.push(entry)
    return { position: repoQueue.length, active: false, completion: deferred.promise }
  }

  /**
   * Cancel a pending entry. Returns true if the entry was found and removed
   * from the queue. Does nothing (and returns false) if the paneId is the
   * currently-active entry — the caller must use the executor's abort path
   * for an in-progress merge.
   */
  cancel(paneId: string): boolean {
    for (const [repoRoot, queue] of this.queues.entries()) {
      const idx = queue.findIndex((e) => e.paneId === paneId)
      if (idx !== -1) {
        queue.splice(idx, 1)
        if (queue.length === 0) this.queues.delete(repoRoot)
        this.resolveCompletion(paneId)
        return true
      }
    }
    return false
  }

  /**
   * Mark the current active entry for a repo as complete and advance to the
   * next queued entry (if any and if the repo isn't paused). Called by the
   * executor after a merge succeeds or terminally fails.
   */
  complete(paneId: string): void {
    // Find which repo this pane was active in.
    let repoRoot: string | null = null
    for (const [root, activePaneId] of this.active.entries()) {
      if (activePaneId === paneId) {
        repoRoot = root
        break
      }
    }
    // Always resolve the completion promise even if the pane wasn't active
    // in the queue (defensive — matches the "free the slot" semantics).
    this.resolveCompletion(paneId)
    if (!repoRoot) return

    this.active.delete(repoRoot)
    this.advance(repoRoot)
  }

  /**
   * Resolve (and remove) the deferred completion handle for a pane, if any.
   * Idempotent — safe to call multiple times.
   */
  private resolveCompletion(paneId: string): void {
    const deferred = this.completions.get(paneId)
    if (!deferred) return
    this.completions.delete(paneId)
    deferred.resolve()
  }

  /**
   * Pause a repo's queue. The currently-active entry is left in place; no new
   * entries are processed until resume() is called. Typically called when a
   * merge hits a conflict and the user has the option to trigger Claude
   * resolution or abort.
   */
  pause(repoRoot: string): void {
    this.paused.add(repoRoot)
  }

  /**
   * Resume a paused repo's queue. If there was a previously-active entry it is
   * cleared (the caller is responsible for having finished or aborted it), and
   * the next pending entry is processed.
   */
  resume(repoRoot: string): void {
    this.paused.delete(repoRoot)
    // Advance only if no active entry remains. If an active entry is still in
    // place (e.g., resume() was called before complete()), the caller will
    // complete() it which will in turn call advance().
    if (!this.active.has(repoRoot)) {
      this.advance(repoRoot)
    }
  }

  /**
   * Get the 1-indexed queue position for a pane, or null if not queued.
   * Returns 0 if the pane is the currently-active entry. Useful for rendering
   * "Queued (2nd)" labels in the UI.
   */
  getPosition(paneId: string): number | null {
    for (const activePaneId of this.active.values()) {
      if (activePaneId === paneId) return 0
    }
    for (const queue of this.queues.values()) {
      const idx = queue.findIndex((e) => e.paneId === paneId)
      if (idx !== -1) return idx + 1
    }
    return null
  }

  /** Get all pending entries (not including the active entry) for a repo. */
  getPending(repoRoot: string): readonly MergeQueueEntry[] {
    return this.queues.get(repoRoot) ?? []
  }

  /** Returns true if a repo's queue is currently paused. */
  isPaused(repoRoot: string): boolean {
    return this.paused.has(repoRoot)
  }

  /** Returns the paneId of the active entry for a repo, or null. */
  getActive(repoRoot: string): string | null {
    return this.active.get(repoRoot) ?? null
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private getQueue(repoRoot: string): MergeQueueEntry[] {
    let queue = this.queues.get(repoRoot)
    if (!queue) {
      queue = []
      this.queues.set(repoRoot, queue)
    }
    return queue
  }

  /**
   * Try to process the next entry in a repo's queue. No-ops if paused, if
   * there's already an active entry, or if the queue is empty.
   */
  private advance(repoRoot: string): void {
    if (this.paused.has(repoRoot)) return
    if (this.active.has(repoRoot)) return
    const queue = this.queues.get(repoRoot)
    if (!queue || queue.length === 0) return
    const next = queue.shift()!
    if (queue.length === 0) this.queues.delete(repoRoot)
    this.active.set(repoRoot, next.paneId)
    this.processor(next)
  }
}
