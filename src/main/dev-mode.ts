import { app } from 'electron'
import { join } from 'node:path'

// Side-effect on module load: in unpackaged dev runs (npm run dev), redirects
// the app name and userData folder to a sibling location so the dev process
// can coexist with an installed /Applications/Claudinha.app.
//
// Why this is required: Electron's requestSingleInstanceLock() writes its
// SingletonLock file inside the app's userData directory. The installed bundle
// uses productName "Claudinha" and the dev binary uses package.json name
// "claudinha"; on case-insensitive macOS and Windows filesystems those two
// names resolve to the same directory, so the two processes share the same
// lock file. The dev process loses the race, app.quit()s, and the window
// never appears. Pointing dev at "claudinha-dev/" gives it its own lock and
// its own workspaces/sessions DB.
//
// MUST run before any code reads app.getPath('userData') — in particular
// before src/main/migrate-user-data.ts, which is why this file is imported
// as the very first line of src/main/index.ts.
if (!app.isPackaged) {
  app.setName('claudinha-dev')
  app.setPath('userData', join(app.getPath('appData'), 'claudinha-dev'))
}

export {}
