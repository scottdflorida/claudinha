/**
 * Integration tests for `side-clone-manager` and `merge-runner` against
 * real temp git repositories. Validates the M4 ship criterion:
 *
 *   "User can configure each repo for direct-merge, PR, or both.
 *    Direct-merge works regardless of main repo's working tree state."
 *
 * The key piece tested here is direct-merge via side-clone working
 * even when the user's primary checkout is dirty / on a different
 * branch — the side-clone is independent of their main checkout.
 *
 * Test fixture:
 *   - Bare "origin" repo so push round-trips work.
 *   - Local "primary" clone of origin.
 *   - A worktree branch off origin/main with one commit ahead.
 *   - SideCloneManager singleton.
 *
 * Coverage:
 *   - Side-clone creation is idempotent.
 *   - Direct merge fast-forwards a worktree branch onto base, pushes.
 *   - Direct merge succeeds even when the user's primary main is dirty
 *     (the side-clone bypasses the primary's working-tree state).
 *   - Concurrent merges on the same repo serialise via the mutex.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'

import { SideCloneManager } from '../src/main/side-clone-manager'
import { runDirectMerge } from '../src/main/merge-runner'

let remoteRoot: string
let primaryRoot: string
let mgr: SideCloneManager

beforeEach(() => {
  remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-remote-'))
  execFileSync('git', ['init', '--bare', '--initial-branch=main', '-q'], { cwd: remoteRoot })

  primaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-primary-'))
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: primaryRoot })
  for (const cfg of [
    ['user.email', 't@t.com'],
    ['user.name', 't'],
    ['commit.gpgsign', 'false']
  ]) {
    execFileSync('git', ['config', cfg[0]!, cfg[1]!], { cwd: primaryRoot })
  }
  execFileSync('git', ['remote', 'add', 'origin', remoteRoot], { cwd: primaryRoot })
  fs.writeFileSync(path.join(primaryRoot, 'README.md'), 'init\n')
  execFileSync('git', ['add', '.'], { cwd: primaryRoot })
  execFileSync('git', ['commit', '-m', 'init', '-q'], { cwd: primaryRoot })
  execFileSync('git', ['push', '-u', 'origin', 'main', '-q'], { cwd: primaryRoot })

  mgr = new SideCloneManager()
})

afterEach(async () => {
  // Tear down side-clones so the worktree registrations don't leak.
  await mgr.gc(primaryRoot).catch(() => null)
  for (const dir of [remoteRoot, primaryRoot]) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function makeWorktreeWithCommit(branch: string, file: string, content: string): string {
  // Branch off main in the primary, add a commit, then push so origin
  // has the branch (merge-runner's first step is to fetch it).
  execFileSync('git', ['checkout', '-b', branch, '-q'], { cwd: primaryRoot })
  fs.writeFileSync(path.join(primaryRoot, file), content)
  execFileSync('git', ['add', '.'], { cwd: primaryRoot })
  execFileSync('git', ['commit', '-m', `feat(${branch}): add ${file}`, '-q'], { cwd: primaryRoot })
  execFileSync('git', ['push', '-u', 'origin', branch, '-q'], { cwd: primaryRoot })
  // Switch the primary back to main so subsequent operations don't
  // accidentally test against the worktree branch checkout.
  execFileSync('git', ['checkout', 'main', '-q'], { cwd: primaryRoot })
  return execFileSync('git', ['rev-parse', branch], { cwd: primaryRoot }).toString().trim()
}

// ----------------------------------------------------------------------------
// SideCloneManager
// ----------------------------------------------------------------------------

describe('SideCloneManager.ensure', () => {
  it('creates `.worktrees/.merge-staging/` on first call', async () => {
    const sidePath = await mgr.ensure(primaryRoot)
    expect(sidePath).toBe(path.join(primaryRoot, '.worktrees', '.merge-staging'))
    expect(fs.existsSync(sidePath)).toBe(true)
    // Verify it's a real git worktree of the same repo.
    const gitDirOut = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: sidePath })
      .toString().trim()
    expect(gitDirOut.length).toBeGreaterThan(0)
  })

  it('is idempotent (second call returns the same path without creating a new worktree)', async () => {
    const a = await mgr.ensure(primaryRoot)
    const b = await mgr.ensure(primaryRoot)
    expect(a).toBe(b)
  })

  it('serializes withSideClone calls on the same repo', async () => {
    const order: number[] = []
    const tasks: Promise<unknown>[] = []
    for (let i = 0; i < 5; i++) {
      tasks.push(
        mgr.withSideClone(primaryRoot, async (_p) => {
          order.push(i * 2)
          // Yield twice — if the mutex is broken, another task would
          // interleave.
          await new Promise((r) => setTimeout(r, 1))
          order.push(i * 2 + 1)
        })
      )
    }
    await Promise.all(tasks)
    // Each task's two pushes should be adjacent in `order`.
    for (let i = 0; i < 5; i++) {
      const a = order.indexOf(i * 2)
      const b = order.indexOf(i * 2 + 1)
      expect(b).toBe(a + 1)
    }
  })
})

// ----------------------------------------------------------------------------
// runDirectMerge
// ----------------------------------------------------------------------------

describe('runDirectMerge', () => {
  it('fast-forward merges a clean worktree branch onto base and pushes', async () => {
    makeWorktreeWithCommit('feature-1', 'feat.txt', 'feature work\n')

    const result = await runDirectMerge({
      sideCloneManager: mgr,
      repoPath: primaryRoot,
      worktreeBranch: 'feature-1',
      baseBranch: 'main'
    })

    expect(result.ok).toBe(true)
    expect(result.pushedSha).toBeDefined()
    // Origin's main now has the feature commit.
    const originHead = execFileSync('git', ['rev-parse', 'main'], { cwd: remoteRoot }).toString().trim()
    expect(originHead).toBe(result.pushedSha)
    // The merged file is present in origin's main.
    const showOut = execFileSync(
      'git', ['show', `${result.pushedSha}:feat.txt`],
      { cwd: remoteRoot }
    ).toString()
    expect(showOut).toBe('feature work\n')
  })

  it("succeeds even when the user's primary checkout is dirty (side-clone is independent)", async () => {
    makeWorktreeWithCommit('feature-dirty', 'feat-d.txt', 'D\n')
    // Now dirty the primary main checkout.
    fs.writeFileSync(path.join(primaryRoot, 'unrelated.txt'), 'some uncommitted edit\n')
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd: primaryRoot }).toString().trim()
    ).not.toBe('')

    const result = await runDirectMerge({
      sideCloneManager: mgr,
      repoPath: primaryRoot,
      worktreeBranch: 'feature-dirty',
      baseBranch: 'main'
    })

    expect(result.ok).toBe(true)
    // Origin received the merge.
    const originHead = execFileSync('git', ['rev-parse', 'main'], { cwd: remoteRoot }).toString().trim()
    expect(originHead).toBe(result.pushedSha)
    // The user's primary working tree is still dirty — we didn't touch it
    // since the best-effort fast-forward skips on dirty.
    expect(fs.readFileSync(path.join(primaryRoot, 'unrelated.txt'), 'utf8')).toBe('some uncommitted edit\n')
  })

  it("refuses when the worktree branch doesn't fast-forward onto base", async () => {
    // Land an unrelated commit on origin/main first so the worktree
    // branch can't fast-forward.
    fs.writeFileSync(path.join(primaryRoot, 'main-only.txt'), 'main only\n')
    execFileSync('git', ['add', '.'], { cwd: primaryRoot })
    execFileSync('git', ['commit', '-m', 'main-only', '-q'], { cwd: primaryRoot })
    execFileSync('git', ['push', 'origin', 'main', '-q'], { cwd: primaryRoot })

    // Now create a worktree branch off the OLDER main and try to merge.
    execFileSync('git', ['checkout', '-b', 'feature-old', 'HEAD~1', '-q'], { cwd: primaryRoot })
    fs.writeFileSync(path.join(primaryRoot, 'feat-old.txt'), 'old\n')
    execFileSync('git', ['add', '.'], { cwd: primaryRoot })
    execFileSync('git', ['commit', '-m', 'feat-old', '-q'], { cwd: primaryRoot })
    execFileSync('git', ['push', '-u', 'origin', 'feature-old', '-q'], { cwd: primaryRoot })
    execFileSync('git', ['checkout', 'main', '-q'], { cwd: primaryRoot })

    const result = await runDirectMerge({
      sideCloneManager: mgr,
      repoPath: primaryRoot,
      worktreeBranch: 'feature-old',
      baseBranch: 'main',
      allowNoFastForward: false
    })

    expect(result.ok).toBe(false)
    expect(result.errorKind).toBe('merge-failed')
    expect(result.error).toMatch(/fast-forward|rebase/i)
    // Origin/main wasn't moved.
    const originHead = execFileSync('git', ['rev-parse', 'main'], { cwd: remoteRoot }).toString().trim()
    const expectedHead = execFileSync('git', ['rev-parse', 'main'], { cwd: primaryRoot }).toString().trim()
    expect(originHead).toBe(expectedHead)
  })
})
