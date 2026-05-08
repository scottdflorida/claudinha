/**
 * discard-engine — drops a turn-commit from the worktree branch and
 * rebases dependent turns onto the new parent. Per-decision-9.6 (research
 * §6, plan §5), discard is the only "remove" verb in v2 — there is no
 * separate Undo. Always destructive, always confirmed.
 *
 * Two modes:
 *
 *   1. Clean discard (no dependent conflict):
 *      - The dropped turn has zero or more dependent turns above it.
 *      - We run `git rebase --onto <turn-parent> <turn-sha>` which replays
 *        the dependents onto the parent. If git replays cleanly, only the
 *        selected turn is removed; the dependents are rewritten with new
 *        parent shas but their content is intact.
 *
 *   2. Cascade discard (dependent replay conflicts):
 *      - The replay produces a merge conflict. We abort the rebase and
 *        return the dependent turn IDs to the renderer with
 *        `cascadeRequired: true`.
 *      - The renderer re-prompts: "Discarding T2 also requires discarding
 *        T3 and T4 because their replay conflicts. Continue?"
 *      - If the user confirms (`cascadeConfirmed: true`), we run
 *        `git reset --hard <turn-parent>`, which drops the selected turn
 *        AND every dependent in one shot. The reflog still has the dropped
 *        commits for ~30 days.
 *
 * Sidecar persistence:
 *   Each successful discard writes one entry per dropped turn into
 *   `<worktreePath>/.claudinha-turns.json` so the projection / telemetry
 *   can mark the turn as `discarded` even though it's gone from `git log`.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { BrowserWindow } from 'electron'
import {
  detectMainBranch,
  getCurrentBranch,
  runGitWithLockRetry
} from './git-status'
import {
  broadcastTurnsUpdated,
  projectTurnsForPane,
  readDiscardedSidecar,
  writeDiscardedSidecar
} from './turn-projection'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import { IPC } from '../shared/ipc-channels'
import type { TurnPendingActionPayload } from '../shared/ipc-channels'
import type { Turn, TurnPendingAction } from '../shared/types'

const execFileAsync = promisify(execFile)

export interface DiscardResult {
  ok: boolean
  /** Set when the rebase failed due to dependent conflict and the renderer
   *  must re-prompt with `cascadeConfirmed: true`. */
  cascadeRequired?: boolean
  /** Dependent turn IDs (newer than the selected one) that would also need
   *  to be discarded if the user confirms cascade. Populated alongside
   *  `cascadeRequired`. Order: oldest dependent first. */
  dependentTurnIds?: string[]
  error?: string
  errorKind?: 'turn-not-found' | 'unsupported-state' | 'rebase-failed' | 'reset-failed' | 'unknown'
}

/**
 * Discard a turn from the worktree branch.
 *
 * @see plan §5 discard-engine, plan §11 risk #4 (turn-projection stale-on-mid-edit).
 */
