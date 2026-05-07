/**
 * Tests for ensureClaudinhaPathsIgnored — the helper that writes Claudinha's
 * infrastructure dirs (.worktrees/, .claude/) to .git/info/exclude on every
 * worktree-creation pass. Real-git integration tests against tmp repos because
 * the helper's correctness depends on git's actual ignore-resolution semantics
 * (`git check-ignore`, `--git-common-dir`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'

import { ensureClaudinhaPathsIgnored } from '../src/main/git-status'

function initRepo(repoRoot: string): void {
  fs.mkdirSync(repoRoot, { recursive: true })
  execFileSync('git', ['init', '--initial-branch=main', '-q'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoRoot })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init', '-q'], { cwd: repoRoot })
}

function readExclude(repoRoot: string): string {
  const p = path.join(repoRoot, '.git', 'info', 'exclude')
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

function isIgnored(repoRoot: string, candidate: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', candidate], { cwd: repoRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

let repoRoot: string

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-ignored-test-'))
  initRepo(repoRoot)
})

afterEach(() => {
  try {
    fs.rmSync(repoRoot, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

describe('ensureClaudinhaPathsIgnored', () => {
  it('appends .worktrees/ and .claude/ to .git/info/exclude on a fresh repo', () => {
    expect(isIgnored(repoRoot, '.worktrees/')).toBe(false)
    expect(isIgnored(repoRoot, '.claude/')).toBe(false)

    ensureClaudinhaPathsIgnored(repoRoot)

    const contents = readExclude(repoRoot)
    expect(contents).toContain('.worktrees/')
    expect(contents).toContain('.claude/')
    expect(isIgnored(repoRoot, '.worktrees/')).toBe(true)
    expect(isIgnored(repoRoot, '.claude/')).toBe(true)
  })

  it('is idempotent — a second call does not duplicate lines', () => {
    ensureClaudinhaPathsIgnored(repoRoot)
    const first = readExclude(repoRoot)

    ensureClaudinhaPathsIgnored(repoRoot)
    const second = readExclude(repoRoot)

    expect(second).toBe(first)
    // Each entry appears exactly once.
    expect(second.match(/^\.worktrees\/$/gm)?.length).toBe(1)
    expect(second.match(/^\.claude\/$/gm)?.length).toBe(1)
  })

  it('skips a dir already ignored via tracked .gitignore (no exclude write needed)', () => {
    fs.writeFileSync(path.join(repoRoot, '.gitignore'), '.worktrees/\n', 'utf8')

    ensureClaudinhaPathsIgnored(repoRoot)

    // .worktrees/ was already ignored → not added to exclude. .claude/ still gets added.
    const contents = readExclude(repoRoot)
    expect(contents).not.toContain('.worktrees/')
    expect(contents).toContain('.claude/')
  })

  it('preserves pre-existing exclude content and entries the user wrote', () => {
    const excludePath = path.join(repoRoot, '.git', 'info', 'exclude')
    fs.writeFileSync(excludePath, '# user notes\nbuild/\n', 'utf8')

    ensureClaudinhaPathsIgnored(repoRoot)

    const contents = readExclude(repoRoot)
    expect(contents).toContain('# user notes')
    expect(contents).toContain('build/')
    expect(contents).toContain('.worktrees/')
    expect(contents).toContain('.claude/')
  })

  it('handles an exclude file missing a trailing newline without merging onto the prior line', () => {
    const excludePath = path.join(repoRoot, '.git', 'info', 'exclude')
    fs.writeFileSync(excludePath, 'build/', 'utf8') // no trailing newline

    ensureClaudinhaPathsIgnored(repoRoot)

    const contents = readExclude(repoRoot)
    // Each entry must be on its own line — i.e., 'build/.worktrees/' must NOT appear.
    expect(contents).not.toMatch(/build\/\.worktrees/)
    expect(contents.split('\n').filter((l) => l === '.worktrees/').length).toBe(1)
  })

  it('does not throw or create files when called on a non-git directory', () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'))
    try {
      expect(() => ensureClaudinhaPathsIgnored(nonRepo)).not.toThrow()
      expect(fs.existsSync(path.join(nonRepo, '.git'))).toBe(false)
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true })
    }
  })
})
