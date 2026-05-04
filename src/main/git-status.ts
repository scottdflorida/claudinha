import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import type { GitStatus } from '../shared/types'

const execFileAsync = promisify(execFile)

/** Timeout for git commands (ms) */
const GIT_TIMEOUT = 5_000

/** Cap on the per-status file-name list shipped to the renderer. The full count
 *  remains accurate; only the displayable list is bounded so the IPC payload
 *  doesn't balloon on large refactors. */
export const MAX_CHANGED_FILES_IN_STATUS = 50

/**
 * Count user-initiated changes in `git status --porcelain` output, excluding
 * Claudinha's own infrastructure paths (`.claude/` for per-project settings;
 * `.worktrees/` which holds the linked worktrees Claudinha creates under the
 * main repo). Neither is user work, and without this filter Claudinha's own
 * scaffolding flags every fresh-init workspace as "main has uncommitted changes"
 * and blocks the first merge.
 *
 * Porcelain format is `XY filename` where XY is exactly two status columns
 * (each may be a space) followed by a single space separator, e.g. ` M file`,
 * `?? newfile`, `MM staged-and-modified`. We MUST split on '\n' first and
 * filter empty lines — calling `.trim()` on the whole stdout would strip the
 * leading-space column from the very first line and corrupt its filename.
 */
export function countUserChangedFiles(porcelainOutput: string): number {
  return porcelainOutput
    .split('\n')
    .filter((l) => l.length > 0)
    .filter((l) => !isClaudinhaInfrastructurePath(l.slice(3))) // skip "XY " status prefix
    .length
}

/**
 * True when a path inside a main repo working pane is Claudinha's own
 * infrastructure rather than user work: `.claude/` (per-project settings we
 * write at spawn time) or `.worktrees/` (linked worktree roots we create).
 *
 * Checked segment-by-segment so we catch these directories *at any depth* —
 * not just at the repo root. A previous Claudinha session (or a user who
 * moved an old layout around) can leave `Animals/.worktrees/wt-XXX` sitting
 * inside a newer main repo's working tree; the root-anchored check missed
 * those and produced false "main has uncommitted changes" errors.
 */
export function isClaudinhaInfrastructurePath(file: string): boolean {
  const segments = file.split('/')
  return segments.includes('.claude') || segments.includes('.worktrees')
}

/**
 * Check git status of a working directory.
 * Returns null on error (not a git repo, timeout, etc.)
 */
export async function getGitStatus(worktreePath: string): Promise<GitStatus | null> {
  try {
    // Run the cheap queries concurrently. Base-branch-ahead is a follow-up
    // probe against the main repo path; it's nullable on its own and isn't
    // required for the rest of the struct, so we run it after with its own
    // tolerance for missing remotes / unavailable repo root.
    const [statusResult, branchResult, aheadResult] = await Promise.all([
      execFileAsync('git', ['status', '--porcelain'], { cwd: worktreePath, timeout: GIT_TIMEOUT })
        .catch(() => null),
      execFileAsync('git', ['branch', '--show-current'], { cwd: worktreePath, timeout: GIT_TIMEOUT })
        .catch(() => null),
      getCommitsAhead(worktreePath)
    ])

    if (!statusResult) return null

    // Parse porcelain once into the canonical user-file list — both the count
    // and the displayable list derive from it. We slice off the 3-char status
    // prefix (`XY ` — the Y column may be a space, so a `.trim()` on the whole
    // stdout would corrupt the leading-space line). The cap keeps IPC bounded
    // on large refactors; the full count is still reported.
    const userFiles = statusResult.stdout
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => l.slice(3))
      .filter((file) => !isClaudinhaInfrastructurePath(file))
    const userChangedFiles = userFiles.length
    const changedFiles = [...userFiles].sort().slice(0, MAX_CHANGED_FILES_IN_STATUS)

    // Base-branch ahead-of-remote drives the "↑N to push" pill after a local
    // merge has advanced the base branch. We resolve from the worktree to the
    // main repo (where the base branch actually lives) and ask the existing
    // helper. Either step can fail benignly; null reads as "unknown."
    let baseBranchAheadOfRemote: number | null = null
    try {
      const repoRoot = await getMainRepoPath(worktreePath)
      const base = repoRoot ? await detectMainBranch(repoRoot) : null
      if (repoRoot && base) {
        baseBranchAheadOfRemote = await getBaseBranchAhead(repoRoot, base)
      }
    } catch {
      baseBranchAheadOfRemote = null
    }

    return {
      hasUncommittedChanges: userChangedFiles > 0,
      changedFileCount: userChangedFiles,
      changedFiles,
      commitsAhead: aheadResult,
      baseBranchAheadOfRemote,
      branchName: branchResult?.stdout.trim() || null
    }
  } catch {
    return null
  }
}

