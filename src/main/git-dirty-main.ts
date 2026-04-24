import { execFile } from 'child_process'
import { promisify } from 'util'
import { isClaudinhaInfrastructurePath, runGitWithLockRetry } from './git-status'

const execFileAsync = promisify(execFile)

/** Timeout for git commands (ms). Matches GIT_TIMEOUT in git-status.ts. */
const GIT_TIMEOUT = 5_000

/**
 * Classify a file path against the repo's porcelain status so the caller can
 * route tracked vs untracked paths to the correct discard command. Only used
 * by discardDirtyMain — commit + stash don't need the distinction.
 *
 * Returns:
 *   - 'tracked'   — file has an X or Y porcelain code other than '??' (modified,
 *                   added, deleted, renamed, etc.) — use `git restore`.
 *   - 'untracked' — `??` in porcelain — use `git clean -fd`.
 *   - 'unknown'   — not in porcelain output (already clean or path typo) — skip.
 */
type FileStatus = 'tracked' | 'untracked' | 'unknown'

async function classifyFiles(
  repoPath: string,
  files: string[]
): Promise<Map<string, FileStatus>> {
  const result = new Map<string, FileStatus>()
  for (const f of files) result.set(f, 'unknown')
  try {
    const { stdout } = await execFileAsync(
      'git', ['status', '--porcelain'],
      { cwd: repoPath, timeout: GIT_TIMEOUT }
    )
    for (const line of stdout.split('\n')) {
      if (line.length < 4) continue
      const code = line.slice(0, 2)
      const path = line.slice(3)
      if (!result.has(path)) continue
      result.set(path, code === '??' ? 'untracked' : 'tracked')
    }
  } catch {
    // Leave everything as 'unknown' — the caller will skip.
  }
  return result
}

/**
 * Re-apply the infrastructure filter on the renderer-supplied file list so
 * .worktrees/ and .claude/ can never be committed / stashed / discarded,
 * even if the renderer mistakenly passes them in.
 */
function filterToUserFiles(files: string[]): string[] {
  return files
    .filter((f) => typeof f === 'string' && f.length > 0)
    .filter((f) => !isClaudinhaInfrastructurePath(f))
}

/**
 * Commit the filtered dirty-main files on the repo's current branch.
 *
 * `git add -- <files>` scopes the staging strictly to the files the user
 * saw in the modal — prevents an unrelated change from sweeping in. A single
 * commit is created with the supplied message.
 *
 * Returns null on success, an error string on failure. "nothing to commit"
 * (possible if a poll refreshed between modal-open and action) returns null
 * as success — there's nothing left to do.
 */
export async function commitDirtyMain(
  repoPath: string,
  message: string,
  files: string[]
): Promise<string | null> {
  const userFiles = filterToUserFiles(files)
  if (userFiles.length === 0) return 'Nothing to commit.'
  const trimmedMessage = message.trim()
  if (!trimmedMessage) return 'Commit message cannot be empty.'
  const addErr = await runGitWithLockRetry(
    ['add', '--', ...userFiles],
    { cwd: repoPath, timeout: GIT_TIMEOUT }
  )
  if (addErr) return addErr
  const commitErr = await runGitWithLockRetry(
    ['commit', '-m', trimmedMessage],
    { cwd: repoPath, timeout: GIT_TIMEOUT }
  )
  if (commitErr && !commitErr.includes('nothing to commit')) return commitErr
  return null
}

/**
 * Stash the filtered dirty-main files with an explicit message.
 *
 * `git stash push -u -m <msg> -- <files>` captures untracked files via -u
 * and scopes to the filtered set. If the set contains only untracked files
 * git still creates a stash thanks to -u.
 *
 * Returns null on success, an error string on failure. When there's no
 * dirty content to stash at the moment of execution, git exits 0 with
 * "No local changes to save" — we translate that to null (success, no-op).
 */
export async function stashDirtyMain(
  repoPath: string,
  message: string,
  files: string[]
): Promise<string | null> {
  const userFiles = filterToUserFiles(files)
  if (userFiles.length === 0) return 'Nothing to stash.'
  const trimmedMessage = message.trim()
  if (!trimmedMessage) return 'Stash message cannot be empty.'
  const err = await runGitWithLockRetry(
    ['stash', 'push', '-u', '-m', trimmedMessage, '--', ...userFiles],
    { cwd: repoPath, timeout: GIT_TIMEOUT }
  )
  if (err && !err.includes('No local changes to save')) return err
  return null
}

/**
 * Discard the filtered dirty-main files.
 *
 * DESTRUCTIVE. Tracked files are reverted via `git restore --staged --worktree`;
 * untracked files are removed via `git clean -fd --` (pathspec-limited — NOT a
 * blanket clean). Files whose classification is 'unknown' (not currently in
 * porcelain) are skipped silently — nothing to revert.
 *
 * Returns null on success, an error string on the first failed git invocation.
 */
export async function discardDirtyMain(
  repoPath: string,
  files: string[]
): Promise<string | null> {
  const userFiles = filterToUserFiles(files)
  if (userFiles.length === 0) return 'Nothing to discard.'

  const classification = await classifyFiles(repoPath, userFiles)
  const tracked: string[] = []
  const untracked: string[] = []
  for (const [path, status] of classification.entries()) {
    if (status === 'tracked') tracked.push(path)
    else if (status === 'untracked') untracked.push(path)
  }

  if (tracked.length > 0) {
    const err = await runGitWithLockRetry(
      ['restore', '--staged', '--worktree', '--', ...tracked],
      { cwd: repoPath, timeout: GIT_TIMEOUT }
    )
    if (err) return err
  }
  if (untracked.length > 0) {
    const err = await runGitWithLockRetry(
      ['clean', '-fd', '--', ...untracked],
      { cwd: repoPath, timeout: GIT_TIMEOUT }
    )
    if (err) return err
  }
  return null
}
