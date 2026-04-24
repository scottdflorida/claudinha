import path from 'path'

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
