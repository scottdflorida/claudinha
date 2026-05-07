/**
 * Regression test for the auto-commit staging path.
 *
 * Pinned bug: with `.claude/` and `.worktrees/` written to
 * `.git/info/exclude` (which `ensureClaudinhaPathsIgnored` does for every
 * worktree we spawn), an earlier turn-recorder used pathspec exclusion
 * (`git add -A -- :!.claude :!.worktrees`) and git refused with:
 *
 *   "The following paths are ignored by one of your .gitignore files:
 *    .claude. Use -f if you really want to add them."
 *
 * Even though `:!` was meant to *exclude* the path, git's pathspec parser
 * fired the ignore-check anyway and bailed out. The whole add errored,
 * the recorder returned `outcome: 'error'`, and the modal stayed empty
 * with no turns.
 *
 * The fix is the two-step "add -A then reset infra paths" pattern. This
 * test pins it: a worktree with `.claude/` ignored, a tracked-and-modified
 * `.claude/settings.local.json`, an untracked `.claude/whatever.json`, and
 * a regular user file should produce ONE clean staging containing only
 * the user file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { runGitWithLockRetry, CLAUDINHA_INFRASTRUCTURE_DIRS, ensureClaudinhaPathsIgnored } from '../src/main/git-status'

let repoRoot: string

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-staging-it-'))
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repoRoot })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot })
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'init\n')
  execFileSync('git', ['add', '.'], { cwd: repoRoot })
  execFileSync('git', ['commit', '-m', 'init', '-q'], { cwd: repoRoot })
  execFileSync('git', ['checkout', '-b', 'wt-test', '-q'], { cwd: repoRoot })
})

afterEach(() => {
  try { fs.rmSync(repoRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

function stagedFiles(): string[] {
  return execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoRoot })
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
}

describe('auto-commit staging (regression for the gitignore-exclude pathspec error)', () => {
  it('stages user files but skips gitignored .claude/ untracked files', async () => {
    ensureClaudinhaPathsIgnored(repoRoot)
    fs.mkdirSync(path.join(repoRoot, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(repoRoot, '.claude/settings.local.json'), 'permission rule\n')
    fs.writeFileSync(path.join(repoRoot, 'feature.txt'), 'user work\n')

    const addErr = await runGitWithLockRetry(['add', '-A'], { cwd: repoRoot })
    expect(addErr).toBe(null)
    await runGitWithLockRetry(
      ['reset', 'HEAD', '--', ...CLAUDINHA_INFRASTRUCTURE_DIRS],
      { cwd: repoRoot }
    )

    expect(stagedFiles()).toEqual(['feature.txt'])
  })

  it("unstages tracked-and-modified .claude/settings.local.json (auto-mode permission writes)", async () => {
    // Track .claude/settings.local.json BEFORE writing exclude rules — this
    // mirrors the production case where Claude's session-init sometimes
    // commits .claude/ before our ensure step writes the exclude entry.
    fs.mkdirSync(path.join(repoRoot, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(repoRoot, '.claude/settings.local.json'), 'v1\n')
    // -f bypasses any pre-existing global gitignore rule that may shadow
    // .claude/. The user's machine could have one, and we want to test
    // the case where .claude/settings.local.json IS tracked.
    execFileSync('git', ['add', '-f', '.claude/settings.local.json'], { cwd: repoRoot })
    execFileSync('git', ['commit', '-m', 'track .claude', '-q'], { cwd: repoRoot })
    // NOW write exclude rules.
    ensureClaudinhaPathsIgnored(repoRoot)
    // Modify the tracked file (e.g. Claude auto-grants a permission). The
    // exclude file does NOT mask tracked files, so a naive `git add -A`
    // would re-stage it.
    fs.writeFileSync(path.join(repoRoot, '.claude/settings.local.json'), 'v2 permission added\n')
    fs.writeFileSync(path.join(repoRoot, 'feature.txt'), 'user work\n')

    const addErr = await runGitWithLockRetry(['add', '-A'], { cwd: repoRoot })
    expect(addErr).toBe(null)
    await runGitWithLockRetry(
      ['reset', 'HEAD', '--', ...CLAUDINHA_INFRASTRUCTURE_DIRS],
      { cwd: repoRoot }
    )

    expect(stagedFiles()).toEqual(['feature.txt'])
  })

  it('the legacy pathspec-exclusion approach errors on a repo with .claude/ ignored (proves we needed the fix)', async () => {
    ensureClaudinhaPathsIgnored(repoRoot)
    fs.mkdirSync(path.join(repoRoot, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(repoRoot, '.claude/settings.local.json'), 'v1\n')
    fs.writeFileSync(path.join(repoRoot, 'feature.txt'), 'user work\n')

    // The old approach: `git add -A -- :!.claude :!.worktrees`. Git's
    // pathspec parser bails out when an exclusion-only spec names an
    // ignored path.
    const result = await runGitWithLockRetry(
      ['add', '-A', '--', ...CLAUDINHA_INFRASTRUCTURE_DIRS.map((d) => `:!${d}`)],
      { cwd: repoRoot }
    )
    // Non-null = git surfaced an error to the caller. We accept either the
    // hint message or any non-zero exit; the contract is "this approach
    // fails," not the exact wording.
    expect(result).not.toBe(null)
  })

  it('handles a worktree where .claude/ does not exist (reset is a no-op)', async () => {
    ensureClaudinhaPathsIgnored(repoRoot)
    fs.writeFileSync(path.join(repoRoot, 'feature.txt'), 'user work\n')

    const addErr = await runGitWithLockRetry(['add', '-A'], { cwd: repoRoot })
    expect(addErr).toBe(null)
    // Reset on non-existent paths is silent and returns 0 in modern git.
    const resetErr = await runGitWithLockRetry(
      ['reset', 'HEAD', '--', ...CLAUDINHA_INFRASTRUCTURE_DIRS],
      { cwd: repoRoot }
    )
    // We're tolerant of either null or a benign "did not match any files"
    // depending on git version.
    expect(resetErr === null || /did not match/.test(resetErr ?? '')).toBe(true)

    expect(stagedFiles()).toEqual(['feature.txt'])
  })
})
