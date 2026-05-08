/**
 * Integration test for `rewordCommitBySha` — the helper that replaces the
 * old `git commit --amend` path so haiku-rename works even when another
 * pane on the same branch (main mode) commits between the placeholder and
 * the haiku response.
 *
 * The bug: with multiple panes on `main`, pane A's placeholder commit lands
 * at HEAD, then pane B commits its own placeholder, advancing HEAD past A.
 * When A's haiku returns and tries `git commit --amend`, HEAD points at B
 * — the amend would rewrite B's commit, so the old code bailed and A's
 * placeholder summary stayed forever. The fix uses `git commit-tree` +
 * `git rebase --onto` to rewrite A's commit by sha regardless of where HEAD
 * sits.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'

import { rewordCommitBySha, formatTurnCommitMessage, extractTurnIdFromCommitMessage, extractPaneIdFromCommitMessage } from '../src/main/turn-recorder'

let repoRoot: string

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudinha-reword-test-'))
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot })
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'init\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot })
  execFileSync('git', ['commit', '-m', 'init', '-q'], { cwd: repoRoot })
})

afterEach(() => {
  try { fs.rmSync(repoRoot, { recursive: true, force: true }) } catch { /* ignore */ }
})

function commit(file: string, content: string, message: string): string {
  fs.writeFileSync(path.join(repoRoot, file), content)
  execFileSync('git', ['add', file], { cwd: repoRoot })
  execFileSync('git', ['commit', '-m', message, '-q'], { cwd: repoRoot })
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
}

function shasOnMain(): string[] {
  return execFileSync('git', ['log', '--reverse', '--pretty=%H', 'main'], { cwd: repoRoot })
    .toString().trim().split('\n').filter(Boolean)
}

function readMessage(sha: string): string {
  return execFileSync('git', ['log', '-1', '--pretty=%B', sha], { cwd: repoRoot }).toString()
}

function readTree(sha: string): string {
  return execFileSync('git', ['rev-parse', `${sha}^{tree}`], { cwd: repoRoot }).toString().trim()
}

describe('rewordCommitBySha', () => {
  it('rewords a commit at HEAD (the no-descendants case)', async () => {
    const a = commit('a.txt', 'a\n', formatTurnCommitMessage(1, 'placeholder', 'turn-A', 'pane-A'))
    expect(shasOnMain()).toEqual(expect.arrayContaining([a]))

    const newMsg = formatTurnCommitMessage(1, 'add a.txt', 'turn-A', 'pane-A')
    const ok = await rewordCommitBySha(repoRoot, a, newMsg)
    expect(ok).toBe(true)

    const newHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
    expect(newHead).not.toBe(a) // sha churn — new commit, same content
    expect(readMessage(newHead)).toContain('add a.txt')
    expect(extractTurnIdFromCommitMessage(readMessage(newHead))).toBe('turn-A')
    expect(extractPaneIdFromCommitMessage(readMessage(newHead))).toBe('pane-A')
  })

  it('rewords a non-HEAD commit; descendants get re-applied with the same trees', async () => {
    // Pane A's placeholder.
    const a = commit('a.txt', 'a\n', formatTurnCommitMessage(1, 'placeholder', 'turn-A', 'pane-A'))
    // Pane B commits its own placeholder, advancing HEAD past A.
    const b = commit('b.txt', 'b\n', formatTurnCommitMessage(2, 'placeholder', 'turn-B', 'pane-B'))

    const aTree = readTree(a)
    const bTree = readTree(b)

    const newMsgA = formatTurnCommitMessage(1, 'add a.txt', 'turn-A', 'pane-A')
    const ok = await rewordCommitBySha(repoRoot, a, newMsgA)
    expect(ok).toBe(true)

    const log = shasOnMain()
    // After reword: 3 commits — initial, new-A, new-B (both new shas).
    expect(log.length).toBe(3)
    const [, newA, newB] = log
    expect(newA).not.toBe(a)
    expect(newB).not.toBe(b)

    // Tree content is preserved on both.
    expect(readTree(newA!)).toBe(aTree)
    expect(readTree(newB!)).toBe(bTree)

    // Pane A's reworded message landed on the new A.
    const aMsg = readMessage(newA!)
    expect(aMsg).toContain('add a.txt')
    expect(extractTurnIdFromCommitMessage(aMsg)).toBe('turn-A')
    expect(extractPaneIdFromCommitMessage(aMsg)).toBe('pane-A')

    // Pane B's commit message is untouched; just re-applied with new parent.
    const bMsg = readMessage(newB!)
    expect(bMsg).toContain('placeholder')
    expect(extractTurnIdFromCommitMessage(bMsg)).toBe('turn-B')
    expect(extractPaneIdFromCommitMessage(bMsg)).toBe('pane-B')
  })

  it('returns false when the target commit no longer exists', async () => {
    // No commit at this sha.
    const ok = await rewordCommitBySha(repoRoot, '0000000000000000000000000000000000000000', 'whatever\n')
    expect(ok).toBe(false)
  })
})
