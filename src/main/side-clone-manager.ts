/**
 * side-clone-manager — lazily provisions a `.worktrees/.merge-staging/`
 * directory per repo for direct-merge publishing (M4) and bulk merge
 * pipelines (M5).
 *
 * Why a side-clone:
 *   - The user's main repo can be in any state — uncommitted edits,
 *     unpushed commits, mid-rebase, you name it. Trying to merge into
 *     the user's `main` checkout would either fail outright or
 *     destabilise their working tree.
 *   - The side-clone is a fresh `git worktree add` rooted at the same
 *     repo's `.git` (NOT a clone — git worktrees share objects), so it
 *     costs nothing in disk and stays in lockstep with `main` by
 *     fetching from origin.
 *   - All write operations (merge, push) happen in the side-clone. The
 *     user's primary checkout is never touched.
 *
 * Concurrency:
 *   - One side-clone per repo (M5's bulk pipeline serialises merges
 *     within a repo via the per-repo mutex below).
 *   - `ensure()` is idempotent and safe to call concurrently — only the
 *     first caller actually creates the directory; subsequent callers
 *     wait on the same promise.
 *
 * Lifecycle:
 *   - Lazy-created on first `ensure()`.
 *   - Survives across publish operations within a session.
 *   - GC at session-end or when no agents in the repo have pending
 *     publishes (M5 wires this).
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execFileAsync = promisify(execFile)

/** Subdirectory inside the main repo's `.worktrees/` where the side-
 *  clone lives. The leading dot keeps it out of the kanban repo card's
 *  agent list (which already filters `.worktrees/wt-*`). */
const SIDE_CLONE_DIRNAME = '.merge-staging'

/**
 * Per-repo state held by the manager. The mutex queue ensures that
 * concurrent `withSideClone(...)` calls on the same repo run serially —
 * critical for M5's bulk merge pipeline where dozens of agents could
 * try to merge into base at once.
 */
interface RepoState {
  /** Resolved absolute path to the side-clone root, once created. */
  sideClonePath: string
  /** Promise that resolves once `ensure()` has finished provisioning. */
  ready: Promise<void>
  /** Tail of the mutex queue. Each new `withSideClone` chains here so
   *  callers see strict FIFO ordering. */
  queueTail: Promise<unknown>
}

export class SideCloneManager {
  /** Keyed by canonical absolute repo path. */
  private readonly states = new Map<string, RepoState>()

  /**
   * Provision the side-clone for the given repo if it doesn't exist
   * yet. Returns the absolute path. Idempotent; safe to call from
   * multiple call sites concurrently.
   *
   * Implementation note: we use `git worktree add --detach` so the
   * side-clone starts in a detached-HEAD state. Operations that need a
   * branch (like `merge-runner`) explicitly checkout the base branch
   * inside the side-clone before doing work.
   */
  async ensure(repoPath: string): Promise<string> {
    const canonical = path.resolve(repoPath)
    const existing = this.states.get(canonical)
    if (existing) {
      await existing.ready
      return existing.sideClonePath
    }

    const sideClonePath = path.join(canonical, '.worktrees', SIDE_CLONE_DIRNAME)
    const ready = this.provisionSideClone(canonical, sideClonePath)
    this.states.set(canonical, {
      sideClonePath,
      ready,
      queueTail: Promise.resolve()
    })
    await ready
    return sideClonePath
  }

  private async provisionSideClone(repoPath: string, sideClonePath: string): Promise<void> {
    // If the side-clone already exists from a prior session, validate
    // it's a real git worktree (not e.g. a stale directory from a
    // crashed previous run). If it's broken, rebuild.
    const exists = await fs.stat(sideClonePath).then(() => true).catch(() => false)
    if (exists) {
      try {
        await execFileAsync('git', ['rev-parse', '--git-dir'], {
          cwd: sideClonePath,
          timeout: 5_000
        })
        return // healthy
      } catch {
        // Broken — remove and rebuild.
        await this.removeSideClone(repoPath, sideClonePath)
      }
    }

    // Make the parent dir if needed.
    await fs.mkdir(path.dirname(sideClonePath), { recursive: true })

    // Create the side-clone as a detached worktree off HEAD. The
    // merge-runner switches to the base branch before doing real work.
    await execFileAsync(
      'git',
      ['worktree', 'add', '--detach', sideClonePath],
      { cwd: repoPath, timeout: 30_000 }
    )
  }

  /**
   * Run `fn` with exclusive access to the repo's side-clone. Calls are
   * serialised per repo. Returns whatever `fn` returns.
   *
   * Usage:
   *   const result = await mgr.withSideClone(repoPath, async (sidePath) => {
   *     // do merge work in sidePath
   *     return { ok: true }
   *   })
   */
  async withSideClone<T>(
    repoPath: string,
    fn: (sideClonePath: string) => Promise<T>
  ): Promise<T> {
    const canonical = path.resolve(repoPath)
    // Make sure the side-clone exists first (also seeds repo state).
    const sideClonePath = await this.ensure(canonical)
    const state = this.states.get(canonical)!

    // Chain onto the queue tail. We resolve our turn when prior work
    // settles (success or failure — we don't propagate predecessors'
    // errors), then run our `fn`, then advance the tail.
    const myTurn = state.queueTail.catch(() => undefined).then(() => fn(sideClonePath))
    state.queueTail = myTurn.catch(() => undefined)
    return myTurn
  }

  /**
   * Remove the side-clone for this repo, e.g. on workspace close or
   * when no panes in the repo have pending publishes. Idempotent.
   * Best-effort: if removal fails, the directory stays around but the
   * map entry is dropped so the next `ensure()` rebuilds.
   */
  async gc(repoPath: string): Promise<void> {
    const canonical = path.resolve(repoPath)
    const state = this.states.get(canonical)
    if (!state) return
    // Wait for any in-flight operation to finish before tearing down.
    await state.queueTail.catch(() => undefined)
    await this.removeSideClone(canonical, state.sideClonePath)
    this.states.delete(canonical)
  }

  private async removeSideClone(repoPath: string, sideClonePath: string): Promise<void> {
    // `git worktree remove --force` cleans up the worktree registration
    // AND the directory. Falls back to recursive rmdir if git refuses
    // (e.g., the registration is gone but the dir lingers).
    await execFileAsync(
      'git',
      ['worktree', 'remove', '--force', sideClonePath],
      { cwd: repoPath, timeout: 10_000 }
    ).catch(async () => {
      await fs.rm(sideClonePath, { recursive: true, force: true })
    })
    // Prune any stale registrations — defensive against partial
    // cleanups from crashes.
    await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath, timeout: 5_000 })
      .catch(() => null)
  }
}
