/**
 * merge-runner — perform a direct merge from a worktree branch onto the
 * base branch, in a side-clone, and push the result to origin.
 *
 * Per plan §5: side-clone-driven direct merges that don't require a
 * clean main. The flow:
 *
 *   1. `side-clone-manager.withSideClone` to get exclusive access
 *      (per-repo serialisation).
 *   2. Inside the side-clone:
 *        a. `git fetch origin <base> <worktree-branch>` — sync both refs.
 *        b. `git checkout <base>`.
 *        c. `git reset --hard origin/<base>` — start from a clean
 *           remote-tracking tip so any local-only commits in the side-
 *           clone (from a prior run) don't pollute history.
 *        d. `git merge --ff-only origin/<worktree-branch>` if possible;
 *           else fall back to `--no-ff` if the user requested it. We
 *           default to `--ff-only` because it's the safest semantics:
 *           the merge fails if the worktree branch doesn't fast-forward
 *           past base, and the caller can decide whether to retry as
 *           `--no-ff` (creates an explicit merge commit) or refuse.
 *        e. `git push origin <base>` — publish the new tip.
 *   3. Best-effort fast-forward of the user's primary main checkout if
 *      it's clean (so they don't have to manually `git pull`). If their
 *      main is dirty, skip — origin already has the update; their next
 *      pull picks it up.
 *
 * Conflict handling:
 *   - On merge conflict in the side-clone: `git merge --abort`, return
 *     `kind: 'conflict'` with the conflicting paths.
 *   - On push rejection (origin moved between fetch and push): return
 *     `kind: 'push-rejected'`. M5's bulk pipeline retries by re-fetching
 *     and merging again; M4's per-pane direct-merge surfaces the error.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import type { SideCloneManager } from './side-clone-manager'
import { runGitWithLockRetry } from './git-status'

const execFileAsync = promisify(execFile)

export interface DirectMergeResult {
  ok: boolean
  /** Sha of the resulting commit on `origin/<base>` after the merge. */
  pushedSha?: string
  /** Conflicting file paths (when kind === 'conflict'). */
  conflicts?: string[]
  error?: string
  errorKind?: 'fetch-failed' | 'checkout-failed' | 'conflict' | 'merge-failed' | 'push-rejected' | 'unknown'
}

/**
 * Run a direct merge of `worktreeBranch` into `baseBranch`, push
 * `baseBranch` to origin, and best-effort fast-forward the user's main
 * checkout. The user's primary checkout is never modified beyond the
 * optional best-effort fast-forward (and only when their tree is clean).
 */