/**
 * Count commits ahead of main/master. Falls back to master if main doesn't exist.
 * Returns 0 on any error.
 */
async function getCommitsAhead(worktreePath: string): Promise<number> {
  // Try main first, then master
  for (const base of ['main', 'master']) {
    try {
      const result = await execFileAsync(
        'git', ['rev-list', '--count', `${base}..HEAD`],
        { cwd: worktreePath, timeout: GIT_TIMEOUT }
      )
      return parseInt(result.stdout.trim(), 10) || 0
    } catch {
      // Branch doesn't exist, try next
    }
  }
  return 0
}

/**
 * Stage all changes and commit.
 * Returns error message on failure, null on success.
 */
export async function gitCommitAll(
  worktreePath: string,
  message?: string
): Promise<string | null> {
  const commitMsg = message || 'claudinha: auto-commit on close'
  try {
    await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, timeout: GIT_TIMEOUT })
    await execFileAsync(
      'git', ['commit', '-m', commitMsg],
      { cwd: worktreePath, timeout: GIT_TIMEOUT }
    )
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // "nothing to commit" is not a real error
    if (msg.includes('nothing to commit')) return null
    return msg
  }
}

/**
 * Remove a git worktree directory.
 * Uses --force to handle worktrees with modifications.
 * Returns error message on failure, null on success.
 */
