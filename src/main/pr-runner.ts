/**
 * pr-runner — push a worktree branch to origin and open a pull request
 * via `gh pr create`. M4's third publish path (alongside push-branch
 * and direct-merge).
 *
 * Why a separate runner:
 *   - The PR path needs the branch on origin first; `gh pr create`
 *     fails with "no commits between" if origin doesn't have the
 *     branch.
 *   - Push and PR-create can fail independently — the user could be
 *     authed for `git push` (SSH key) but not for `gh` (no token), so
 *     the runner reports each step separately.
 *   - Keeps the publish-engine free of `gh`-specific shape.
 *
 * Side effects:
 *   - `git push --force-with-lease origin <branch>` (the publish path
 *     just rewrote the branch via squash; force-with-lease is the
 *     least-dangerous force).
 *   - `gh pr create` (or `gh pr create --draft` for draft-pr) with the
 *     publish-commit's subject as the title and the body left blank
 *     for the user to fill in on GitHub.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { ghCliAvailable } from './git-status'

const execFileAsync = promisify(execFile)

export interface OpenPrResult {
  ok: boolean
  prUrl?: string
  /** When push succeeds but PR-create fails, surface both so the
   *  renderer can tell the user "branch is on origin, but the PR
   *  couldn't be opened — here's why." */
  branchPushed?: boolean
  error?: string
  errorKind?: 'gh-not-available' | 'push-rejected' | 'pr-create-failed' | 'unknown'
}

export async function runOpenPr(args: {
  worktreePath: string
  branch: string
  baseBranch: string
  /** Single-line PR title. */
  title: string
  /** PR body — markdown. Empty string is fine (GitHub shows the
   *  empty body verbatim; user can edit). */
  body?: string
  draft?: boolean
}): Promise<OpenPrResult> {
  const { worktreePath, branch, baseBranch, title, body = '', draft = false } = args

  // Pre-check `gh` availability so we don't push then fail at PR
  // create. If `gh` is missing, the user should know up front.
  const ghAvail = await ghCliAvailable()
  if (!ghAvail) {
    return {
      ok: false,
      error: '`gh` CLI is not installed or not on PATH. Install it from https://cli.github.com/ to open PRs.',
      errorKind: 'gh-not-available'
    }
  }

  // 1. Push branch.
  try {
    await execFileAsync(
      'git',
      ['push', '--force-with-lease', 'origin', branch],
      { cwd: worktreePath, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
    )
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return {
      ok: false,
      error: (e.stderr ?? e.message ?? 'push failed').trim().slice(0, 400),
      errorKind: 'push-rejected'
    }
  }

  // 2. `gh pr create`. We pass --base explicitly so the PR targets the
  //    correct branch even if the user's gh defaults are different.
  //    --head defaults to the current branch in the worktree, but we
  //    pass it explicitly for the same reason.
  const ghArgs = [
    'pr', 'create',
    '--base', baseBranch,
    '--head', branch,
    '--title', title,
    '--body', body
  ]
  if (draft) ghArgs.push('--draft')

  try {
    const { stdout } = await execFileAsync(
      'gh',
      ghArgs,
      { cwd: worktreePath, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
    )
    // `gh pr create` prints the PR URL on success.
    const prUrl = (stdout.trim().split('\n').find((l) => /^https?:\/\//.test(l)) ?? stdout).trim()
    return { ok: true, prUrl, branchPushed: true }
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    return {
      ok: false,
      branchPushed: true,
      error: (e.stderr ?? e.stdout ?? e.message ?? 'gh pr create failed').trim().slice(0, 400),
      errorKind: 'pr-create-failed'
    }
  }
}
