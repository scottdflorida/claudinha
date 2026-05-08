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

import { execFile, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import type { BrowserWindow } from 'electron'
import { detectMainBranch, getCurrentBranch, runGitWithLockRetry } from './git-status'
import { broadcastTurnsUpdated, projectTurnsForPane, readDiscardedSidecar, writeDiscardedSidecar } from './turn-projection'
import { buildLeftSubPatch, getTurnDiff } from './turn-diff'
import { runDirectMerge } from './merge-runner'
import { runOpenPr } from './pr-runner'
import type { SideCloneManager } from './side-clone-manager'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import { IPC } from '../shared/ipc-channels'
import type { TurnPendingActionPayload } from '../shared/ipc-channels'
import type { Turn, TurnPendingAction } from '../shared/types'
import type { HunkSelection } from '../shared/ipc-channels'

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
  /** Absolute path to the user's primary repo checkout. Required for
   *  `direct-merge` so the side-clone-manager can root the staging
   *  worktree in the right repo. May differ from `worktreePath` for
   *  worktree-mode panes; equals it for main-mode. */
  repoPath: string
  paneId: string
  windowId: string
  windowManager: WindowManager
  sessionRegistry: SessionRegistry
  /** Required for `direct-merge` and `pr` paths; nullable so M1's
   *  `push-branch` callers don't have to construct one. */
  sideCloneManager: SideCloneManager | null
  turnIds: string[]
  message: string
  path: 'push-branch' | 'direct-merge' | 'pr' | 'draft-pr'
}): Promise<PublishResult> {
  const {
    worktreePath, repoPath, paneId, windowId, windowManager, sessionRegistry,
    sideCloneManager, turnIds, message, path: publishPath
  } = args

  if (turnIds.length === 0) {
    return { ok: false, error: 'no turns selected', errorKind: 'unknown' }
  }
  if (!message.trim()) {
    return { ok: false, error: 'commit message is empty', errorKind: 'unknown' }
  }
  if ((publishPath === 'direct-merge') && !sideCloneManager) {
    return {
      ok: false,
      error: 'direct-merge requires a sideCloneManager (caller setup error)',
      errorKind: 'unknown'
    }
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

  // All publish paths push the worktree branch (push-branch directly;
  // direct-merge and pr push it first, then merge / open a PR against
  // the result). That means any earlier unpublished turns sitting on
  // the branch land on origin / base too — as ancestors of the squash
  // commit — even though the user didn't select them.
  //
  // Refuse the publish when the selection skips any earlier unpublished
  // turn. The user can either include them in the selection or discard
  // them first.
  {
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
          `${labels}. Publishing the selection would also carry these to origin / the base branch ` +
          `as ancestors of the squashed commit. Include them in the selection or discard them first.`,
        errorKind: 'non-contiguous'
      }
    }
  }

  // For main-mode pushes, divergence-refusal happens BEFORE we rewrite any
  // local history. Otherwise the rebase would land a fresh squash commit
  // on local main even though the push then refuses, leaving the user
  // with rewritten history they didn't ask for.
  const isMainModePreCheck = currentBranch === baseBranch
  if (isMainModePreCheck && publishPath === 'push-branch') {
    const moved = await detectOriginDivergence(worktreePath, currentBranch)
    if (moved) {
      return {
        ok: false,
        error:
          `origin/${currentBranch} has commits your local branch doesn't have. ` +
          `Pushing would either be rejected non-fast-forward or require a force, ` +
          `which is dangerous on the main branch. Fetch + reconcile (pull --rebase ` +
          `or merge) from a terminal, then retry the publish.`,
        errorKind: 'push-rejected'
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

    // 4. Dispatch on publish path.
    const isMainMode = currentBranch === baseBranch
    let prUrl: string | undefined

    if (publishPath === 'push-branch') {
      // Worktree branches: we just rewrote via rebase, so plain `push`
      // would be rejected as non-FF. `--force-with-lease` is the right
      // hammer — only succeeds if origin/<branch> hasn't moved beyond
      // what we last fetched.
      //
      // Main mode (currentBranch === baseBranch): we already pre-checked
      // divergence above the rebase. Plain `push` is the right call here
      // — we won't force on a shared branch even via lease.
      const pushArgs = isMainMode
        ? ['push', 'origin', currentBranch]
        : ['push', '--force-with-lease', 'origin', currentBranch]
      const pushErr = await runGitWithLockRetry(pushArgs, { cwd: worktreePath })
      if (pushErr) {
        return { ok: false, error: pushErr, errorKind: 'push-rejected', publishCommitSha }
      }
    } else if (publishPath === 'direct-merge') {
      if (isMainMode) {
        return {
          ok: false,
          error: 'direct-merge is not available on main-mode panes — already on the base branch',
          errorKind: 'unknown',
          publishCommitSha
        }
      }
      // Push the squashed branch first so origin has the commit, then
      // merge-runner fetches and merges into base via the side-clone.
      const pushErr = await runGitWithLockRetry(
        ['push', '--force-with-lease', 'origin', currentBranch],
        { cwd: worktreePath }
      )
      if (pushErr) {
        return { ok: false, error: pushErr, errorKind: 'push-rejected', publishCommitSha }
      }
      const mergeResult = await runDirectMerge({
        sideCloneManager: sideCloneManager!,
        repoPath,
        worktreeBranch: currentBranch,
        baseBranch,
        allowNoFastForward: false
      })
      if (!mergeResult.ok) {
        return {
          ok: false,
          error: mergeResult.error,
          errorKind: mergeResult.errorKind === 'push-rejected' ? 'push-rejected' : 'unknown',
          publishCommitSha
        }
      }
    } else if (publishPath === 'pr' || publishPath === 'draft-pr') {
      if (isMainMode) {
        return {
          ok: false,
          error: 'PR is not available on main-mode panes — cannot open a PR from the base branch',
          errorKind: 'unknown',
          publishCommitSha
        }
      }
      const prResult = await runOpenPr({
        worktreePath,
        branch: currentBranch,
        baseBranch,
        title: messageSubject(message),
        body: messageBody(message),
        draft: publishPath === 'draft-pr'
      })
      if (!prResult.ok) {
        return {
          ok: false,
          error: prResult.error,
          errorKind: prResult.errorKind === 'push-rejected' ? 'push-rejected' : 'unknown',
          publishCommitSha
        }
      }
      prUrl = prResult.prUrl
    } else {
      return {
        ok: false,
        error: `unknown publish path: ${publishPath}`,
        errorKind: 'unknown',
        publishCommitSha
      }
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

    return { ok: true, publishCommitSha, prUrl }
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
    // `--autostash` so the rebase doesn't refuse on a dirty working tree.
    // The user may have edited files between the auto-commit and clicking
    // Publish; git stashes those before the rebase and restores after.
    await execFileAsync('git', ['rebase', '-i', '--autostash', parent], {
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

/**
 * Split a single turn into two contiguous publish-commits, splitting by
 * hunk. Per plan §5 / U4 default (hunks expanded). The choreography:
 *
 *   1. `git rebase -i <turn-parent>` with GIT_SEQUENCE_EDITOR set to a
 *      script that converts the turn's `pick` line to `edit`. Dependents
 *      stay `pick` so they replay onto the new tip.
 *
 *   2. At the `edit` stop git is paused with the worktree branch parked
 *      at the turn's commit. We:
 *        a. `git reset HEAD^` — un-stage everything but keep working
 *           tree intact (mixed reset).
 *        b. Build the LEFT sub-patch from `hunkSelections` and feed it
 *           to `git apply --check` (validate) then `git apply --cached`
 *           (stage). If `--check` fails, the combination is illegal —
 *           abort the rebase and surface "couldn't apply" inline.
 *        c. `git commit -m <leftMessage>` with a fresh
 *           `Claudinha-Turn-Id` trailer.
 *        d. `git add -A` — stages everything still in the working tree
 *           (the un-selected hunks).
 *        e. `git commit -m <rightMessage>` with another fresh trailer.
 *
 *   3. `git rebase --continue` — replays the dependent turns. If the
 *      replay conflicts, abort and report.
 *
 *   4. Sidecar: record the original turn-id as `discarded` with
 *      `supersededBy: [leftId, rightId]` so the projection marks it
 *      `superseded`.
 *
 * Failure handling along the way always tries `git rebase --abort` so
 * the branch is left unchanged. The pre-rebase HEAD is captured first
 * and verified at the end as a sanity check.
 */
export async function splitTurn(args: {
  worktreePath: string
  paneId: string
  windowId: string
  windowManager: WindowManager
  sessionRegistry: SessionRegistry
  turnId: string
  hunkSelections: HunkSelection[]
  leftMessage: string
  rightMessage: string
}): Promise<{
  ok: boolean
  leftCommitSha?: string
  rightCommitSha?: string
  error?: string
  errorKind?: 'turn-not-found' | 'unsupported-state' | 'empty-side' | 'apply-failed' | 'rebase-failed' | 'replay-failed' | 'unknown'
}> {
  const {
    worktreePath, paneId, windowId, windowManager, sessionRegistry,
    turnId, hunkSelections, leftMessage, rightMessage
  } = args

  if (!leftMessage.trim() || !rightMessage.trim()) {
    return { ok: false, error: 'both commit messages are required', errorKind: 'unknown' }
  }

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
  // Splitting only valid for `open` turns. `pushed` would force-rewrite a
  // branch already on origin (worktree case) or rewrite `origin/<branch>`
  // history (main case) — refuse.
  if (target.state !== 'open') {
    return {
      ok: false,
      error: `splitting a turn in '${target.state}' state is not supported`,
      errorKind: 'unsupported-state'
    }
  }
  if (!target.parentCommitSha) {
    return { ok: false, error: 'target turn has no parent commit', errorKind: 'unknown' }
  }

  // Capture the diff and validate that selections are non-trivial.
  const diffFiles = await getTurnDiff(worktreePath, target.commitSha)
  const totalHunks = diffFiles.reduce((acc, f) => acc + f.hunks.length, 0)
  if (totalHunks === 0) {
    return { ok: false, error: 'turn has no hunks to split (binary-only or empty diff)', errorKind: 'unsupported-state' }
  }
  const leftHunkCount = hunkSelections.reduce((acc, s) => acc + s.leftHunkIndexes.length, 0)
  if (leftHunkCount === 0) {
    return { ok: false, error: 'no hunks selected for the LEFT commit', errorKind: 'empty-side' }
  }
  if (leftHunkCount === totalHunks) {
    return { ok: false, error: 'every hunk is selected for the LEFT — RIGHT would be empty', errorKind: 'empty-side' }
  }

  // Capture pre-rebase HEAD so we can verify the branch state on failure
  // paths.
  const preHead = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })
    .then((r) => r.stdout.trim())

  // Mark pending so the modal disables surfaces.
  const pending: TurnPendingAction = { kind: 'splitting', turnId }
  setPendingAction(sessionRegistry, paneId, pending)
  broadcastPendingAction(windowManager, windowId, paneId, pending)

  try {
    const result = await runSplitChoreography({
      worktreePath,
      target,
      diffFiles,
      hunkSelections,
      leftMessage,
      rightMessage
    })
    if (!result.ok) {
      // Best-effort abort + restore.
      await runGitWithLockRetry(['rebase', '--abort'], { cwd: worktreePath }).catch(() => null)
      // If we left a partial state, force HEAD back to where we started.
      const cur = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })
        .then((r) => r.stdout.trim())
        .catch(() => '')
      if (cur && cur !== preHead) {
        await runGitWithLockRetry(['reset', '--hard', preHead], { cwd: worktreePath }).catch(() => null)
      }
      return { ok: false, error: result.error, errorKind: result.errorKind }
    }

    // Sidecar: mark the original turn as superseded by the two new ones.
    const sidecar = await readDiscardedSidecar(worktreePath)
    sidecar.discarded[target.id] = {
      commitSha: target.commitSha,
      discardedAt: Date.now(),
      originalIndex: target.index,
      supersededBy: [result.leftId, result.rightId]
    }
    await writeDiscardedSidecar(worktreePath, sidecar)

    // Refresh projection so the renderer shows the two new rows.
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

    return {
      ok: true,
      leftCommitSha: result.leftSha,
      rightCommitSha: result.rightSha
    }
  } finally {
    setPendingAction(sessionRegistry, paneId, null)
    broadcastPendingAction(windowManager, windowId, paneId, null)
  }
}

/**
 * The actual rebase-in-progress sequence. Returns either:
 *   - { ok: true, leftSha, rightSha, leftId, rightId }
 *   - { ok: false, error, errorKind }
 *
 * Never throws; caller handles cleanup (abort + reset to preHead).
 */
async function runSplitChoreography(args: {
  worktreePath: string
  target: Turn
  diffFiles: import('../shared/ipc-channels').TurnDiffFile[]
  hunkSelections: HunkSelection[]
  leftMessage: string
  rightMessage: string
}): Promise<
  | { ok: true; leftSha: string; rightSha: string; leftId: string; rightId: string }
  | { ok: false; error: string; errorKind: 'apply-failed' | 'rebase-failed' | 'replay-failed' | 'unknown' }
> {
  const { worktreePath, target, diffFiles, hunkSelections, leftMessage, rightMessage } = args

  // 1. Build the LEFT sub-patch. Empty selection = empty patch = nothing
  //    to commit; the `splitTurn` caller catches that earlier with a
  //    clearer "empty-side" error, but defend here too.
  //
  //    We DON'T pre-flight `git apply --check` here: the index is still
  //    at the target commit (the file's already there), so the check
  //    would always fail with "already exists in index." The actual
  //    `git apply --cached` runs after `git reset HEAD^` lands us at the
  //    parent tree, where the patch is meant to apply. If it fails
  //    there, we abort and surface the message.
  const subPatch = buildLeftSubPatch(diffFiles, hunkSelections)
  if (!subPatch) {
    return { ok: false, error: 'no hunks to apply (selection empty)', errorKind: 'apply-failed' }
  }

  // 2. Build the editor script that flips `pick <target>` → `edit <target>`.
  //
  //    The TODO file uses git's *abbreviated* commit shas (typically 7-12
  //    characters depending on `core.abbrev` and uniqueness needs). We
  //    pass the FULL sha and use awk's `index()` to check whether the
  //    TODO's abbreviation is a prefix of our target — works regardless
  //    of how many chars git chose.
  const editorScript = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'todo="$1"',
    `target="${target.commitSha}"`,
    'awk -v sha="$target" \'',
    '  $1 == "pick" {',
    '    if (index(sha, $2) == 1) sub(/^pick /, "edit ")',
    '    print',
    '    next',
    '  }',
    '  { print }',
    '\' "$todo" > "$todo.tmp"',
    'mv "$todo.tmp" "$todo"'
  ].join('\n') + '\n'

  const scriptPath = await fs.mkdtemp(path.join(os.tmpdir(), 'claudinha-split-'))
    .then((dir) => path.join(dir, 'rebase-editor.sh'))
  await fs.writeFile(scriptPath, editorScript, { mode: 0o755 })
  const env = {
    ...process.env,
    GIT_SEQUENCE_EDITOR: scriptPath,
    GIT_EDITOR: 'true'
  }

  try {
    // 3. Start the interactive rebase. On an `edit` step, git pauses with
    //    the worktree branch parked at the target commit and exits 0 —
    //    leaving the rebase "in progress" until we run `--continue`. So
    //    the success path is: exit 0 + a rebase-in-progress directory
    //    (`.git/rebase-merge/`). A non-zero exit (or exit 0 without an
    //    in-progress rebase) means our editor script failed to match.
    // `--autostash` lets the rebase start even when the working tree has
    // unstaged changes — git stashes them first and pops them after the
    // rebase completes. Critical for UX: users can hit Split mid-turn
    // (e.g., they edited a file after the auto-commit fired but before
    // opening the modal) and the stash round-trip preserves that work.
    // If the stash pop conflicts at the end (rare — the user's dirty
    // state would have to overlap with the new tip), the stash stays in
    // `git stash list` and surfaces in the rebase output.
    let rebaseStartErr: string | null = null
    try {
      await execFileAsync(
        'git',
        ['rebase', '-i', '--autostash', target.parentCommitSha],
        {
          cwd: worktreePath,
          env,
          maxBuffer: 4 * 1024 * 1024
        }
      )
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      rebaseStartErr = (e.stderr ?? e.message ?? 'rebase failed').trim().slice(0, 400)
    }
    const inProgress = await isRebaseInProgress(worktreePath)
    if (!inProgress) {
      return {
        ok: false,
        error: rebaseStartErr
          ?? 'rebase finished without pausing on the target turn (sequence editor failed to match)',
        errorKind: 'rebase-failed'
      }
    }

    // 4. Mixed reset to drop the target's contents from the index while
    //    keeping the working tree intact.
    const resetErr = await runGitWithLockRetry(['reset', 'HEAD^'], { cwd: worktreePath })
    if (resetErr) {
      return { ok: false, error: `git reset HEAD^: ${resetErr}`, errorKind: 'rebase-failed' }
    }

    // 5. Apply LEFT hunks to the index.
    const applyErr = await applyPatchCached(worktreePath, subPatch)
    if (applyErr) {
      return { ok: false, error: `git apply --cached: ${applyErr}`, errorKind: 'apply-failed' }
    }
    // Commit LEFT.
    const leftId = randomUUID()
    const leftMsg = `${leftMessage}\n\nClaudinha-Turn-Id: ${leftId}\n`
    const leftCommitErr = await runGitWithLockRetry(
      ['commit', '-m', leftMsg, '--no-verify'],
      { cwd: worktreePath }
    )
    if (leftCommitErr) {
      return { ok: false, error: `LEFT commit: ${leftCommitErr}`, errorKind: 'rebase-failed' }
    }
    const leftSha = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })
      .then((r) => r.stdout.trim())

    // 6. Stage everything left over and commit RIGHT. `git add -A` here
    //    catches the un-selected hunks; we already filtered .claude/ out
    //    earlier in turn-recorder when the original commit was made, so
    //    the working-tree remainder is user files only.
    const addRightErr = await runGitWithLockRetry(['add', '-A'], { cwd: worktreePath })
    if (addRightErr) {
      return { ok: false, error: `git add -A (right): ${addRightErr}`, errorKind: 'rebase-failed' }
    }
    // Verify right has content.
    const stagedRight = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
      cwd: worktreePath
    }).then((r) => r.stdout.trim())
    if (!stagedRight) {
      return {
        ok: false,
        error: 'after applying LEFT hunks, the RIGHT side had nothing to commit',
        errorKind: 'apply-failed'
      }
    }
    const rightId = randomUUID()
    const rightMsg = `${rightMessage}\n\nClaudinha-Turn-Id: ${rightId}\n`
    const rightCommitErr = await runGitWithLockRetry(
      ['commit', '-m', rightMsg, '--no-verify'],
      { cwd: worktreePath }
    )
    if (rightCommitErr) {
      return { ok: false, error: `RIGHT commit: ${rightCommitErr}`, errorKind: 'rebase-failed' }
    }
    const rightSha = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })
      .then((r) => r.stdout.trim())

    // 7. Continue the rebase to replay dependents.
    try {
      await execFileAsync('git', ['rebase', '--continue'], {
        cwd: worktreePath,
        env,
        maxBuffer: 4 * 1024 * 1024
      })
    } catch (err) {
      // Replay conflict — abort. The caller will reset to preHead.
      const e = err as { stderr?: string; message?: string }
      return {
        ok: false,
        error:
          'replay of dependents conflicted: ' +
          (e.stderr ?? e.message ?? 'unknown').trim().slice(0, 300),
        errorKind: 'replay-failed'
      }
    }

    return { ok: true, leftSha, rightSha, leftId, rightId }
  } finally {
    try {
      await fs.unlink(scriptPath)
      await fs.rmdir(path.dirname(scriptPath))
    } catch { /* ignore */ }
  }
}

