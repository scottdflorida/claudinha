import path from 'path'
import { execFileSync } from 'child_process'

/**
 * Derive the repo root from a pane's worktree path.
 *
 * Claudinha places new linked worktrees under `<repoRoot>/.worktrees/<name>`,
 * but older panes (and manual-path spawns) may sit directly at
 * `<repoRoot>/<name>`. For a stable per-repo group key we want `<repoRoot>`
 * in both shapes: take the parent dir, and if its basename is `.worktrees`
 * step up once more so the `.worktrees` infrastructure dir is never treated
 * as a repo of its own.
 */
export function worktreePathToRepoPath(worktreePath: string): string {
  const parent = path.dirname(worktreePath)
  if (path.basename(parent) === '.worktrees') {
    return path.dirname(parent)
  }
  return parent
}

/**
 * If a user-supplied or stored repo path ends in `.worktrees`, step up once
 * so the real repo root is used — preventing `<repoRoot>/.worktrees/.worktrees/<wt>`
 * nesting at spawn time and a `.worktrees` display label on the pane.
 */
export function normaliseRepoPath(repoPath: string): string {
  if (path.basename(repoPath) === '.worktrees') {
    return path.dirname(repoPath)
  }
  return repoPath
}

/**
 * Derive the display repo name from a worktree path. Shares a single source
 * of truth with `worktreePathToRepoPath` so the Kanban card, repo rail, and
 * pane header all show the parent repo's directory name — never `.worktrees`.
 */
export function repoNameFromWorktreePath(worktreePath: string): string {
  return path.basename(worktreePathToRepoPath(worktreePath))
}

/**
 * Read the currently-checked-out branch in a repo. Used as the agent label
 * for "On main" panes — they don't have a fabricated `wt-xxx` branch name
 * to show. Returns `'main'` if the lookup fails or HEAD is detached.
 */
export function currentBranchName(repoRoot: string): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoRoot,
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim()
    if (!out || out === 'HEAD') return 'main'
    return out
  } catch {
    return 'main'
  }
}
