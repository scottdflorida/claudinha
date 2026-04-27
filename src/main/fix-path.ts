import { execFileSync } from 'node:child_process'
import { app } from 'electron'

// Markers wrap the harvested PATH so we can extract it cleanly even when the
// user's shell rc files print MOTD banners, color codes, or prompt text.
const BEGIN = '__CLAUDINHA_PATH_BEGIN__'
const END = '__CLAUDINHA_PATH_END__'

export function extractPathFromShellOutput(stdout: string): string | null {
  const start = stdout.indexOf(BEGIN)
  if (start === -1) return null
  const end = stdout.indexOf(END, start + BEGIN.length)
  if (end === -1) return null
  const value = stdout.slice(start + BEGIN.length, end)
  return value.length > 0 ? value : null
}

/**
 * Harvest the user's interactive login shell PATH and apply it to
 * `process.env.PATH`.
 *
 * Why: macOS GUI apps launched by launchd (Dock, /Applications, Spotlight)
 * inherit a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) and do NOT read
 * the user's `.zshrc` / `.zprofile` / `.bashrc` / `.bash_profile`. As a
 * result, tools installed via Homebrew (`/opt/homebrew/bin`), nvm, asdf,
 * volta, npm globals, etc. are not on PATH inside the packaged app — and
 * any spawned PTY inherits the same minimal PATH. The user sees errors
 * like "Claude CLI not found" even though `claude` works fine in Terminal.
 *
 * Fix: at startup, run the user's $SHELL with `-ilc` to load both login
 * (.zprofile) and interactive (.zshrc) configs, print the resolved PATH
 * between marker strings, and apply it to process.env so the rest of the
 * main process (claude:check, git, PTY spawns) sees the same tools the
 * user does in Terminal. Skipped on Windows (no shell-rc PATH problem)
 * and in dev (npm run dev already inherits the launching terminal's PATH).
 */
export function fixPathForPackagedApp(): void {
  if (!app.isPackaged) return
  if (process.platform === 'win32') return

  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const stdout = execFileSync(
      shell,
      ['-ilc', `printf '%s%s%s' '${BEGIN}' "$PATH" '${END}'`],
      { timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }
    )
    const harvested = extractPathFromShellOutput(stdout)
    if (harvested) {
      process.env.PATH = harvested
    }
  } catch {
    // Login shell errored or timed out — keep the original (minimal) PATH.
    // The user will still see the "claude not found" modal, but no worse
    // off than before this fix existed.
  }
}