async function applyPatchCached(worktreePath: string, patch: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const proc = spawn(
      'git',
      ['apply', '--cached'],
      { cwd: worktreePath, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('close', (code: number) => {
      resolve(code === 0 ? null : (stderr.trim() || `git apply --cached exited ${code}`))
    })
    proc.on('error', (err: Error) => resolve(err.message))
    proc.stdin?.end(patch)
  })
}

async function isRebaseInProgress(worktreePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--git-dir'],
      { cwd: worktreePath }
    )
    const gitDir = path.isAbsolute(stdout.trim())
      ? stdout.trim()
      : path.join(worktreePath, stdout.trim())
    return (await fs.stat(path.join(gitDir, 'rebase-merge')).catch(() => null)) !== null
      || (await fs.stat(path.join(gitDir, 'rebase-apply')).catch(() => null)) !== null
  } catch {
    return false
  }
}

/** First line of a commit message. Used as the PR title. */
function messageSubject(message: string): string {
  return message.split('\n')[0]?.trim() ?? message
}

/** Body of a commit message (everything after the first line + blank
 *  line). May be empty. Used as the PR body. */
function messageBody(message: string): string {
  const lines = message.split('\n')
  if (lines.length <= 2) return ''
  return lines.slice(2).join('\n').trim()
}

