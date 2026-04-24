/**
 * Tests for the repo-claude-md module: read/write/commit/optional-push with
 * the mtime-based external-modification guard. Uses a real tempdir + git
 * repo so git commands execute against a deterministic filesystem.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import fsp from 'fs/promises'
import { execFileSync } from 'child_process'

import { readClaudeMd, writeAndCommitClaudeMd } from '../src/main/repo-claude-md'

function initRepo(repoRoot: string): void {
  fs.mkdirSync(repoRoot, { recursive: true })
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot })
  // Create an initial empty commit so HEAD is valid.
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init', '-q'], { cwd: repoRoot })
}

function headCommitMessage(repoRoot: string): string {
  return execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repoRoot })
    .toString()
    .trim()
}

function hasWorkingTreeChanges(repoRoot: string): boolean {
  const out = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot }).toString()
  return out.trim().length > 0
}

let repoRoot: string

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-md-test-'))
  initRepo(repoRoot)
})

afterEach(() => {
  try {
    fs.rmSync(repoRoot, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

// ---------------------------------------------------------------------------
// readClaudeMd
// ---------------------------------------------------------------------------

describe('readClaudeMd', () => {
  it('returns empty content + mtime 0 when the file does not exist yet', async () => {
    const { content, mtimeMs } = await readClaudeMd(repoRoot)
    expect(content).toBe('')
    expect(mtimeMs).toBe(0)
  })

  it('reads existing content and returns its mtime', async () => {
    const fp = path.join(repoRoot, 'CLAUDE.md')
    fs.writeFileSync(fp, '# Hello\n', 'utf8')
    const stat = fs.statSync(fp)
    const { content, mtimeMs } = await readClaudeMd(repoRoot)
    expect(content).toBe('# Hello\n')
    expect(mtimeMs).toBe(stat.mtimeMs)
  })
})

// ---------------------------------------------------------------------------
// writeAndCommitClaudeMd — happy path + commit
// ---------------------------------------------------------------------------

describe('writeAndCommitClaudeMd', () => {
  it('creates the file, commits on the base branch, and leaves the tree clean', async () => {
    const result = await writeAndCommitClaudeMd({
      repoRoot,
      content: '# Project rules\n',
      expectedMtimeMs: 0, // file does not exist yet
      push: false
    })
    expect(result.error).toBeNull()
    expect(result.pushError).toBeUndefined()
    expect(fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8')).toBe('# Project rules\n')
    expect(headCommitMessage(repoRoot)).toBe('Update CLAUDE.md')
    expect(hasWorkingTreeChanges(repoRoot)).toBe(false)
  })

  it('updates an existing file when mtime matches', async () => {
    const fp = path.join(repoRoot, 'CLAUDE.md')
    fs.writeFileSync(fp, 'v1\n', 'utf8')
    execFileSync('git', ['add', 'CLAUDE.md'], { cwd: repoRoot })
    execFileSync('git', ['commit', '-m', 'seed', '-q'], { cwd: repoRoot })
    const firstStat = fs.statSync(fp)

    const result = await writeAndCommitClaudeMd({
      repoRoot,
      content: 'v2\n',
      expectedMtimeMs: firstStat.mtimeMs,
      push: false
    })
    expect(result.error).toBeNull()
    expect(fs.readFileSync(fp, 'utf8')).toBe('v2\n')
    expect(headCommitMessage(repoRoot)).toBe('Update CLAUDE.md')
  })

  // -------------------------------------------------------------------------
  // External modification guard
  // -------------------------------------------------------------------------

  it('refuses to stomp external modifications (modified-externally)', async () => {
    const fp = path.join(repoRoot, 'CLAUDE.md')
    fs.writeFileSync(fp, 'original\n', 'utf8')
    const originalStat = fs.statSync(fp)

    // Another process writes to the file, bumping its mtime.
    await new Promise((r) => setTimeout(r, 20))
    fs.writeFileSync(fp, 'outsider changed me\n', 'utf8')

    const result = await writeAndCommitClaudeMd({
      repoRoot,
      content: 'editor would stomp',
      expectedMtimeMs: originalStat.mtimeMs,
      push: false
    })
    expect(result.error).toBe('modified-externally')
    expect(result.freshContent).toBe('outsider changed me\n')
    expect(typeof result.freshMtimeMs).toBe('number')
    // File on disk is unchanged (the outsider's content survives).
    expect(fs.readFileSync(fp, 'utf8')).toBe('outsider changed me\n')
    // No commit was created.
    expect(headCommitMessage(repoRoot)).toBe('init')
  })

  it('refuses the save when the file appeared out of nowhere (expected missing)', async () => {
    const fp = path.join(repoRoot, 'CLAUDE.md')
    // Someone else wrote the file between our read and save.
    fs.writeFileSync(fp, 'outsider seeded this\n', 'utf8')

    const result = await writeAndCommitClaudeMd({
      repoRoot,
      content: 'editor thought this was a first edit',
      expectedMtimeMs: 0,
      push: false
    })
    expect(result.error).toBe('modified-externally')
    expect(result.freshContent).toBe('outsider seeded this\n')
  })

  // -------------------------------------------------------------------------
  // No-op commit (write same bytes)
  // -------------------------------------------------------------------------

  it('treats "nothing to commit" as success (idempotent save)', async () => {
    const fp = path.join(repoRoot, 'CLAUDE.md')
    fs.writeFileSync(fp, 'same\n', 'utf8')
    execFileSync('git', ['add', 'CLAUDE.md'], { cwd: repoRoot })
    execFileSync('git', ['commit', '-m', 'seed', '-q'], { cwd: repoRoot })
    const stat = fs.statSync(fp)

    const result = await writeAndCommitClaudeMd({
      repoRoot,
      content: 'same\n',
      expectedMtimeMs: stat.mtimeMs,
      push: false
    })
    expect(result.error).toBeNull()
    // HEAD is still the seed commit (no new commit for a no-op).
    expect(headCommitMessage(repoRoot)).toBe('seed')
  })

  // -------------------------------------------------------------------------
  // Push leg (surfaced independently)
  // -------------------------------------------------------------------------

  it('surfaces push failure as pushError without rolling back the commit', async () => {
    // The repo has no remote configured, so git push will fail. The commit
    // must persist; pushError must be set.
    const result = await writeAndCommitClaudeMd({
      repoRoot,
      content: '# with push attempt\n',
      expectedMtimeMs: 0,
      push: true
    })
    expect(result.error).toBeNull()
    expect(result.pushError).toBeTruthy()
    // The commit DID happen.
    expect(headCommitMessage(repoRoot)).toBe('Update CLAUDE.md')
    expect(hasWorkingTreeChanges(repoRoot)).toBe(false)
  })
})
