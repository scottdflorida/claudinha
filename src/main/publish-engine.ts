/**
 * publish-engine — produces "publish commits" from selected turns.
 *
 * M1 scope:
 *   - `squashAndPublish` with `path: 'push-branch'` only. Squashes a
 *     contiguous run of wip-commits into a single message-supplied commit
 *     and pushes the worktree branch to origin.
 *
 * M3 will add `splitTurn` (interactive rebase + hunk apply).
 * M4 will add `path: 'direct-merge'` (side-clone) and `path: 'pr'`
 *   (gh pr create) variants.
 *
 * Why scripted interactive rebase:
 *   - `git rebase -i` is the only built-in path that rewrites a contiguous
 *     run of commits into a squash. We script it via `GIT_SEQUENCE_EDITOR`
 *     so it runs non-interactively in tests + production.
 *   - The commit message of the resulting squash is supplied via `git
 *     commit --amend -m` after the rebase lands on the squash commit.
 *
 * Failure handling:
 *   - HEAD-moved-during-rebase → abort with `git rebase --abort` and
 *     surface the error.
 *   - Push rejected (non-fast-forward) → return the error to the renderer
 *     so the user can pull / merge / force-push by hand.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import type { BrowserWindow } from 'electron'
import { detectMainBranch, getCurrentBranch, runGitWithLockRetry } from './git-status'
import { broadcastTurnsUpdated, projectTurnsForPane } from './turn-projection'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import { IPC } from '../shared/ipc-channels'
import type { TurnPendingActionPayload } from '../shared/ipc-channels'
import type { Turn, TurnPendingAction } from '../shared/types'

const execFileAsync = promisify(execFile)

/** Result envelope for `squashAndPublish`. */
export interface PublishResult {
  ok: boolean
  /** Sha of the resulting publish-commit (after squash + amend). */
  publishCommitSha?: string
  /** Resulting PR URL, when path === 'pr' or 'draft-pr' (M4). */
  prUrl?: string
  error?: string
  /** Tags the failure category for the renderer's error UI. */
  errorKind?: 'non-contiguous' | 'rebase-failed' | 'amend-failed' | 'push-rejected' | 'unknown'
}

/**
 * Squash a contiguous run of turns into a single publish-commit and run
 * the chosen publish path.
 *
 * Contract:
 *   - `turnIds` MUST be in chronological order (oldest first) and
 *     contiguous on the branch. Non-contiguous selections are rejected.
 *   - `message` is the final commit subject + body for the squashed
 *     publish-commit. The caller is responsible for building it.
 *   - `path` is the publish target. M1 only supports `'push-branch'`;
 *     other values return an error.
 */
