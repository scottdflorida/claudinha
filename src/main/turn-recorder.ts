/**
 * turn-recorder — auto-commit on Stop hook for the v2 turn-as-commit
 * completion-actions model.
 *
 * Lifecycle:
 *   1. Hook listener fires `Stop` for a worktree pane.
 *   2. We check `pane.autoCommitEnabled` (default on) and `pane.isWorktree`.
 *   3. We check `git status` — if the working tree is clean, no-op.
 *   4. We `git add -A` and produce a `wip(turn-N)` commit on the worktree
 *      branch with a stable UUID trailer (`Claudinha-Turn-Id: <uuid>`).
 *   5. We commit synchronously with a placeholder summary so the renderer
 *      sees the new commit immediately, then asynchronously generate a
 *      Haiku one-liner from the diff and `git commit --amend` the message
 *      (only if HEAD hasn't moved since).
 *   6. We emit `TURN_RECORDED` and a fresh `TURNS_UPDATED` projection so
 *      every open `TurnsModal` for this pane refreshes.
 *
 * Risk mitigations (per plan §11):
 *   - Auto-commit summary call to Haiku adds latency on every Stop
 *     → don't block the wip-commit on the summary; commit with placeholder,
 *       update message via `--amend` once Haiku returns.
 *   - Auto-commit during a turn the user wants to abandon
 *     → the toggle (PANE_AUTO_COMMIT_TOGGLE) lets them disable for the
 *       session; the discard verb (M2) rolls back; reflog catches anything
 *       else.
 */

import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import { CLAUDINHA_INFRASTRUCTURE_DIRS, detectMainBranch, getCurrentBranch, getGitStatus, runGitWithLockRetry } from './git-status'
import { projectTurnsForPane, broadcastTurnsUpdated } from './turn-projection'
import { IPC } from '../shared/ipc-channels'
import type { TurnRecordedPayload } from '../shared/ipc-channels'
import type { Turn } from '../shared/types'

const execFileAsync = promisify(execFile)

/** Trailer key written into every wip-commit message; the projection reads
 *  this back to associate stable UUIDs with otherwise-identical commits. */
export const TURN_ID_TRAILER = 'Claudinha-Turn-Id'

/** Max time we'll wait for the Haiku summary call before giving up and
 *  leaving the placeholder message in place. Tuned to balance UX (the
 *  user may publish the turn before the summary returns) with avoiding a
 *  hung commit on a stalled `claude` process. */
const HAIKU_TIMEOUT_MS = 30_000

/** Cap on how much diff text we feed Haiku. Beyond this we're paying for
 *  tokens that don't help the summary (boilerplate, lockfile noise, etc.)
 *  and the latency tax outweighs the description quality. */
const HAIKU_DIFF_BYTES_CAP = 20_000

/**
 * Result of an auto-commit attempt. Surfaced so callers (mainly tests +
 * future telemetry) can introspect what happened without parsing logs.
 */
export interface AutoCommitResult {
  /** 'committed' = a new wip-commit was created.
   *  'skipped'   = clean tree, toggle off, non-worktree pane, or branch
   *                check failed — no commit produced.
   *  'error'     = the commit attempt failed (git error, etc.). The
   *                error string is in `error`. */
  outcome: 'committed' | 'skipped' | 'error'
  reason?: string
  turn?: Turn
  error?: string
}

/**
 * TurnRecorder — instantiated once at app startup and wired into the
 * hook-listener's Stop callback chain. Stateless besides the references it
 * holds; the per-pane state (turn list, pendingAction) lives in
 * SessionRegistry.PaneState.
 */
export class TurnRecorder {
  /**
   * Per-pane "last skip reason." Populated on every `handleStop` invocation
   * (`null` on commit success). Read by the TURNS_GET handler so the modal's
   * empty state can tell the user *why* no turns were recorded — the most
   * common failure modes (`non-worktree`, `on-base-branch`,
   * `branch-detection-failed`) are silent in production logs but very
   * confusing in the UI.
   */
  private readonly lastSkipReason = new Map<string, string | null>()

  constructor(
    private readonly sessionRegistry: SessionRegistry,
    private readonly windowManager: WindowManager
  ) {}

  /** Returns the most recent skip reason for a pane, or null if the last
   *  invocation succeeded / no invocation has happened yet. */
  getLastSkipReason(paneId: string): string | null {
    return this.lastSkipReason.get(paneId) ?? null
  }

