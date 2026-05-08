/**
 * Integration tests for `projectTurnsForPane`'s Pane-Id trailer filter.
 *
 * Repro of the M2.5 bug: in main mode, all panes share a branch, so the git
 * range `origin/main..HEAD` returns every pane's commits to every projection
 * call. The fix tags each commit with a `Claudinha-Pane-Id` trailer and
 * filters the projection to commits whose trailer matches the requesting
 * paneId. Legacy commits without the trailer are surfaced for every pane
 * (so existing sessions don't lose visible history).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'

import { projectTurnsForPane } from '../src/main/turn-projection'
import { formatTurnCommitMessage } from '../src/main/turn-recorder'

let repoRoot: string

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudinha-pane-filter-test-'))
  fs.mkdirSync(repoRoot, { recursive: true })
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot })

  // Initial commit on main so HEAD is real.
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'init\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot })
  execFileSync('git', ['commit', '-m', 'init', '-q'], { cwd: repoRoot })

  // Simulate origin/main pointing at the initial commit so the main-mode
  // projection range `origin/main..HEAD` is non-empty after subsequent
  // commits land. We can't easily set up a real remote in a test, so we
  // create a local "origin/main" ref directly.
  const initSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
  fs.mkdirSync(path.join(repoRoot, '.git/refs/remotes/origin'), { recursive: true })
  fs.writeFileSync(path.join(repoRoot, '.git/refs/remotes/origin/main'), `${initSha}\n`)
})

afterEach(() => {
  try { fs.rmSync(repoRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

function commitWithTrailer(turnIndex: number, paneId: string, fileName: string, content: string): string {
  fs.writeFileSync(path.join(repoRoot, fileName), content)
  execFileSync('git', ['add', fileName], { cwd: repoRoot })
  const turnId = `turn-${turnIndex}-${paneId}`
  const msg = formatTurnCommitMessage(turnIndex, `add ${fileName}`, turnId, paneId)
  execFileSync('git', ['commit', '-m', msg, '-q'], { cwd: repoRoot })
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
}

describe('projectTurnsForPane — Pane-Id trailer filter', () => {
  it('main mode: filters commits to the requesting pane', async () => {
    // Three panes share `main`; pane-A makes two commits, pane-B makes one.
    const aSha1 = commitWithTrailer(1, 'pane-A', 'a1.txt', 'a1\n')
    const bSha1 = commitWithTrailer(2, 'pane-B', 'b1.txt', 'b1\n')
    const aSha2 = commitWithTrailer(3, 'pane-A', 'a2.txt', 'a2\n')

    const aTurns = await projectTurnsForPane(repoRoot, 'pane-A', 'main', 'main')
    expect(aTurns.map((t) => t.commitSha)).toEqual([aSha1, aSha2])
    expect(aTurns.every((t) => t.paneId === 'pane-A')).toBe(true)

    const bTurns = await projectTurnsForPane(repoRoot, 'pane-B', 'main', 'main')
    expect(bTurns.map((t) => t.commitSha)).toEqual([bSha1])
    expect(bTurns[0]!.paneId).toBe('pane-B')

    const cTurns = await projectTurnsForPane(repoRoot, 'pane-C', 'main', 'main')
    expect(cTurns).toEqual([])
  })

  it('main mode: legacy commits without a Pane-Id trailer surface for every pane', async () => {
    // A commit with NO Pane-Id trailer. Simulates a wip-commit landed before
    // the trailer fix shipped — those should still be visible to all panes
    // so users don't lose visible history mid-upgrade.
    fs.writeFileSync(path.join(repoRoot, 'legacy.txt'), 'legacy\n')
    execFileSync('git', ['add', 'legacy.txt'], { cwd: repoRoot })
    execFileSync('git', ['commit', '-m', 'wip(turn-1): legacy\n\nClaudinha-Turn-Id: legacy-id\n', '-q'], { cwd: repoRoot })
    const legacySha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()

    // And a tagged commit owned by pane-A.
    const aSha = commitWithTrailer(2, 'pane-A', 'a.txt', 'a\n')

    // pane-A sees both (its own + legacy).
    const aTurns = await projectTurnsForPane(repoRoot, 'pane-A', 'main', 'main')
    expect(aTurns.map((t) => t.commitSha)).toEqual([legacySha, aSha])

    // pane-B sees only the legacy one.
    const bTurns = await projectTurnsForPane(repoRoot, 'pane-B', 'main', 'main')
    expect(bTurns.map((t) => t.commitSha)).toEqual([legacySha])
  })

  it('worktree mode: filter is a no-op when commits already match the pane', async () => {
    // Worktree mode: every commit on this branch is from the same pane.
    execFileSync('git', ['checkout', '-b', 'wt-x', '-q'], { cwd: repoRoot })
    const s1 = commitWithTrailer(1, 'pane-X', 'x1.txt', 'x1\n')
    const s2 = commitWithTrailer(2, 'pane-X', 'x2.txt', 'x2\n')

    const turns = await projectTurnsForPane(repoRoot, 'pane-X', 'main', 'wt-x')
    expect(turns.map((t) => t.commitSha)).toEqual([s1, s2])
  })
})