/**
 * Pre-publish probe used by main-mode pushes: returns true if `origin/<branch>`
 * has commits that the local branch doesn't have. Fetches first so we're not
 * looking at a stale ref.
 *
 * Best-effort: if the fetch or the rev-list fails (offline, no remote, etc.)
 * we return `false` and let the actual push surface whatever error. The
 * caller treats `true` as a hard "refuse to push" signal.
 */
async function detectOriginDivergence(worktreePath: string, branch: string): Promise<boolean> {
  // Refresh the remote ref. Without `--quiet` the fetch noise can leak into
  // logs; ignore non-zero exit (offline, no auth) — we'll fall through to
  // checking whatever ref we have locally.
  await execFileAsync('git', ['fetch', '--quiet', 'origin', branch], {
    cwd: worktreePath,
    maxBuffer: 1024 * 1024
  }).catch(() => null)
  // Verify the remote ref exists (otherwise nothing to compare against —
  // "ahead" is the only relevant direction; we'd push for the first time).
  try {
    await execFileAsync('git', ['rev-parse', '--verify', `refs/remotes/origin/${branch}`], {
      cwd: worktreePath
    })
  } catch {
    return false
  }
  // Count commits in origin/<branch> that the local HEAD doesn't have.
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', `HEAD..origin/${branch}`],
      { cwd: worktreePath }
    )
    return Number.parseInt(stdout.trim(), 10) > 0
  } catch {
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