  /**
   * Handle a Stop hook for the given pane. Fire-and-forget from the
   * hook-listener path — never throws.
   */
  async handleStop(paneId: string): Promise<AutoCommitResult> {
    try {
      const result = await this.handleStopInner(paneId)
      // Always log a one-liner so the main-process log shows what
      // happened. Skipped reasons are silent in production but the
      // log is the only diagnostic surface when the modal mysteriously
      // shows no turns. Errors get a louder warn.
      if (result.outcome === 'committed') {
        this.lastSkipReason.set(paneId, null)
        console.log(`[turn-recorder] paneId=${paneId} committed turn ${result.turn?.index} (${result.turn?.commitSha?.slice(0, 8)})`)
      } else if (result.outcome === 'skipped') {
        this.lastSkipReason.set(paneId, result.reason ?? 'unknown')
        console.log(`[turn-recorder] paneId=${paneId} skipped: ${result.reason}`)
      } else {
        this.lastSkipReason.set(paneId, `error: ${result.error ?? 'unknown'}`)
        console.warn(`[turn-recorder] paneId=${paneId} error: ${result.error}`)
      }
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[turn-recorder] paneId=${paneId} threw:`, msg)
      return { outcome: 'error', error: msg }
    }
  }

  private async handleStopInner(paneId: string): Promise<AutoCommitResult> {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return { outcome: 'skipped', reason: 'pane-missing' }

    // Default true — only skip when the user has explicitly toggled it off.
    // Read defensively because the field is optional during M0/M1 transition.
    const autoCommit = (pane as { autoCommitEnabled?: boolean }).autoCommitEnabled
    if (autoCommit === false) {
      return { outcome: 'skipped', reason: 'auto-commit-off' }
    }

    // Check working-tree state. A clean tree means the agent stopped without
    // editing anything — we don't manufacture an empty turn.
    const status = await getGitStatus(pane.worktreePath)
    if (!status?.hasUncommittedChanges) {
      return { outcome: 'skipped', reason: 'clean-tree' }
    }

    // Resolve branches. If we can't determine a base, skip — we don't want
    // to commit on top of detached-HEAD by accident.
    //
    // Main-mode panes (currentBranch === baseBranch) are supported: the
    // projection scopes turns to `origin/<branch>..HEAD` so they're
    // local-only commits awaiting push, and discards/squashes only touch
    // local-only history. The user accepted the risk by spawning the pane
    // on the main repo instead of a worktree.
    const currentBranch = await getCurrentBranch(pane.worktreePath)
    const baseBranch = await detectMainBranch(pane.worktreePath)
    if (!currentBranch || !baseBranch) {
      return { outcome: 'skipped', reason: 'branch-detection-failed' }
    }

    // Compute the next display index (1-based, sequential through visible
    // turns on this branch). Display-only — Turn.id is the stable identity.
    const existingTurns = await projectTurnsForPane(
      pane.worktreePath,
      paneId,
      baseBranch,
      currentBranch
    )
    const nextIndex = existingTurns.length + 1

    const turnId = randomUUID()
    const placeholderSummary = `${status.changedFileCount} file${status.changedFileCount === 1 ? '' : 's'} changed`
    const placeholderMsg = formatTurnCommitMessage(nextIndex, placeholderSummary, turnId)

    // 1. Stage everything, then defensively unstage Claudinha's own
    //    infrastructure paths.
    //
    //    `git add -A` covers tracked + untracked + deletions in one shot.
    //    Per L-062, untracked files need at least intent-to-add to show up
    //    in `git diff` — `git add -A` fully stages them.
    //
    //    Earlier attempt used pathspec exclusion (`-- :!.claude :!.worktrees`)
    //    to avoid staging infra in the first place. That's the right idea
    //    in isolation, but `ensureClaudinhaPathsIgnored` writes both dirs
    //    to `.git/info/exclude` on every worktree we create — and git
    //    refuses to evaluate a pathspec that names an ignored path with
    //    "The following paths are ignored by one of your .gitignore files
    //    [...] Use -f if you really want to add them." That's git treating
    //    *exclusion-only* references as if they were *intent-to-include*,
    //    so the whole `add` errors out before doing anything.
    //
    //    Two-step approach is safer:
    //      a) `git add -A` — adds everything, but the gitignore in
    //         `.git/info/exclude` already prevents `.claude/` and
    //         `.worktrees/` from being added if they're untracked.
    //      b) `git reset HEAD -- .claude .worktrees` — unstages those dirs
    //         in case they're TRACKED from a prior commit (gitignore
    //         doesn't apply to tracked files; e.g. Claude auto-mode
    //         silently writing a permission rule into a tracked
    //         `.claude/settings.local.json`).
    //
    //    Reset on a non-existent path is silent (no error). The empty-
    //    staged-diff check below catches the "all changes were infra"
    //    case so we don't produce empty wip-commits.
    const addErr = await runGitWithLockRetry(['add', '-A'], { cwd: pane.worktreePath })
    if (addErr) {
      return { outcome: 'error', error: `git add -A: ${addErr}` }
    }
    await runGitWithLockRetry(
      ['reset', 'HEAD', '--', ...CLAUDINHA_INFRASTRUCTURE_DIRS],
      { cwd: pane.worktreePath }
    ).catch(() => null)

    // After the exclusion + reset, re-check that there's actually anything
    // staged. The original `getGitStatus` saw dirty *including* infra paths;
    // if all the dirty was infra, we have nothing to commit and skipping
    // here matches the "Stop with no real edits = no turn" intent.
    const stagedDiff = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
      cwd: pane.worktreePath
    }).then((r) => r.stdout.trim()).catch(() => '')
    if (!stagedDiff) {
      return { outcome: 'skipped', reason: 'only-infrastructure-changes' }
    }

    // 2. Commit with placeholder. `--allow-empty` would be wrong here —
    //    we already verified the tree is dirty. Use `--no-verify` since
    //    pre-commit hooks could prompt and we have no terminal.
    const commitErr = await runGitWithLockRetry(
      ['commit', '-m', placeholderMsg, '--no-verify'],
      { cwd: pane.worktreePath }
    )
    if (commitErr) {
      return { outcome: 'error', error: `git commit: ${commitErr}` }
    }

    // 3. Capture the new HEAD sha and parent.
    const commitSha = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: pane.worktreePath
    }).then((r) => r.stdout.trim())
    const parentCommitSha = await execFileAsync('git', ['rev-parse', 'HEAD~1'], {
      cwd: pane.worktreePath
    }).then((r) => r.stdout.trim()).catch(() => '')

    // 4. Build the in-memory Turn record and emit TURN_RECORDED.
    const turn: Turn = {
      id: turnId,
      paneId,
      index: nextIndex,
      commitSha,
      parentCommitSha,
      summary: placeholderSummary,
      filesChanged: status.changedFileCount,
      additions: 0, // numstat fill happens in projection; we don't block on it here
      deletions: 0,
      createdAt: Date.now(),
      state: 'open',
      publishCommitSha: null,
      prUrl: null
    }
    this.broadcastTurnRecorded(pane.windowId, paneId, turn)
    // Also push a fresh full projection so any open TurnsModal sees the
    // numbered list update without manually firing TURNS_GET.
    broadcastTurnsUpdated(this.windowManager, pane.windowId, paneId, {
      worktreePath: pane.worktreePath,
      baseBranch,
      currentBranch,
      // We've already returned above when autoCommit === false, so reaching
      // here means it's enabled (true or undefined → default true).
      autoCommitEnabled: true,
      pendingAction: (pane as { pendingAction?: import('../shared/types').TurnPendingAction | null }).pendingAction ?? null
    }).catch((err) => {
      console.warn('[turn-recorder] broadcastTurnsUpdated failed:', err)
    })

    // 5. Async: generate the Haiku summary and amend the commit message.
    //    Don't await — the wip-commit is already on the branch; the user
    //    sees it instantly with the placeholder, and the rich summary fills
    //    in shortly after.
    void this.summarizeAndAmend(pane.worktreePath, commitSha, nextIndex, turnId, paneId, pane.windowId, baseBranch, currentBranch)

    return { outcome: 'committed', turn }
  }

  /**
   * Generate a Haiku summary of the staged diff and amend the wip-commit
   * message in place. Best-effort:
   *   - If Haiku times out or errors, leave the placeholder.
   *   - If HEAD has moved past the wip-commit since we committed (race with
   *     a manual commit, a publish, or a follow-up Stop), leave the
   *     placeholder — amending would rewrite a different commit.
   */
  private async summarizeAndAmend(
    worktreePath: string,
    expectedCommitSha: string,
    turnIndex: number,
    turnId: string,
    paneId: string,
    windowId: string,
    baseBranch: string,
    currentBranch: string
  ): Promise<void> {
    let summary: string
    try {
      summary = await this.haikuSummarize(worktreePath, expectedCommitSha)
    } catch (err) {
      console.warn('[turn-recorder] Haiku summary failed:', err instanceof Error ? err.message : err)
      return
    }
    if (!summary || summary.length === 0) return

    // Verify HEAD still points at our wip-commit before amending.
    const head = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })
      .then((r) => r.stdout.trim())
      .catch(() => '')
    if (head !== expectedCommitSha) return // moved on; don't rewrite

    const amendMsg = formatTurnCommitMessage(turnIndex, summary, turnId)
    const amendErr = await runGitWithLockRetry(
      ['commit', '--amend', '-m', amendMsg, '--no-verify'],
      { cwd: worktreePath }
    )
    if (amendErr) {
      console.warn('[turn-recorder] amend failed:', amendErr)
      return
    }

    // Push a fresh projection so the renderer sees the upgraded summary.
    void broadcastTurnsUpdated(this.windowManager, windowId, paneId, {
      worktreePath,
      baseBranch,
      currentBranch,
      autoCommitEnabled: true, // amending only fires on the success path; toggle re-evaluated by next handleStop
      pendingAction: null
    })
  }

  /**
   * Run a one-shot Haiku call with the staged diff as context. Returns a
   * trimmed one-liner (capped at 80 chars) suitable for a commit subject.
   */
  private async haikuSummarize(worktreePath: string, _commitSha: string): Promise<string> {
    // Diff the new commit against its parent. We use HEAD~1..HEAD so this
    // works regardless of where the wip-commit sits on the branch.
    const { stdout: rawDiff } = await execFileAsync(
      'git',
      ['diff', 'HEAD~1', 'HEAD'],
      { cwd: worktreePath, maxBuffer: 4 * 1024 * 1024 }
    ).catch(() => ({ stdout: '' as string }))

    const diff = rawDiff.length > HAIKU_DIFF_BYTES_CAP
      ? rawDiff.slice(0, HAIKU_DIFF_BYTES_CAP) + '\n[…diff truncated for length…]'
      : rawDiff
    if (!diff.trim()) return ''

    const prompt = [
      'Summarise the following git diff as a single short sentence (≤ 80',
      'characters) describing what changed. Use imperative mood, no markdown,',
      'no quotes, no period at the end. If the diff is mostly noise (whitespace,',
      'lockfile churn) return the literal word `wip`.',
      '',
      'Diff:',
      '```',
      diff,
      '```',
      ''
    ].join('\n')

    const { stdout } = await execFileAsync(
      'claude',
      ['--model', 'haiku', '--effort', 'low', '-p', prompt],
      { timeout: HAIKU_TIMEOUT_MS, maxBuffer: 1024 * 1024 }
    )
    return stdout.trim().split('\n')[0]?.slice(0, 80) ?? ''
  }

