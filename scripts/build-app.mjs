#!/usr/bin/env node
/**
 * Run `electron-vite build && electron-builder` while temporarily moving
 * `electron` from `dependencies` to `devDependencies` in package.json.
 *
 * Why: electron-builder refuses to package while `electron` is a real
 * dependency (it would duplicate the binary inside the .app). But
 * `bin/claudinha` does `require('electron')` at runtime, so `electron`
 * must remain in `dependencies` for `npm install -g claudinha` to work.
 *
 * The fix: mutate package.json on disk just for the duration of the build,
 * then restore the original bytes in a finally block (and on SIGINT/SIGTERM)
 * so the canonical package.json is never left swapped on disk.
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const pkgPath = resolve(repoRoot, 'package.json')

const original = readFileSync(pkgPath, 'utf8')

let restored = false
const restore = () => {
  if (restored) return
  writeFileSync(pkgPath, original, 'utf8')
  restored = true
}

const onSignal = (signal) => {
  restore()
  process.exit(signal === 'SIGINT' ? 130 : 143)
}
process.on('SIGINT', () => onSignal('SIGINT'))
process.on('SIGTERM', () => onSignal('SIGTERM'))

const localBin = (name) => resolve(repoRoot, 'node_modules', '.bin', name)

let exitCode = 0
try {
  const pkg = JSON.parse(original)
  if (pkg.dependencies?.electron) {
    pkg.devDependencies = pkg.devDependencies ?? {}
    pkg.devDependencies.electron = pkg.dependencies.electron
    delete pkg.dependencies.electron
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  }

  const steps = [
    [localBin('electron-vite'), ['build']],
    [localBin('electron-builder'), []]
  ]
  for (const [cmd, args] of steps) {
    const result = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' })
    if (result.status !== 0) {
      exitCode = result.status ?? 1
      break
    }
  }
} finally {
  restore()
}

// Post-build guard: confirm scripts/ landed OUTSIDE the asar archive in the
// macOS .app bundle. If `electron-builder.yml` regresses (e.g. someone moves
// scripts/ back under `files:`), the relay scripts get packed into app.asar
// — a file, not a directory — and Claude Code's hook executor fails with
// "/bin/sh: …/app.asar/scripts/claudinha-hook-relay.sh: Not a directory".
// We catch that here so it can never ship silently.
if (exitCode === 0 && process.platform === 'darwin') {
  const distDir = resolve(repoRoot, 'dist')
  const requiredScripts = ['claudinha-hook-relay.sh', 'claudinha-statusline.sh']
  const macAppDirs = existsSync(distDir)
    ? readdirSync(distDir).filter((name) => /^mac/.test(name))
    : []
  if (macAppDirs.length === 0) {
    console.warn('[build-app] no dist/mac* directory found — skipping asar layout check')
  } else {
    for (const macDir of macAppDirs) {
      const resourcesDir = resolve(
        distDir,
        macDir,
        'Claudinha.app/Contents/Resources/scripts'
      )
      if (!existsSync(resourcesDir) || !statSync(resourcesDir).isDirectory()) {
        console.error(
          `[build-app] FAIL: ${resourcesDir} missing — scripts/ must ship as extraResources, not inside app.asar`
        )
        exitCode = 1
        continue
      }
      for (const script of requiredScripts) {
        const scriptPath = resolve(resourcesDir, script)
        if (!existsSync(scriptPath) || !statSync(scriptPath).isFile()) {
          console.error(`[build-app] FAIL: ${scriptPath} not found`)
          exitCode = 1
        }
      }
    }
  }
}

process.exit(exitCode)