export async function runDirectMerge(args: {
  sideCloneManager: SideCloneManager
  /** Absolute path to the user's primary repo checkout. */
  repoPath: string
  /** The branch to merge FROM (e.g., `wt-abc123`). */
  worktreeBranch: string
  /** The branch to merge INTO (e.g., `main`). */
  baseBranch: string
  /** When true, allow `--no-ff` if `--ff-only` rejects. Default false. */
  allowNoFastForward?: boolean
}): Promise<DirectMergeResult> {
  const {
    sideCloneManager, repoPath, worktreeBranch, baseBranch,
    allowNoFastForward = false
  } = args

  return sideCloneManager.withSideClone(repoPath, async (sidePath) => {
    // 1. Fetch both refs. Don't `--prune` — the side-clone is internal,
    //    we don't want to invent ref-removal semantics here.
    try {
      await execFileAsync(
        'git',
        ['fetch', 'origin', baseBranch, worktreeBranch],
        { cwd: sidePath, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
      )
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      return {
        ok: false,
        error: (e.stderr ?? e.message ?? 'fetch failed').trim().slice(0, 400),
        errorKind: 'fetch-failed'
      }
    }

    // 2. Stay detached pointing at `origin/<base>`. Reusing the base
    //    branch name in the side-clone would conflict with the user's
    //    primary checkout (a branch can only be checked out in one
    //    worktree of a repo at a time). Detached HEAD avoids the
    //    collision and lets us push via `HEAD:<base>` in step 4.
    const checkoutErr = await runGitWithLockRetry(
      ['checkout', '--detach', `origin/${baseBranch}`],
      { cwd: sidePath, timeout: 30_000 }
    )
    if (checkoutErr) {
      return {
        ok: false,
        error: `checkout failed: ${checkoutErr}`,
        errorKind: 'checkout-failed'
      }
    }
    // Defensive: hard reset to origin's tip in case the detach left
    // any in-flight state from a prior run.
    await runGitWithLockRetry(
      ['reset', '--hard', `origin/${baseBranch}`],
      { cwd: sidePath, timeout: 15_000 }
    ).catch(() => null)

    // 3. Try fast-forward merge first.
    const ffMerge = await runGitWithLockRetry(
      ['merge', '--ff-only', `origin/${worktreeBranch}`],
      { cwd: sidePath, timeout: 60_000 }
    )
    if (ffMerge !== null) {
      // FF refused. Either the worktree branch doesn't fast-forward
      // (base has commits the worktree doesn't), or there's a conflict.
      // Distinguish by the message — git surfaces "Not possible to
      // fast-forward" for divergence and the standard merge-conflict
      // message otherwise.
      if (/not possible to fast-forward|non-fast-forward/i.test(ffMerge)) {
        if (allowNoFastForward) {
          // Fall through to no-ff merge.
        } else {
          return {
            ok: false,
            error:
              `worktree branch '${worktreeBranch}' doesn't fast-forward onto '${baseBranch}'. ` +
              `Either rebase the worktree on top of ${baseBranch} first, or pass allowNoFastForward.`,
            errorKind: 'merge-failed'
          }
        }
      } else {
        // Treat as conflict — but ff-only never produces conflicts (it
        // refuses before touching files). Still surface the message.
        return {
          ok: false,
          error: ffMerge.trim().slice(0, 400),
          errorKind: 'merge-failed'
        }
      }
    }

    // No-ff fallback.
    if (ffMerge !== null && allowNoFastForward) {
      const noffMerge = await runGitWithLockRetry(
        ['merge', '--no-ff', '--no-edit', `origin/${worktreeBranch}`],
        { cwd: sidePath, timeout: 60_000 }
      )
      if (noffMerge !== null) {
        // Conflict — capture the file list, abort, return.
        const conflicts = await readConflictPaths(sidePath)
        await runGitWithLockRetry(['merge', '--abort'], { cwd: sidePath, timeout: 15_000 })
          .catch(() => null)
        return {
          ok: false,
          conflicts,
          error: `merge conflicts in ${conflicts.length} file${conflicts.length === 1 ? '' : 's'}`,
          errorKind: 'conflict'
        }
      }
    }

    // 4. Push the merged base. We're in detached HEAD; explicit refspec
    //    `HEAD:<base>` updates `origin/<base>` to whatever HEAD now
    //    points at.
    const pushErr = await runGitWithLockRetry(
      ['push', 'origin', `HEAD:${baseBranch}`],
      { cwd: sidePath, timeout: 60_000 }
    )
    if (pushErr) {
      // Push rejected — origin moved between fetch and push, or auth
      // failure. Don't try to recover; surface the error.
      return {
        ok: false,
        error: pushErr.trim().slice(0, 400),
        errorKind: 'push-rejected'
      }
    }

    // 5. Capture the resulting sha.
    const { stdout: shaOut } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: sidePath, timeout: 5_000 }
    )
    const pushedSha = shaOut.trim()

    // 6. Best-effort fast-forward the user's primary main checkout.
    //    Skipped on dirty trees or any failure — origin already has the
    //    update so the user's next `git pull` picks it up.
    void bestEffortFastForwardPrimary(repoPath, baseBranch, pushedSha).catch(() => null)

    return { ok: true, pushedSha }
  })
}

async function readConflictPaths(sidePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', '--diff-filter=U'],
      { cwd: sidePath, timeout: 10_000 }
    )
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Try to fast-forward the user's primary repo checkout to the new tip
 * if their working tree is clean and they're sitting on the base
 * branch. If anything's off (dirty, on a different branch, mid-rebase),
 * skip silently — origin has the update and the user can `git pull`
 * when they want.
 */
async function bestEffortFastForwardPrimary(
  repoPath: string,
  baseBranch: string,
  targetSha: string
): Promise<void> {
  // Skip if not on the base branch.
  const { stdout: branch } = await execFileAsync(
    'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: repoPath, timeout: 5_000 }
  ).catch(() => ({ stdout: '' }))
  if (branch.trim() !== baseBranch) return

  // Skip if dirty.
  const { stdout: status } = await execFileAsync(
    'git', ['status', '--porcelain'],
    { cwd: repoPath, timeout: 5_000 }
  ).catch(() => ({ stdout: 'unknown' }))
  if (status.trim().length > 0) return

  // Skip if mid-rebase / merge.
  const gitDirOut = await execFileAsync(
    'git', ['rev-parse', '--git-dir'],
    { cwd: repoPath, timeout: 5_000 }
  ).catch(() => ({ stdout: '' }))
  const gitDir = gitDirOut.stdout.trim()
  if (gitDir) {
    const fs = await import('fs/promises')
    const gitDirAbs = path.isAbsolute(gitDir) ? gitDir : path.join(repoPath, gitDir)
    for (const dir of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD']) {
      const exists = await fs.stat(path.join(gitDirAbs, dir)).then(() => true).catch(() => false)
      if (exists) return
    }
  }

  // Try the fast-forward. If origin/<base> is now the targetSha (which
  // the side-clone push just made true), `git merge --ff-only origin/<base>`
  // moves the user's main forward.
  await runGitWithLockRetry(
    ['fetch', 'origin', baseBranch],
    { cwd: repoPath, timeout: 30_000 }
  ).catch(() => null)
  await runGitWithLockRetry(
    ['merge', '--ff-only', `origin/${baseBranch}`],
    { cwd: repoPath, timeout: 15_000 }
  ).catch(() => null)
  // Reference unused parameter so it survives lint passes — useful for
  // future logic that diffs the resulting HEAD against `targetSha`.
  void targetSha
}