export async function squashAndPublish(args: {
  worktreePath: string
  paneId: string
  windowId: string
  windowManager: WindowManager
  sessionRegistry: SessionRegistry
  turnIds: string[]
  message: string
  path: 'push-branch' | 'direct-merge' | 'pr' | 'draft-pr'
}): Promise<PublishResult> {
  const {
    worktreePath, paneId, windowId, windowManager, sessionRegistry,
    turnIds, message, path: publishPath
  } = args

  if (publishPath !== 'push-branch') {
    return {
      ok: false,
      error: `publish path '${publishPath}' is not implemented yet (M4 adds direct-merge / pr / draft-pr)`,
      errorKind: 'unknown'
    }
  }
  if (turnIds.length === 0) {
    return { ok: false, error: 'no turns selected', errorKind: 'unknown' }
  }
  if (!message.trim()) {
    return { ok: false, error: 'commit message is empty', errorKind: 'unknown' }
  }

  const baseBranch = await detectMainBranch(worktreePath)
  const currentBranch = await getCurrentBranch(worktreePath)
  if (!baseBranch || !currentBranch) {
    return { ok: false, error: 'could not resolve base/current branch', errorKind: 'unknown' }
  }

  // Resolve the turns and their commits via projection.
  const projection = await projectTurnsForPane(worktreePath, paneId, baseBranch, currentBranch)
  const selected = orderedSelection(projection, turnIds)
  if (!selected) {
    return {
      ok: false,
      error: 'selection must be contiguous on the worktree branch',
      errorKind: 'non-contiguous'
    }
  }

  // Push-branch publishes the entire worktree branch, so any earlier
  // unpublished turns will land on origin too as a side effect of the push.
  // Reject this case explicitly — the user almost certainly didn't intend
  // to publish work they didn't select. M4's `direct-merge` and `pr` paths
  // sidestep this by creating a publish commit in a side-clone and pushing
  // only that.
  if (publishPath === 'push-branch') {
    const oldestSelectedIndex = selected[0]!.index
    const earlierUnpublished = projection.filter(
      (t) => t.index < oldestSelectedIndex && t.state !== 'pushed' && t.state !== 'merged' && t.state !== 'shipped' && t.state !== 'pr-open' && t.state !== 'discarded' && t.state !== 'superseded'
    )
    if (earlierUnpublished.length > 0) {
      const labels = earlierUnpublished
        .map((t) => `Turn ${t.index} (${t.summary || 'no summary'})`)
        .join(', ')
      return {
        ok: false,
        error:
          `Selection skips earlier unpublished turn${earlierUnpublished.length === 1 ? '' : 's'}: ` +
          `${labels}. Push-branch publishes the whole branch, so these would land on origin too. ` +
          `Either include them in the selection, or wait for M4's direct-merge/PR paths which can ` +
          `publish a single squash without dragging earlier turns.`,
        errorKind: 'non-contiguous'
      }
    }
  }

  // Set the pending action so any open TurnsModal disables its surfaces.
  const pending: TurnPendingAction = {
    kind: 'publishing-squash',
    selectedTurnIds: turnIds
  }
  setPendingAction(sessionRegistry, paneId, pending)
  broadcastPendingAction(windowManager, windowId, paneId, pending)

  try {
    // 1. Run the scripted interactive rebase that squashes selected.
    const oldestCommit = selected[0]!.commitSha
    const parent = selected[0]!.parentCommitSha
    if (!parent) {
      return { ok: false, error: 'oldest selected turn has no parent commit', errorKind: 'unknown' }
    }
    const squashCount = selected.length

    const rebaseErr = await scriptedRebaseSquash({
      worktreePath,
      parent,
      oldestCommit,
      squashCount
    })
    if (rebaseErr) {
      // Best-effort abort; rebaseSquash may have already aborted.
      await runGitWithLockRetry(['rebase', '--abort'], { cwd: worktreePath }).catch(() => null)
      return { ok: false, error: rebaseErr, errorKind: 'rebase-failed' }
    }

    // 2. Amend the resulting tip commit's message to the user's text.
    const amendErr = await runGitWithLockRetry(
      ['commit', '--amend', '-m', message, '--no-verify'],
      { cwd: worktreePath }
    )
    if (amendErr) {
      return { ok: false, error: amendErr, errorKind: 'amend-failed' }
    }

    // 3. Capture the new HEAD as the publish-commit sha.
    const publishCommitSha = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath
    }).then((r) => r.stdout.trim())

    // 4. Push the worktree branch.
    //    `--force-with-lease` is the right hammer here: we just rewrote the
    //    branch via rebase, so a regular `push` will be rejected as non-FF.
    //    `--force-with-lease` only succeeds if origin/<branch> hasn't moved
    //    beyond what we last fetched, so we won't blow away a teammate's
    //    push that happened in the meantime.
    const pushErr = await runGitWithLockRetry(
      ['push', '--force-with-lease', 'origin', currentBranch],
      { cwd: worktreePath }
    )
    if (pushErr) {
      return { ok: false, error: pushErr, errorKind: 'push-rejected', publishCommitSha }
    }

    // 5. Refresh projection so the renderer sees the new state.
    const refreshedPane = sessionRegistry.getPane(paneId) as
      | { autoCommitEnabled?: boolean }
      | undefined
    void broadcastTurnsUpdated(windowManager, windowId, paneId, {
      worktreePath,
      baseBranch,
      currentBranch,
      autoCommitEnabled: refreshedPane?.autoCommitEnabled !== false,
      pendingAction: null
    })

    return { ok: true, publishCommitSha }
  } finally {
    setPendingAction(sessionRegistry, paneId, null)
    broadcastPendingAction(windowManager, windowId, paneId, null)
  }
}