export async function discardTurn(args: {
  worktreePath: string
  paneId: string
  windowId: string
  windowManager: WindowManager
  sessionRegistry: SessionRegistry
  turnId: string
  /** When true, accept dropping all dependents in one shot via reset. */
  cascadeConfirmed: boolean
}): Promise<DiscardResult> {
  const {
    worktreePath, paneId, windowId, windowManager, sessionRegistry,
    turnId, cascadeConfirmed
  } = args

  const baseBranch = await detectMainBranch(worktreePath)
  const currentBranch = await getCurrentBranch(worktreePath)
  if (!baseBranch || !currentBranch) {
    return { ok: false, error: 'could not resolve base/current branch', errorKind: 'unknown' }
  }

  const projection = await projectTurnsForPane(worktreePath, paneId, baseBranch, currentBranch)
  const target = projection.find((t) => t.id === turnId)
  if (!target) {
    return { ok: false, error: 'turn not found in projection', errorKind: 'turn-not-found' }
  }

  // Discard is only supported for `open` and `pushed` turns. Everything
  // else (merged / shipped / pr-open / superseded / discarded) is either
  // already-shared work or already gone, and the renderer should refuse
  // to surface the verb. Defensive guard here in case of stale state.
  if (target.state !== 'open' && target.state !== 'pushed') {
    return {
      ok: false,
      error: `discarding a turn in '${target.state}' state is not supported`,
      errorKind: 'unsupported-state'
    }
  }
  if (!target.parentCommitSha) {
    return { ok: false, error: 'target turn has no parent commit', errorKind: 'unknown' }
  }

  const dependents = projection.filter((t) => t.index > target.index)
  const isTipDiscard = dependents.length === 0

  // Mark the pane busy so the modal can disable surfaces.
  const pending: TurnPendingAction = { kind: 'discarding', turnId }
  setPendingAction(sessionRegistry, paneId, pending)
  broadcastPendingAction(windowManager, windowId, paneId, pending)

  // The user may have unstaged changes in the working tree (edits made
  // after the auto-commit fired). git's `reset --hard` would destroy
  // them, and `rebase --onto` would refuse outright. Stash them first;
  // pop after the discard so the user's mid-flight work is preserved.
  // If nothing's dirty, the stash push is a no-op.
  const stashed = await pushDirtyStash(worktreePath)

  try {
    let droppedTurns: Turn[] = []

    if (isTipDiscard) {
      // No dependents — just reset to the parent. Cheaper than a rebase
      // and has no possible conflict path. The pre-stash above already
      // saved any dirty content; the pop after will restore it.
      const resetErr = await runGitWithLockRetry(
        ['reset', '--hard', target.parentCommitSha],
        { cwd: worktreePath }
      )
      if (resetErr) return { ok: false, error: resetErr, errorKind: 'reset-failed' }
      droppedTurns = [target]
    } else if (cascadeConfirmed) {
      // Cascade requested up front (or after first attempt's conflict
      // prompt). Reset to the parent and accept losing every dependent.
      const resetErr = await runGitWithLockRetry(
        ['reset', '--hard', target.parentCommitSha],
        { cwd: worktreePath }
      )
      if (resetErr) return { ok: false, error: resetErr, errorKind: 'reset-failed' }
      droppedTurns = [target, ...dependents]
    } else {
      // First attempt: try to drop the target and replay dependents on top.
      // `--autostash` is redundant given our explicit pre-stash above,
      // but harmless and safer if pre-stash was a no-op for any reason.
      const env = { ...process.env, GIT_EDITOR: 'true' }
      try {
        await execFileAsync(
          'git',
          ['rebase', '--autostash', '--onto', target.parentCommitSha, target.commitSha],
          { cwd: worktreePath, env, maxBuffer: 4 * 1024 * 1024 }
        )
        droppedTurns = [target]
      } catch (err) {
        // Replay conflict — abort and return the cascade list.
        await runGitWithLockRetry(['rebase', '--abort'], { cwd: worktreePath }).catch(() => null)
        const e = err as { stderr?: string; message?: string }
        return {
          ok: false,
          cascadeRequired: true,
          dependentTurnIds: dependents.map((t) => t.id),
          error:
            `Replay of ${dependents.length} dependent turn${dependents.length === 1 ? '' : 's'} ` +
            `would conflict. Confirm cascade to discard them too. ` +
            `(git: ${(e.stderr ?? e.message ?? 'rebase failed').trim().slice(0, 200)})`,
          errorKind: 'rebase-failed'
        }
      }
    }

    // Record every dropped turn in the sidecar.
    const sidecar = await readDiscardedSidecar(worktreePath)
    const now = Date.now()
    for (const dropped of droppedTurns) {
      sidecar.discarded[dropped.id] = {
        commitSha: dropped.commitSha,
        discardedAt: now,
        originalIndex: dropped.index
      }
    }
    await writeDiscardedSidecar(worktreePath, sidecar)

    // Refresh projection.
    const paneExt = sessionRegistry.getPane(paneId) as
      | { autoCommitEnabled?: boolean }
      | undefined
    void broadcastTurnsUpdated(windowManager, windowId, paneId, {
      worktreePath,
      baseBranch,
      currentBranch,
      autoCommitEnabled: paneExt?.autoCommitEnabled !== false,
      pendingAction: null
    })

    void import('./analytics/turn-instrumentation').then((m) =>
      m.trackTurnDiscarded({ ok: true, cascade: cascadeConfirmed })
    )
    return { ok: true }
  } finally {
    // Restore any pre-discard dirty state. If the pop conflicts (e.g.,
    // the user's dirty edits overlap with the new tip after reset),
    // the stash stays in `git stash list` and we surface a non-fatal
    // warning in the log — the discard itself succeeded.
    if (stashed) {
      const popErr = await runGitWithLockRetry(['stash', 'pop'], { cwd: worktreePath })
      if (popErr) {
        console.warn(
          `[discard-engine] pre-discard stash pop conflicted; the stash remains in 'git stash list'. ` +
          `Resolve manually with 'git stash pop'. Detail: ${popErr.slice(0, 200)}`
        )
      }
    }
    setPendingAction(sessionRegistry, paneId, null)
    broadcastPendingAction(windowManager, windowId, paneId, null)
  }
}

/**
 * Push any current working-tree dirty state into a stash so a
 * subsequent `git reset --hard` / `git rebase` doesn't refuse or
 * destroy the user's edits.
 *
 * Returns `true` when a stash was created (so the caller knows to pop
 * after), `false` when the tree was clean (the stash command would
 * have surfaced "No local changes to save" — we treat that as a no-op).
 *
 * Includes untracked files (`-u`) so net-new files in the worktree
 * survive the round-trip.
 */
async function pushDirtyStash(worktreePath: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'git',
      ['stash', 'push', '-u', '-m', 'claudinha:pre-discard-dirty', '--quiet'],
      { cwd: worktreePath, maxBuffer: 1024 * 1024 }
    )
    const out = (stdout + stderr).toLowerCase()
    return !out.includes('no local changes')
  } catch (err) {
    // `git stash` returns non-zero with `--quiet` only on real errors.
    // "No local changes" is a normal exit-0 path on modern git; the
    // older "no local changes" non-zero exit is what we'd see on a
    // clean tree. Either way, treat as "no stash needed."
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('no local changes')) return false
    console.warn('[discard-engine] pre-discard stash push failed:', msg)
    return false
  }
}

function setPendingAction(
  sessionRegistry: SessionRegistry,
  paneId: string,
  pendingAction: TurnPendingAction | null
): void {
  const pane = sessionRegistry.getPane(paneId)
  if (!pane) return
  ;(pane as { pendingAction?: TurnPendingAction | null }).pendingAction = pendingAction
}

function broadcastPendingAction(
  windowManager: WindowManager,
  windowId: string,
  paneId: string,
  pendingAction: TurnPendingAction | null
): void {
  const win: BrowserWindow | undefined = windowManager.getWindow(windowId)
  if (!win || win.isDestroyed()) return
  const payload: TurnPendingActionPayload = { paneId, pendingAction }
  win.webContents.send(IPC.TURN_PENDING_ACTION, payload)
}