export async function gitWorktreeRemove(worktreePath: string): Promise<string | null> {
  try {
    // Resolve the main repo root from the worktree
    const repoRoot = await getMainRepoPath(worktreePath)
    if (!repoRoot) return 'Could not determine main repository path.'

    await execFileAsync(
      'git', ['worktree', 'remove', '--force', worktreePath],
      { cwd: repoRoot, timeout: GIT_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Get the main repository root path from a worktree path.
 * Returns null if the path is not inside a git worktree.
 */
export async function getMainRepoPath(worktreePath: string): Promise<string | null> {
  try {
    // --git-common-dir returns the shared .git directory
    const result = await execFileAsync(
      'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: worktreePath, timeout: GIT_TIMEOUT }
    )
    const gitCommonDir = result.stdout.trim()
    // The repo root is the parent of the .git directory
    // e.g., /path/to/repo/.git → /path/to/repo
    if (gitCommonDir.endsWith('/.git')) {
      return gitCommonDir.slice(0, -5)
    }
    // If it's a bare repo or some other layout, return the dir itself
    return gitCommonDir
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Completion Actions — git operations for merge/PR flow
// ---------------------------------------------------------------------------

/** Longer timeout for rebase/merge operations that may involve large diffs */
const GIT_MERGE_TIMEOUT = 30_000

/**
 * Check if a working directory has uncommitted changes (excluding .claude/).
 * Used to verify main repo is clean before merging into it.
 */
export async function isWorkingTreeClean(dirPath: string): Promise<boolean> {
  try {
    const result = await execFileAsync(
      'git', ['status', '--porcelain'],
      { cwd: dirPath, timeout: GIT_TIMEOUT }
    )
    return countUserChangedFiles(result.stdout) === 0
  } catch {
    return false
  }
}

/**
 * List user-initiated changed file paths from `git status --porcelain`,
 * excluding Claudinha's own `.claude/` entries. Returns `{ files, totalCount }`
 * where `files` is capped at `max` and `totalCount` reflects the full count.
 * Returns `{ files: [], totalCount: 0 }` on error.
 *
 * Path parsing matches countUserChangedFiles: each porcelain line is
 * `XY filename` — we slice from column 3 onward. For renames (`R  old -> new`)
 * we keep the raw tail; that's fine for display.
 */
export async function listChangedFiles(
  dirPath: string,
  max = 20
): Promise<{ files: string[]; totalCount: number }> {
  try {
    const result = await execFileAsync(
      'git', ['status', '--porcelain'],
      { cwd: dirPath, timeout: GIT_TIMEOUT }
    )
    const all = result.stdout
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => l.slice(3))
      .filter((file) => !isClaudinhaInfrastructurePath(file))
    return { files: all.slice(0, max), totalCount: all.length }
  } catch {
    return { files: [], totalCount: 0 }
  }
}

/**
 * Detect which main branch exists (main or master).
 * Returns the branch name or null if neither exists.
 */
export async function detectMainBranch(dirPath: string): Promise<string | null> {
  for (const branch of ['main', 'master']) {
    try {
      await execFileAsync(
        'git', ['rev-parse', '--verify', branch],
        { cwd: dirPath, timeout: GIT_TIMEOUT }
      )
      return branch
    } catch {
      // Branch doesn't exist, try next
    }
  }
  return null
}

/**
 * List local branches in a directory, sorted by recent commit activity (the
 * most recently committed branch first). The current branch is always included
 * so callers can render it as the default selection. Returns the empty array
 * on any git error so callers can render an empty picker instead of crashing.
 */
export async function listBranches(dirPath: string): Promise<{
  branches: string[]
  current: string | null
}> {
  try {
    const result = await execFileAsync(
      'git',
      ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads/'],
      { cwd: dirPath, timeout: GIT_TIMEOUT }
    )
    const branches = result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    const current = await getCurrentBranch(dirPath)
    return { branches, current }
  } catch {
    return { branches: [], current: null }
  }
}

/**
 * Verify that a local branch ref exists in the given repo. Used as a guard
 * before checking out a target branch supplied by the renderer's branch picker
 * — protects against picker-state staleness (e.g., a branch deleted on disk
 * after the picker was opened).
 */
export async function localBranchExists(repoPath: string, branchName: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git', ['rev-parse', '--verify', `refs/heads/${branchName}`],
      { cwd: repoPath, timeout: GIT_TIMEOUT }
    )
    return true
  } catch {
    return false
  }
}

/**
 * Check out a branch in a repo (used to switch the main repo to a user-selected
 * merge target before running the local ff/squash/merge-commit step).
 * Returns null on success, error string on failure. Caller must verify the
 * working tree is clean first — `git checkout` will refuse to switch with
 * uncommitted changes that would be overwritten.
 */
export async function gitCheckout(repoPath: string, branchName: string): Promise<string | null> {
  try {
    await execFileAsync(
      'git', ['checkout', branchName],
      { cwd: repoPath, timeout: GIT_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Get the current branch name in a directory.
 */
export async function getCurrentBranch(dirPath: string): Promise<string | null> {
  try {
    const result = await execFileAsync(
      'git', ['branch', '--show-current'],
      { cwd: dirPath, timeout: GIT_TIMEOUT }
    )
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * Rebase current branch onto a base branch.
 * Returns null on success, error string on failure.
 * If the error contains 'CONFLICT' or 'conflict', it's a merge conflict.
 */
export async function gitRebase(worktreePath: string, baseBranch: string): Promise<string | null> {
  try {
    await execFileAsync(
      'git', ['rebase', baseBranch],
      { cwd: worktreePath, timeout: GIT_MERGE_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Abort an in-progress rebase.
 * Returns null on success, error string on failure.
 */
export async function gitRebaseAbort(worktreePath: string): Promise<string | null> {
  try {
    await execFileAsync(
      'git', ['rebase', '--abort'],
      { cwd: worktreePath, timeout: GIT_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Fast-forward merge a branch into the current branch.
 * Executed in the main repo directory to update its working pane.
 * Returns null on success, error string on failure.
 */
export async function gitMergeFf(mainRepoPath: string, branchName: string): Promise<string | null> {
  try {
    await execFileAsync(
      'git', ['merge', '--ff-only', branchName],
      { cwd: mainRepoPath, timeout: GIT_MERGE_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Squash merge a branch into the current branch and commit.
 * Executed in the main repo directory.
 * Returns null on success, error string on failure.
 */
export async function gitMergeSquash(
  mainRepoPath: string,
  branchName: string,
  commitMessage?: string
): Promise<string | null> {
  try {
    await execFileAsync(
      'git', ['merge', '--squash', branchName],
      { cwd: mainRepoPath, timeout: GIT_MERGE_TIMEOUT }
    )
    // Squash stages but doesn't commit — follow up with commit
    const msg = commitMessage || `squash merge branch '${branchName}'`
    await execFileAsync(
      'git', ['commit', '-m', msg],
      { cwd: mainRepoPath, timeout: GIT_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Merge a branch with a merge commit (no fast-forward).
 * Executed in the main repo directory.
 * Returns null on success, error string on failure.
 */
export async function gitMergeNoFf(mainRepoPath: string, branchName: string): Promise<string | null> {
  try {
    await execFileAsync(
      'git', ['merge', '--no-ff', branchName],
      { cwd: mainRepoPath, timeout: GIT_MERGE_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Abort an in-progress merge on the main repo.
 * Returns null on success, error string on failure.
 */
export async function gitMergeAbort(mainRepoPath: string): Promise<string | null> {
  try {
    await execFileAsync(
      'git', ['merge', '--abort'],
      { cwd: mainRepoPath, timeout: GIT_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Push a branch to origin with tracking.
 * Returns null on success, error string on failure.
 */
export async function gitPush(worktreePath: string, branchName: string): Promise<string | null> {
  try {
    await execFileAsync(
      'git', ['push', '-u', 'origin', branchName],
      { cwd: worktreePath, timeout: GIT_MERGE_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Push the base branch (typically `main` or `master`) of a repo to origin.
 * Thin wrapper over `gitPush` with a clearer name for the call site — used by
 * Kanban's per-repo Push and Merge + push actions.
 *
 * Wrapped in `runGitWithLockRetry` because the workspace's git status poller
 * holds index.lock briefly on adjacent worktrees and can collide with a
 * push-time index update (L-029). The push command itself is idempotent on
 * lock contention — git rejects the operation; the retry simply re-issues it
 * once the lock clears.
 */
export async function gitPushBaseBranch(
  repoRoot: string,
  baseBranch: string
): Promise<string | null> {
  return runGitWithLockRetry(['push', '-u', 'origin', baseBranch], {
    cwd: repoRoot,
    timeout: GIT_MERGE_TIMEOUT
  })
}

/**
 * Count commits the base branch is ahead of its `origin/<base>` remote
 * tracking ref. Returns:
 *   - a non-negative integer when the comparison succeeds
 *   - `null` when there is no remote tracking branch (no remote configured,
 *     fresh repo never pushed, etc.) or any error
 *
 * Used by the Kanban repo rail's Push button enable predicate. We never
 * "throw" — the caller treats null as "we don't know yet, keep button
 * disabled."
 */
export async function getBaseBranchAhead(
  repoRoot: string,
  baseBranch: string
): Promise<number | null> {
  try {
    // Verify the remote tracking ref exists. If not, we have nothing to push to.
    await execFileAsync(
      'git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${baseBranch}`],
      { cwd: repoRoot, timeout: GIT_TIMEOUT }
    )
  } catch {
    return null
  }
  try {
    const result = await execFileAsync(
      'git', ['rev-list', '--count', `origin/${baseBranch}..${baseBranch}`],
      { cwd: repoRoot, timeout: GIT_TIMEOUT }
    )
    const n = parseInt(result.stdout.trim(), 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/**
 * Read the unified diff of a worktree vs its base branch (`main` or `master`).
 * Used by the Kanban diff viewer modal. Capped at `maxBytes` to keep IPC
 * payloads small; truncation is signalled via the `truncated` flag.
 *
 * Returns:
 *   - `{ diff, truncated, baseBranch }` on success
 *   - `{ diff: '', truncated: false, baseBranch, error }` on failure
 */
export async function getDiff(
  worktreePath: string,
  maxBytes = 1_000_000
): Promise<{ diff: string; truncated: boolean; baseBranch: string | null; error?: string }> {
  const baseBranch = await detectMainBranch(worktreePath)
  if (!baseBranch) {
    return { diff: '', truncated: false, baseBranch: null, error: 'Could not detect base branch.' }
  }
  try {
    // Use `git diff <base>` (working-tree vs base) so the viewer shows the
    // same work the Kanban card's +N/-M chip and Claudinha's merge flow
    // already treat as "changes that would land" — both committed and
    // uncommitted. `<base>..HEAD` would exclude uncommitted edits, which
    // produces a surprising "No differences" for a pane with live changes.
    const result = await execFileAsync(
      'git', ['diff', '--no-color', baseBranch],
      { cwd: worktreePath, timeout: GIT_MERGE_TIMEOUT, maxBuffer: maxBytes + 1024 }
    )
    const stdout = result.stdout
    if (stdout.length > maxBytes) {
      return {
        diff: stdout.slice(0, maxBytes),
        truncated: true,
        baseBranch
      }
    }
    return { diff: stdout, truncated: false, baseBranch }
  } catch (err) {
    return {
      diff: '',
      truncated: false,
      baseBranch,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Run a git subcommand with retry-on-`index.lock`-contention (L-029).
 *
 * The workspace's git status poller holds `index.lock` briefly on adjacent
 * worktrees in the same repo, which can race write-side commands like
 * `commit`, `push`, or `add`. We retry up to three times with 100/300/900 ms
 * backoff before surfacing the failure. Most contention clears within the
 * first retry.
 *
 * Returns null on success, error string on failure (after retries exhausted
 * or on non-lock errors).
 */
export async function runGitWithLockRetry(
  args: string[],
  opts: { cwd: string; timeout?: number }
): Promise<string | null> {
  const delays = [100, 300, 900]
  const timeout = opts.timeout ?? GIT_TIMEOUT
  let lastError = ''
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await execFileAsync('git', args, { cwd: opts.cwd, timeout })
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError = msg
      // Lock contention is the only failure we retry. Other errors (auth, no
      // remote, non-fast-forward, etc.) surface immediately.
      if (!msg.includes('index.lock') && !msg.includes('Unable to create')) {
        return msg
      }
      if (attempt === delays.length) break
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
    }
  }
  return lastError || 'git command failed after retries'
}

/**
 * Create a PR using the gh CLI.
 * Returns { error, prUrl } — error is null on success.
 */
export async function ghCreatePr(
  worktreePath: string,
  title: string,
  body: string,
  draft: boolean
): Promise<{ error: string | null; prUrl?: string }> {
  try {
    const args = ['pr', 'create', '--title', title, '--body', body]
    if (draft) args.push('--draft')
    const result = await execFileAsync(
      'gh', args,
      { cwd: worktreePath, timeout: GIT_MERGE_TIMEOUT }
    )
    // gh pr create prints the PR URL to stdout
    const prUrl = result.stdout.trim()
    return { error: null, prUrl: prUrl || undefined }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Delete a local branch in the main repo. Uses `git branch -d` (safe delete)
 * by default — fails if the branch isn't fully merged. Pass `force: true` to
 * use `-D` (force delete). Returns null on success, error string on failure.
 *
 * Typically called after a successful merge where the branch is already in
 * main's history, so `-d` succeeds cleanly.
 */
export async function gitBranchDelete(
  mainRepoPath: string,
  branchName: string,
  options: { force?: boolean } = {}
): Promise<string | null> {
  const flag = options.force ? '-D' : '-d'
  try {
    await execFileAsync(
      'git', ['branch', flag, branchName],
      { cwd: mainRepoPath, timeout: GIT_TIMEOUT }
    )
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Check if a rebase is currently in progress in a worktree.
 * Detects both interactive (rebase-merge) and non-interactive (rebase-apply) rebases
 * by looking for the relevant control directories inside the worktree's .git dir.
 */
export async function isRebaseInProgress(worktreePath: string): Promise<boolean> {
  try {
    // Use `git rev-parse --git-dir` to resolve the worktree's git directory
    // (which is different from the shared --git-common-dir for secondary worktrees).
    const result = await execFileAsync(
      'git', ['rev-parse', '--path-format=absolute', '--git-dir'],
      { cwd: worktreePath, timeout: GIT_TIMEOUT }
    )
    const gitDir = result.stdout.trim()
    if (!gitDir) return false
    return (
      fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
      fs.existsSync(path.join(gitDir, 'rebase-apply'))
    )
  } catch {
    return false
  }
}

/**
 * Check if the gh CLI is available and authenticated.
 */
export async function ghCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['auth', 'status'], { timeout: GIT_TIMEOUT })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// ChangesReadyModal commit-message tooling
// ---------------------------------------------------------------------------

/** Maximum number of commits to surface to the modal. */
const MAX_COMMIT_LOG = 50

export interface PaneCommitInfo {
  sha: string
  shortSha: string
  subject: string
  body: string
  pushed: boolean
}

/**
 * List the commits between the worktree branch's upstream / base and HEAD.
 *
 * - Range: prefer `<upstream>..HEAD`. If no upstream is configured, fall back
 *   to `<base>..HEAD` so a freshly created worktree branch still produces a
 *   meaningful list. If neither exists, returns an empty array (no error).
 * - `pushed`: a commit is reachable from the configured upstream ref. Used by
 *   the reword path to refuse force-push territory.
 * - Capped at MAX_COMMIT_LOG (50) — older history is paginated/folded by the UI.
 */
export async function getPaneCommitLog(worktreePath: string): Promise<{
  commits: PaneCommitInfo[]
  error: string | null
}> {
  const branch = await getCurrentBranch(worktreePath)
  if (!branch) return { commits: [], error: null }

  // Upstream ref (if any). Used to tag each commit's `pushed` state below.
  let upstream: string | null = null
  try {
    const r = await execFileAsync(
      'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      { cwd: worktreePath, timeout: GIT_TIMEOUT }
    )
    upstream = r.stdout.trim() || null
  } catch {
    upstream = null
  }

  // Range: always <base>..HEAD so pushed-but-not-merged commits stay in the
  // list (they're how the modal renders the "Pushed to branch" round). With
  // <upstream>..HEAD the pushed flag was unreachable by construction. Falling
  // back to upstream only when no base can be detected (rare).
  const base = await detectMainBranch(worktreePath)
  let range: string | null = null
  if (base) {
    range = `${base}..HEAD`
  } else if (upstream) {
    range = `${upstream}..HEAD`
  }
  if (!range) return { commits: [], error: null }

  // git log with NUL-delimited fields so subjects/bodies with commas / newlines
  // round-trip cleanly. Format: <sha>%x00<subject>%x00<body>%x00 — terminated
  // by an extra NUL between commits.
  let stdout = ''
  try {
    const r = await execFileAsync(
      'git',
      ['log', `--max-count=${MAX_COMMIT_LOG}`, '--pretty=format:%H%x00%s%x00%b%x00', range],
      { cwd: worktreePath, timeout: GIT_TIMEOUT, maxBuffer: 4 * 1024 * 1024 }
    )
    stdout = r.stdout
  } catch (err) {
    return { commits: [], error: err instanceof Error ? err.message : String(err) }
  }

  // Split on the trailing-NUL record terminator. Each record is exactly
  // `<sha>\0<subject>\0<body>` (no trailing NUL inside).
  const records = stdout.split(' \n').filter((r) => r.trim().length > 0)
  // The last record may not have a trailing newline; allow plain NUL split too.
  const flat = records.length > 0 ? records : stdout.split(' ').filter((r) => r.length > 0)

  const commits: PaneCommitInfo[] = []
  for (const rec of flat) {
    const parts = rec.split(' ')
    if (parts.length < 2) continue
    const [sha, subject, body = ''] = parts
    if (!sha) continue
    commits.push({
      sha: sha.trim(),
      shortSha: sha.trim().slice(0, 7),
      subject: subject ?? '',
      body: (body ?? '').replace(/\n+$/, ''),
      pushed: false // filled in below
    })
  }

  // Mark each commit pushed if it's reachable from upstream.
  if (upstream && commits.length > 0) {
    for (const c of commits) {
      try {
        await execFileAsync(
          'git', ['merge-base', '--is-ancestor', c.sha, upstream],
          { cwd: worktreePath, timeout: GIT_TIMEOUT }
        )
        c.pushed = true
      } catch {
        c.pushed = false
      }
    }
  }

  return { commits, error: null }
}

/**
 * Reword a single commit's message in the pane's worktree.
 *
 * Refuses if:
 *   - the worktree has unstaged/staged changes (rebase / amend would conflict)
 *   - the commit is reachable from the branch's upstream (already pushed —
 *     rewriting would require a force-push)
 *
 * Strategy:
 *   - Tip commit:  `git commit --amend -m <message>`
 *   - Older commit: non-interactive rebase. We rewrite the matching `pick`
 *     line in the rebase todo to `reword`, and supply the new message via
 *     GIT_EDITOR. Both editors are tiny inline node scripts that read $1.
 *
 * Returns null on success, error string otherwise.
 */
export async function gitRewordCommit(
  worktreePath: string,
  sha: string,
  message: string
): Promise<string | null> {
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return 'Invalid commit sha.'
  if (!message || !message.trim()) return 'Commit message cannot be empty.'

  // Refuse on dirty tree.
  try {
    const r = await execFileAsync(
      'git', ['status', '--porcelain'],
      { cwd: worktreePath, timeout: GIT_TIMEOUT }
    )
    if (r.stdout.trim().length > 0) {
      return 'Reword refused: worktree has uncommitted changes. Commit or stash first.'
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }

  // Refuse if the commit is already pushed.
  let upstream: string | null = null
  try {
    const r = await execFileAsync(
      'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      { cwd: worktreePath, timeout: GIT_TIMEOUT }
    )
    upstream = r.stdout.trim() || null
  } catch {
    upstream = null
  }
  if (upstream) {
    try {
      await execFileAsync(
        'git', ['merge-base', '--is-ancestor', sha, upstream],
        { cwd: worktreePath, timeout: GIT_TIMEOUT }
      )
      return 'Reword refused: commit is already pushed. Force-push is not supported here.'
    } catch {
      // not an ancestor — safe to proceed
    }
  }

  // Tip vs older?
  let head = ''
  try {
    const r = await execFileAsync(
      'git', ['rev-parse', 'HEAD'],
      { cwd: worktreePath, timeout: GIT_TIMEOUT }
    )
    head = r.stdout.trim()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }

  const isTip = head.startsWith(sha) || sha.startsWith(head)

  if (isTip) {
    try {
      await execFileAsync(
        'git', ['commit', '--amend', '-m', message],
        { cwd: worktreePath, timeout: GIT_TIMEOUT }
      )
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  // Older commit — non-interactive rebase. Resolve the full sha so we can
  // match it in the rebase todo file (which uses short shas by default).
  let fullSha = sha
  try {
    const r = await execFileAsync(
      'git', ['rev-parse', sha],
      { cwd: worktreePath, timeout: GIT_TIMEOUT }
    )
    fullSha = r.stdout.trim()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  const shortSha = fullSha.slice(0, 7)

  // Two helper scripts (sequence editor + commit-message editor) live in a
  // throwaway temp dir for the duration of the rebase.
  const os = await import('os')
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claudinha-reword-'))
  const seqEditor = path.join(tmpDir, 'seq-editor.js')
  const msgEditor = path.join(tmpDir, 'msg-editor.js')
  const messageFile = path.join(tmpDir, 'message.txt')
  await fs.promises.writeFile(messageFile, message, 'utf8')

  // Sequence editor: rewrite the line whose second token starts with our short
  // sha from `pick` to `reword`. Read $1 (the rebase-todo path), rewrite, save.
  const seqScript = `
const fs = require('fs')
const file = process.argv[2]
const sha = ${JSON.stringify(shortSha)}
const lines = fs.readFileSync(file, 'utf8').split('\\n')
let rewrote = false
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(pick|p)\\s+([0-9a-f]+)(.*)$/)
  if (m && (m[2].startsWith(sha) || sha.startsWith(m[2]))) {
    lines[i] = 'reword ' + m[2] + m[3]
    rewrote = true
    break
  }
}
if (!rewrote) process.exit(2)
fs.writeFileSync(file, lines.join('\\n'))
`
  // Commit-message editor: overwrite $1 with the contents of messageFile.
  const msgScript = `
const fs = require('fs')
const target = process.argv[2]
const src = ${JSON.stringify(messageFile)}
fs.writeFileSync(target, fs.readFileSync(src))
`
  await fs.promises.writeFile(seqEditor, seqScript, 'utf8')
  await fs.promises.writeFile(msgEditor, msgScript, 'utf8')

  const env = {
    ...process.env,
    GIT_SEQUENCE_EDITOR: `${process.execPath} ${seqEditor}`,
    GIT_EDITOR: `${process.execPath} ${msgEditor}`
  }

  let rebaseError: string | null = null
  try {
    await execFileAsync(
      'git', ['rebase', '-i', `${fullSha}~1`],
      { cwd: worktreePath, timeout: GIT_MERGE_TIMEOUT, env }
    )
  } catch (err) {
    rebaseError = err instanceof Error ? err.message : String(err)
    // Best-effort abort to leave the worktree clean.
    try {
      await execFileAsync('git', ['rebase', '--abort'], { cwd: worktreePath, timeout: GIT_TIMEOUT })
    } catch {
      // ignore
    }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }

  return rebaseError
}
