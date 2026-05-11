import { execFileSync } from 'child_process'

/**
 * Tells the spawn code how to handle a `git worktree add` for a named branch.
 *
 * - `existingWorktreePath` set → a worktree for the branch is already on disk;
 *   the spawn should attach to it via `mode: 'existing-worktree'` and not run
 *   `git worktree add` at all.
 * - `existingWorktreePath` null + `branchExists` true → branch exists but no
 *   worktree; spawn runs `git worktree add <path> <branch>` (no -b — attaches
 *   the existing branch).
 * - both false → branch is new; spawn runs `git worktree add <path> -b <branch>`
 *   (the legacy each-own / shared first-pane behavior).
 *
 * Used by the Launcher's branch popover when the user picks an existing branch:
 * we want one workspace to attach to it rather than create a sibling worktree.
 */
export interface BranchAttachInfo {
  branchExists: boolean
  existingWorktreePath: string | null
}

export function detectBranchAttach(repoRoot: string, branchName: string): BranchAttachInfo {
  let branchExists = false
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
      cwd: repoRoot, timeout: 5_000, stdio: 'pipe'
    })
    branchExists = true
  } catch {
    // exit non-zero → branch doesn't exist
  }

  if (!branchExists) {
    return { branchExists: false, existingWorktreePath: null }
  }

  // Parse `git worktree list --porcelain` blocks. Each block:
  //   worktree <path>
  //   HEAD <sha>
  //   branch refs/heads/<name>
  //   (blank line)
  // (Detached worktrees lack a `branch` line; we skip them.)
  let existingWorktreePath: string | null = null
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot, timeout: 5_000, stdio: 'pipe'
    }).toString()
    const blocks = out.split(/\n\n+/)
    for (const block of blocks) {
      const lines = block.split('\n')
      let wt: string | null = null
      let br: string | null = null
      for (const ln of lines) {
        if (ln.startsWith('worktree ')) wt = ln.substring('worktree '.length).trim()
        else if (ln.startsWith('branch ')) br = ln.substring('branch '.length).trim()
      }
      if (wt && br === `refs/heads/${branchName}`) {
        existingWorktreePath = wt
        break
      }
    }
  } catch {
    // worktree list failed; treat as no existing worktree
  }

  return { branchExists: true, existingWorktreePath }
}
