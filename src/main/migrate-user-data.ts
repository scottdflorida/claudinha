import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// Side-effect on module load: copies legacy Claudio/ userData into the new
// Claudinha/ folder on first launch after the Claudio → Claudinha rename.
// Runs before any electron-store instance is constructed so every store
// picks up the migrated state on its first read. Idempotent and non-throwing:
// a failure here must not prevent app launch, and a second launch after a
// successful migration is a no-op.
try {
  const newPath = app.getPath('userData')
  const alreadyHasState =
    fs.existsSync(newPath) && fs.readdirSync(newPath).some((f) => f.endsWith('.json'))
  if (!alreadyHasState) {
    const oldPath = path.join(path.dirname(newPath), 'Claudio')
    if (fs.existsSync(oldPath) && fs.readdirSync(oldPath).length > 0) {
      if (!fs.existsSync(newPath)) fs.mkdirSync(newPath, { recursive: true })
      for (const name of fs.readdirSync(oldPath)) {
        const src = path.join(oldPath, name)
        const dst = path.join(newPath, name)
        if (
          fs.statSync(src).isFile() &&
          name.endsWith('.json') &&
          !fs.existsSync(dst)
        ) {
          fs.copyFileSync(src, dst)
        }
      }
      console.log(
        `[migrate-user-data] Migrated Claudio → Claudinha userData (${oldPath} → ${newPath})`
      )
    }
  }
} catch (err) {
  console.warn('[migrate-user-data] User-data migration failed (non-fatal):', err)
}

export {}