/**
 * Confirm `turnIds` resolves to a contiguous run on the worktree branch
 * (oldest → newest). Returns the matched Turn[] in branch order, or null
 * when the selection is not contiguous.
 *
 * Contiguity rule: pick the indexes of the selected turns inside the
 * projection (which is already in branch order). Sort. Verify they form a
 * consecutive range.
 */
function orderedSelection(projection: Turn[], turnIds: string[]): Turn[] | null {
  const idSet = new Set(turnIds)
  if (idSet.size !== turnIds.length) return null // duplicates
  const matchedIndexes: number[] = []
  for (let i = 0; i < projection.length; i++) {
    if (idSet.has(projection[i]!.id)) matchedIndexes.push(i)
  }
  if (matchedIndexes.length !== idSet.size) return null
  for (let i = 1; i < matchedIndexes.length; i++) {
    if (matchedIndexes[i]! !== matchedIndexes[i - 1]! + 1) return null
  }
  return matchedIndexes.map((i) => projection[i]!)
}

/**
 * Run `git rebase -i <parent>` non-interactively, scripting the editor to
 * pick the first commit and squash the rest. Uses GIT_SEQUENCE_EDITOR so
 * the script is fed only the rebase TODO list (not commit messages).
 *
 * Returns null on success, error string on failure.
 */
async function scriptedRebaseSquash(args: {
  worktreePath: string
  parent: string
  oldestCommit: string
  squashCount: number
}): Promise<string | null> {
  const { worktreePath, parent, squashCount } = args

  // Build the editor script. It rewrites the TODO file in place: for `pick`
  // lines, leave the first as-is and convert the next (squashCount - 1) to
  // `squash`. Lines past that are left untouched (they're commits NOT in
  // our selection — for example, follow-on turns the user committed after
  // the selection).
  const editorScript = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'todo="$1"',
    `count_to_squash=$((${squashCount} - 1))`,
    'awk -v c="$count_to_squash" \'',
    '  /^pick / && picked < 1 { print; picked = 1; next }',
    '  /^pick / && picked >= 1 && squashed < c { sub(/^pick /, "squash "); print; squashed += 1; next }',
    '  { print }',
    '\' "$todo" > "$todo.tmp"',
    'mv "$todo.tmp" "$todo"'
  ].join('\n') + '\n'

  // Materialise the editor script in a temp file.
  const scriptPath = await fs.mkdtemp(path.join(os.tmpdir(), 'claudinha-seq-'))
    .then((dir) => path.join(dir, 'rebase-editor.sh'))
  await fs.writeFile(scriptPath, editorScript, { mode: 0o755 })

  try {
    // We can't use the lock-retry wrapper here because it doesn't support
    // a custom env block. Use the lower-level execFile and accept a single
    // attempt; index.lock contention during a publish is rare because the
    // user just selected turns to publish in the modal — the poller's
    // typical contention windows are short.
    await execFileAsync('git', ['rebase', '-i', parent], {
      cwd: worktreePath,
      env: {
        ...process.env,
        GIT_SEQUENCE_EDITOR: scriptPath,
        // Force a non-interactive editor for any prompts that fall through
        // (e.g. squash combined-message editor — `git commit --amend` after
        // the rebase replaces the message anyway).
        GIT_EDITOR: 'true'
      },
      maxBuffer: 4 * 1024 * 1024
    })
    return null
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return (e.stderr ?? e.message ?? 'unknown rebase error').trim()
  } finally {
    // Remove the temp script + its parent dir.
    try {
      await fs.unlink(scriptPath)
      await fs.rmdir(path.dirname(scriptPath))
    } catch { /* ignore */ }
  }
}

function setPendingAction(
  sessionRegistry: SessionRegistry,
  paneId: string,
  pendingAction: TurnPendingAction | null
): void {
  const pane = sessionRegistry.getPane(paneId)
  if (!pane) return
  // Stash on the in-memory pane state so other paths see it. SessionRegistry
  // doesn't have a public mutator for this field — write directly. The field
  // is optional in the type so older callsites don't have to spread it.
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
