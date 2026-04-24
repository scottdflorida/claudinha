/**
 * migrate-user-data — Claudio → Claudinha userData folder copy.
 *
 * Module-level side effect runs once on import. Idempotent: if the new folder
 * already has .json state, no copy. Non-throwing: fs errors never propagate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ---------------------------------------------------------------------------
// Mock electron.app.getPath — we drive the userData location from test state
// ---------------------------------------------------------------------------

let currentUserDataPath = ''
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath: ${name}`)
      return currentUserDataPath
    }
  }
}))

// ---------------------------------------------------------------------------
// Helpers — real tmp directories so we exercise actual fs behavior
// ---------------------------------------------------------------------------

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudinha-migrate-test-'))
}

function seedOldState(appSupport: string, files: Record<string, string>): string {
  const old = path.join(appSupport, 'Claudio')
  fs.mkdirSync(old, { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(old, name), contents)
  }
  return old
}

async function runMigration(): Promise<void> {
  // Reset the module so its top-level code re-runs under the current mock state
  vi.resetModules()
  await import('../src/main/migrate-user-data')
}

describe('migrate-user-data', () => {
  let tmpRoot = ''

  beforeEach(() => {
    tmpRoot = makeTmpRoot()
    currentUserDataPath = path.join(tmpRoot, 'Claudinha')
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('copies .json files from legacy Claudio/ to new Claudinha/ when new is empty', async () => {
    seedOldState(tmpRoot, {
      'workspace-store.json': '{"workspaces.all":[]}',
      'config.json': '{"theme":"dark"}'
    })

    await runMigration()

    expect(fs.existsSync(path.join(currentUserDataPath, 'workspace-store.json'))).toBe(true)
    expect(fs.existsSync(path.join(currentUserDataPath, 'config.json'))).toBe(true)
    expect(fs.readFileSync(path.join(currentUserDataPath, 'config.json'), 'utf8')).toBe('{"theme":"dark"}')
  })

  it('is idempotent — skips copy when the new folder already has .json state', async () => {
    seedOldState(tmpRoot, {
      'workspace-store.json': '{"workspaces.all":["LEGACY"]}'
    })
    // Populate the new folder first — simulates a second launch
    fs.mkdirSync(currentUserDataPath, { recursive: true })
    fs.writeFileSync(path.join(currentUserDataPath, 'workspace-store.json'), '{"workspaces.all":["FRESH"]}')

    await runMigration()

    // New state must be preserved, not clobbered by the legacy value
    const newState = fs.readFileSync(path.join(currentUserDataPath, 'workspace-store.json'), 'utf8')
    expect(newState).toBe('{"workspaces.all":["FRESH"]}')
  })

  it('does nothing when no legacy Claudio/ folder exists', async () => {
    // Only the new folder setup (still empty), no legacy seeded
    await runMigration()

    // The new folder may or may not exist — but it must not contain claudio state
    if (fs.existsSync(currentUserDataPath)) {
      expect(fs.readdirSync(currentUserDataPath).filter((f) => f.endsWith('.json'))).toEqual([])
    }
  })

  it('leaves the legacy folder in place after copy (rollback-safe)', async () => {
    const oldPath = seedOldState(tmpRoot, {
      'config.json': '{"x":1}'
    })

    await runMigration()

    expect(fs.existsSync(oldPath)).toBe(true)
    expect(fs.existsSync(path.join(oldPath, 'config.json'))).toBe(true)
  })

  it('skips non-.json files and subdirectories', async () => {
    const oldPath = seedOldState(tmpRoot, {
      'config.json': '{}'
    })
    fs.writeFileSync(path.join(oldPath, 'unrelated.txt'), 'ignore me')
    fs.mkdirSync(path.join(oldPath, 'subdir'))
    fs.writeFileSync(path.join(oldPath, 'subdir', 'nested.json'), '{}')

    await runMigration()

    expect(fs.existsSync(path.join(currentUserDataPath, 'config.json'))).toBe(true)
    expect(fs.existsSync(path.join(currentUserDataPath, 'unrelated.txt'))).toBe(false)
    expect(fs.existsSync(path.join(currentUserDataPath, 'subdir'))).toBe(false)
  })

  it('never throws — fs errors are swallowed so migration failure does not block launch', async () => {
    // Point userData at a location that will fail mkdir — an existing FILE at that path
    const failPath = path.join(tmpRoot, 'blocked-as-file')
    fs.writeFileSync(failPath, 'not a dir')
    currentUserDataPath = failPath
    seedOldState(tmpRoot, { 'config.json': '{}' })

    await expect(runMigration()).resolves.not.toThrow()
  })
})
