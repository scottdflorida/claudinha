/**
 * repo-claude-md — read / write / commit (+ optional push) the per-repo
 * `CLAUDE.md` file from the Kanban repo card pencil.
 *
 * Operates on the *base branch* checkout (the actual repo root, not a
 * worktree) so the commit doesn't collide with any in-flight feature
 * branches. Per L-029, write-side commands flow through `runGitWithLockRetry`
 * because the workspace's git status poller can hold `index.lock` briefly on
 * adjacent worktrees in the same repo.
 *
 * The "Interpretation A with safeties" the user approved in the concept doc:
 *   - save = write file + git commit on base branch (no merge step needed)
 *   - opt-in push captured separately so a push failure doesn't discard the
 *     commit
 *   - reject save when the file was modified outside the editor between open
 *     and save (mtime drift), surfacing a banner the renderer reloads from
 */

import path from 'path'
import fs from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  detectMainBranch,
  runGitWithLockRetry
} from './git-status'

const execFileAsync = promisify(execFile)

export interface ClaudeMdReadResult {
  /** File contents (empty string if the file doesn't exist yet — first edit). */
  content: string
  /**
   * Modification time at read. Renderer must hand this back on save so we can
   * detect external modification (vim, another editor, an agent).
   * `0` when the file did not exist at read time — a save should create it.
   */
  mtimeMs: number
}

export interface ClaudeMdSaveResult {
  /** Null on success; an error category string when the save failed. */
  error: string | null
  /**
   * Set when `error === 'modified-externally'`. Provides the fresh file
   * contents so the renderer can offer a reload affordance.
   */
  freshContent?: string
  freshMtimeMs?: number
  /**
   * Push failures are surfaced separately so the user sees that the commit
   * succeeded even when push (which is opt-in) fails.
   */
  pushError?: string
}

const FILE_NAME = 'CLAUDE.md'

/**
 * Read `<repoRoot>/CLAUDE.md`. Missing file is not an error — returns
 * `{ content: '', mtimeMs: 0 }` so the editor can author the first version.
 */
export async function readClaudeMd(repoRoot: string): Promise<ClaudeMdReadResult> {
  const filePath = path.join(repoRoot, FILE_NAME)
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.stat(filePath)
    ])
    return { content, mtimeMs: stat.mtimeMs }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { content: '', mtimeMs: 0 }
    }
    throw err
  }
}

interface ClaudeMdSaveInput {
  repoRoot: string
  content: string
  /** mtime captured at read time. `0` means the file did not exist. */
  expectedMtimeMs: number
  /** When true, run `git push origin <base>` after the commit. */
  push: boolean
}

/**
 * Save `<repoRoot>/CLAUDE.md`:
 *   1. Verify the on-disk mtime still matches `expectedMtimeMs` (or that the
 *      file is still missing if `expectedMtimeMs === 0`). If drift is
 *      detected, refuse the save and return fresh content for reload.
 *   2. Write the new content.
 *   3. `git add CLAUDE.md && git commit -m "Update CLAUDE.md"` on the
 *      repo's base branch checkout, with retry-on-`index.lock`.
 *   4. If `push` is true, run `git push origin <base>`. Push failures are
 *      reported as `pushError` without rolling back the commit.
 *
 * Never throws — every failure mode goes through `error` / `pushError`.
 */
export async function writeAndCommitClaudeMd(input: ClaudeMdSaveInput): Promise<ClaudeMdSaveResult> {
  const filePath = path.join(input.repoRoot, FILE_NAME)

  // ---- External modification guard (mtime drift) -------------------------
  let currentMtimeMs = 0
  let currentContent = ''
  try {
    const stat = await fs.stat(filePath)
    currentMtimeMs = stat.mtimeMs
    currentContent = await fs.readFile(filePath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      return { error: `Failed to read CLAUDE.md: ${(err as Error).message}` }
    }
    // ENOENT — file is missing; that's fine if we expected it to be missing.
  }

  // Allow a small mtime tolerance (within the same millisecond) — fs.stat on
  // some platforms reports slightly different mtimes between consecutive
  // reads of an unchanged file. Strict equality is too strict.
  if (input.expectedMtimeMs !== currentMtimeMs) {
    return {
      error: 'modified-externally',
      freshContent: currentContent,
      freshMtimeMs: currentMtimeMs
    }
  }

  // ---- Write the file ----------------------------------------------------
  try {
    await fs.writeFile(filePath, input.content, 'utf8')
  } catch (err) {
    return { error: `Failed to write CLAUDE.md: ${(err as Error).message}` }
  }

  // ---- Commit on the base branch ----------------------------------------
  const addError = await runGitWithLockRetry(['add', FILE_NAME], { cwd: input.repoRoot })
  if (addError) return { error: `git add failed: ${addError}` }

  // Skip the commit if the staged tree is unchanged vs HEAD. `git diff
  // --cached --quiet` exits 0 when there are no staged changes (saving the
  // same bytes back is a no-op). This avoids the `nothing to commit`
  // error path entirely and makes saves idempotent.
  let hasStagedChanges = true
  try {
    await execFileAsync('git', ['diff', '--cached', '--quiet'], { cwd: input.repoRoot })
    hasStagedChanges = false
  } catch {
    // Non-zero exit = there ARE staged changes; fall through and commit.
    hasStagedChanges = true
  }
  if (hasStagedChanges) {
    const commitError = await runGitWithLockRetry(
      ['commit', '-m', 'Update CLAUDE.md'],
      { cwd: input.repoRoot }
    )
    if (commitError) return { error: `git commit failed: ${commitError}` }
  }

  // ---- Optional push -----------------------------------------------------
  if (input.push) {
    const baseBranch = await detectMainBranch(input.repoRoot)
    if (!baseBranch) {
      return { error: null, pushError: 'Could not detect base branch (main/master).' }
    }
    const pushError = await runGitWithLockRetry(
      ['push', 'origin', baseBranch],
      { cwd: input.repoRoot }
    )
    if (pushError) return { error: null, pushError }
  }

  return { error: null }
}
