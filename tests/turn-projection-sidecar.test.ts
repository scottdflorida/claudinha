/**
 * Sidecar IO tests for turn-projection.
 *
 * The discarded-turns sidecar is the only persisted state in the v2 model
 * — git itself is the source of truth for the turn list, but discards
 * remove a commit from `git log`, so we keep a tiny per-worktree JSON
 * record so the projection can mark `discarded` / `superseded` rows for
 * telemetry and undo prompts.
 *
 * These tests pin the IO contract: read returns a defaulted shape on
 * missing/malformed files, write is atomic via tmp+rename.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { readDiscardedSidecar, writeDiscardedSidecar } from '../src/main/turn-projection'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudinha-sidecar-test-'))
})

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('readDiscardedSidecar', () => {
  it('returns an empty default when the file is missing', async () => {
    const out = await readDiscardedSidecar(tmpDir)
    expect(out).toEqual({ version: 1, discarded: {} })
  })

  it('reads a valid sidecar back into structured form', async () => {
    const sidecar = {
      version: 1 as const,
      discarded: {
        'turn-uuid-1': {
          commitSha: 'abc123def456',
          discardedAt: 1_700_000_000_000,
          originalIndex: 3
        }
      }
    }
    fs.writeFileSync(
      path.join(tmpDir, '.claudinha-turns.json'),
      JSON.stringify(sidecar),
      'utf8'
    )
    const out = await readDiscardedSidecar(tmpDir)
    expect(out.discarded['turn-uuid-1']!.commitSha).toBe('abc123def456')
    expect(out.discarded['turn-uuid-1']!.originalIndex).toBe(3)
  })

  it('returns an empty default when the file is malformed JSON', async () => {
    fs.writeFileSync(path.join(tmpDir, '.claudinha-turns.json'), 'not json {}{}', 'utf8')
    const out = await readDiscardedSidecar(tmpDir)
    expect(out).toEqual({ version: 1, discarded: {} })
  })

  it('returns an empty default when the version field is missing or wrong', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.claudinha-turns.json'),
      JSON.stringify({ version: 99, discarded: {} }),
      'utf8'
    )
    const out = await readDiscardedSidecar(tmpDir)
    expect(out).toEqual({ version: 1, discarded: {} })
  })

  it('returns an empty default when discarded is null', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.claudinha-turns.json'),
      JSON.stringify({ version: 1, discarded: null }),
      'utf8'
    )
    const out = await readDiscardedSidecar(tmpDir)
    expect(out).toEqual({ version: 1, discarded: {} })
  })
})

describe('writeDiscardedSidecar', () => {
  it('writes a JSON file the next read can parse back', async () => {
    const sidecar = {
      version: 1 as const,
      discarded: {
        'id-a': {
          commitSha: 'sha-a',
          discardedAt: 1,
          originalIndex: 1,
          supersededBy: ['id-b']
        }
      }
    }
    await writeDiscardedSidecar(tmpDir, sidecar)
    const read = await readDiscardedSidecar(tmpDir)
    expect(read.discarded['id-a']!.commitSha).toBe('sha-a')
    expect(read.discarded['id-a']!.supersededBy).toEqual(['id-b'])
  })

  it('uses tmp+rename so a partial write does not corrupt the previous sidecar', async () => {
    // Initial good content.
    await writeDiscardedSidecar(tmpDir, { version: 1, discarded: {} })
    const original = fs.readFileSync(path.join(tmpDir, '.claudinha-turns.json'), 'utf8')
    expect(original).toContain('"version"')
    // The atomic-rename behavior is the contract; we don't simulate a crash
    // here, but we do verify that after a successful write the temp file is
    // gone.
    await writeDiscardedSidecar(tmpDir, {
      version: 1,
      discarded: { x: { commitSha: 'y', discardedAt: 0, originalIndex: 1 } }
    })
    expect(fs.existsSync(path.join(tmpDir, '.claudinha-turns.json.tmp'))).toBe(false)
  })

  it('overwrites an existing sidecar', async () => {
    await writeDiscardedSidecar(tmpDir, {
      version: 1,
      discarded: { keep: { commitSha: 'a', discardedAt: 0, originalIndex: 1 } }
    })
    await writeDiscardedSidecar(tmpDir, {
      version: 1,
      discarded: { fresh: { commitSha: 'b', discardedAt: 0, originalIndex: 1 } }
    })
    const read = await readDiscardedSidecar(tmpDir)
    expect(read.discarded['keep']).toBeUndefined()
    expect(read.discarded['fresh']!.commitSha).toBe('b')
  })

  it('does not throw when the directory is unwritable (best-effort)', async () => {
    const nonExistentDir = path.join(tmpDir, 'does-not-exist')
    await expect(
      writeDiscardedSidecar(nonExistentDir, { version: 1, discarded: {} })
    ).resolves.toBeUndefined()
  })
})