  private broadcastTurnRecorded(windowId: string, paneId: string, turn: Turn): void {
    const win: BrowserWindow | undefined = this.windowManager.getWindow(windowId)
    if (!win || win.isDestroyed()) return
    const payload: TurnRecordedPayload = { paneId, turn }
    win.webContents.send(IPC.TURN_RECORDED, payload)
  }
}

/**
 * Format a wip-commit message with the conventional subject + UUID trailer
 * the projection reads back. Subject form: `wip(turn-N): <summary>`.
 *
 * Trailer format follows git's standard "Token: value\n" convention so
 * `git interpret-trailers` can parse it later if we ever need to.
 */
export function formatTurnCommitMessage(turnIndex: number, summary: string, turnId: string): string {
  return `wip(turn-${turnIndex}): ${summary}\n\n${TURN_ID_TRAILER}: ${turnId}\n`
}

/**
 * Extract the Claudinha-Turn-Id trailer from a commit message body. Returns
 * null when missing or malformed. Used by `turn-projection`.
 */
export function extractTurnIdFromCommitMessage(message: string): string | null {
  const lines = message.split('\n')
  for (const line of lines) {
    const m = line.match(new RegExp(`^${TURN_ID_TRAILER}:\\s*(\\S+)\\s*$`))
    if (m) return m[1]!
  }
  return null
}

/**
 * Extract the displayed turn index (`wip(turn-N)`) from a commit subject.
 * Returns null when the subject isn't in the expected form. The projection
 * uses this to renumber turns 1..N on read; the on-disk number is just a
 * label and doesn't have to be authoritative.
 */
export function extractTurnIndexFromSubject(subject: string): number | null {
  const m = subject.match(/^wip\(turn-(\d+)\):/)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
