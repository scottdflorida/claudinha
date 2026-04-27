import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { resolveEffectivePermissions } from './permissions-store'
import { sanitizePermissionRules } from '../shared/permission-rule'
import { trackSettingsMergeError } from './analytics/error-instrumentation'

// ---------------------------------------------------------------------------
// Internal types for .claude/settings.json structure
// ---------------------------------------------------------------------------

interface HookEntry {
  type: string
  command: string
  timeout?: number
}

interface HookMatcher {
  matcher: string
  hooks: HookEntry[]
}

interface ClaudeSettings {
  permissions?: {
    defaultMode?: string
    allow?: string[]
    deny?: string[]
  }
  hooks?: Record<string, HookMatcher[]>
  statusLine?: {
    type: string
    command: string
    padding?: number
  }
  // Preserve any unknown top-level fields the user may have set
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'StopFailure',
  'PostCompact'
] as const

// Recognises a Claudinha hook-relay or statusline invocation by script name,
// regardless of its path prefix. Stale absolute paths from earlier installs
// (e.g. /Users/.../orchard/scripts/claudinha-hook-relay.sh) match and get
// swept out when writeSettings runs against the worktree.
const CLAUDINHA_RELAY_PATTERN = /claudinha-hook-relay\.(?:sh|js)/
const CLAUDINHA_STATUSLINE_PATTERN = /claudinha-statusline\.(?:sh|js)/

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a bundled script in the scripts/ directory.
 *
 * In a packaged build, `app.getAppPath()` points inside `app.asar` (a single
 * archive file). External processes — notably Claude Code, which runs hooks
 * via `/bin/sh` — cannot traverse into the asar archive and would receive
 * `ENOTDIR` ("Not a directory") on every hook invocation. The packaging
 * config ships `scripts/` via `extraResources`, which lands the directory
 * at `process.resourcesPath/scripts/` (i.e. `Contents/Resources/scripts/`
 * on macOS) — a regular filesystem path any shell can exec.
 *
 * In dev (`npm run dev`), `app.isPackaged` is false and the path falls back
 * to `app.getAppPath()`, which is the project root.
 */
export function resolveScriptPath(scriptName: string): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, 'scripts', scriptName)
}

/**
 * Build the Claudinha hooks section for settings.json.
 * Each hook event gets a single matcher with the relay script command.
 */
function buildClaudinhaHooks(): Record<string, HookMatcher[]> {
  // Use Node.js relay on Windows (named pipe support, B-057); shell relay on Unix
  const relayScript =
    process.platform === 'win32'
      ? resolveScriptPath('claudinha-hook-relay.js')
      : resolveScriptPath('claudinha-hook-relay.sh')
  const result: Record<string, HookMatcher[]> = {}

  for (const event of HOOK_EVENTS) {
    result[event] = [
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            // On Windows: invoke via node; on Unix: invoke as shell script
            command:
              process.platform === 'win32'
                ? `node "${relayScript}" ${event}`
                : `"${relayScript}" ${event}`,
            timeout: 5
          }
        ]
      }
    ]
  }

  return result
}

/** Build the Claudinha statusline config for settings.json. */
function buildStatusLineConfig(): ClaudeSettings['statusLine'] {
  // Use Node.js script on Windows (no bash), shell script on Unix
  const scriptName = process.platform === 'win32'
    ? 'claudinha-statusline.js'
    : 'claudinha-statusline.sh'
  const scriptPath = resolveScriptPath(scriptName)
  return {
    type: 'command',
    command: process.platform === 'win32'
      ? `node "${scriptPath}"`
      : scriptPath,
    padding: 0
  }
}

// ---------------------------------------------------------------------------
// PermissionsManager
// ---------------------------------------------------------------------------

/**
 * PermissionsManager — writes `.claude/settings.json` at pane spawn time.
 *
 * On a fresh worktree: writes the full settings file with the default
 * permission preset, all 7 hook event configurations, and the statusline config.
 *
 * On an existing settings.json: merges — adds Claudinha entries to arrays without
 * removing user entries, preserves `defaultMode` if already set, skips
 * statusLine if the user has already configured one.
 *
 * A single instance is created in index.ts. Call writeSettings() inside the
 * pane:spawn IPC handler, before PtyPool.spawn().
 */
export class PermissionsManager {
  /**
   * Write (or merge) `.claude/settings.json` in the target worktree directory.
   *
   * @param worktreePath Absolute path to the worktree (where `.claude/` lives)
   */
  writeSettings(worktreePath: string): void {
    const claudeDir = path.join(worktreePath, '.claude')
    const settingsPath = path.join(claudeDir, 'settings.json')

    // Ensure .claude/ directory exists
    try {
      fs.mkdirSync(claudeDir, { recursive: true })
    } catch (err) {
      console.error('[permissions] failed to create .claude directory:', claudeDir, err)
      return
    }

    // Read existing settings if present
    let existing: ClaudeSettings = {}
    let hadExisting = false
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8')
      try {
        existing = JSON.parse(raw) as ClaudeSettings
        hadExisting = true
      } catch (err) {
        // Malformed JSON — log warning and start fresh (B-056)
        console.warn(
          '[permissions] settings.json is malformed JSON — writing fresh file:',
          settingsPath
        )
        const errName = err instanceof Error ? err.constructor.name : 'ParseError'
        trackSettingsMergeError(errName)
        existing = {}
        hadExisting = false
      }
    } catch {
      // File doesn't exist — that's fine, start fresh
    }

    const merged = this.mergeSettings(existing, hadExisting, worktreePath)

    try {
      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
    } catch (err) {
      // Read-only file or permission error — log and allow spawn to continue (B-056)
      // Claude Code will use its own defaults; Claudinha hooks won't fire but the
      // session can still run (PTY fallback will activate via B-054).
      console.error('[permissions] failed to write settings.json (read-only?):', settingsPath, err)
      const errName = err instanceof Error ? err.constructor.name : 'WriteError'
      trackSettingsMergeError(errName)
    }
  }

  /**
   * Mark a worktree as already trusted in the user's global Claude Code config
   * (~/.claude.json), so the "Quick safety check: is this a project you trust?"
   * prompt is skipped on first launch.
   *
   * Justification: Claudinha creates the worktree itself off a repo the user just
   * picked in the launch form. The user has implicitly trusted that repo by
   * selecting it. Asking again N times — once per terminal — is friction without
   * benefit. The launch form surfaces this implicit trust as a visible warning.
   *
   * The global config is read, mutated, and written back synchronously. Other
   * top-level fields are preserved verbatim. Failures are logged and ignored —
   * the worst case is that the user sees the original prompt.
   */
  markFolderTrusted(worktreePath: string): void {
    const configPath = path.join(os.homedir(), '.claude.json')
    let config: Record<string, unknown>
    try {
      const raw = fs.readFileSync(configPath, 'utf8')
      config = JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      // No existing config or unreadable — leave it alone. Claude Code will
      // create it on first run with the trust prompt visible.
      console.warn('[permissions] could not read ~/.claude.json to mark trust:', err)
      return
    }

    if (!config.projects || typeof config.projects !== 'object') {
      config.projects = {}
    }
    const projects = config.projects as Record<string, Record<string, unknown>>
    const entry = projects[worktreePath] ?? {}
    entry.hasTrustDialogAccepted = true
    projects[worktreePath] = entry

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    } catch (err) {
      console.warn('[permissions] failed to write ~/.claude.json (trust mark):', err)
    }
  }

  // ---------------------------------------------------------------------------
  // Private — merge logic
  // ---------------------------------------------------------------------------

  private mergeSettings(existing: ClaudeSettings, hadExisting: boolean, worktreePath: string): ClaudeSettings {
    // Spread existing to preserve unknown top-level fields
    const result: ClaudeSettings = { ...existing }

    this.mergePermissions(result, existing, worktreePath)
    this.mergeHooks(result, existing)
    this.mergeStatusLine(result, existing)

    if (hadExisting) {
      console.log('[permissions] merged Claudinha config into existing settings.json')
    }

    return result
  }

  private mergePermissions(result: ClaudeSettings, existing: ClaudeSettings, worktreePath: string): void {
    const existingPerms = existing.permissions ?? {}
    const existingAllow: string[] = existingPerms.allow ?? []
    const existingDeny: string[] = existingPerms.deny ?? []

    // Use effective permissions (defaults + user overrides) instead of raw defaults
    const effective = resolveEffectivePermissions(worktreePath)

    // Run every rule through the validator before it lands on disk. Claude
    // Code rejects the ENTIRE settings file on a single bad rule, so we must
    // never let an invalid entry leak through. This also self-heals stale
    // invalid entries left in storage from before validation existed.
    const onDropped = (rule: string, reason: string): void => {
      console.warn(`[permissions] dropped invalid rule "${rule}": ${reason}`)
    }
    const allow = sanitizePermissionRules([...existingAllow, ...effective.allow], onDropped)
    const deny = sanitizePermissionRules([...existingDeny, ...effective.deny], onDropped)

    const perms: Record<string, unknown> = { allow, deny }

    // Preserve user's defaultMode if already set; Claudinha does not impose one
    if (existingPerms.defaultMode) {
      perms.defaultMode = existingPerms.defaultMode
    }

    result.permissions = perms as ClaudeSettings['permissions']
  }

  private mergeHooks(result: ClaudeSettings, existing: ClaudeSettings): void {
    const claudinhaHooks = buildClaudinhaHooks()
    const existingHooks: Record<string, HookMatcher[]> = { ...(existing.hooks ?? {}) }

    for (const [event, claudinhaMatchers] of Object.entries(claudinhaHooks)) {
      const existingMatchers: HookMatcher[] = existingHooks[event] ?? []

      // Current (correct) Claudinha command strings for this event
      const currentCommands = new Set(
        claudinhaMatchers.flatMap((m) => m.hooks.map((h) => h.command))
      )

      // Strip any hook entry that *looks* like a Claudinha relay call but isn't
      // the current path — these are stale entries from an earlier install
      // (e.g. the app was previously named orchard/). User-authored hooks that
      // don't match the pattern pass through untouched.
      const cleaned: HookMatcher[] = []
      for (const matcher of existingMatchers) {
        const keptHooks = matcher.hooks.filter(
          (h) => !CLAUDINHA_RELAY_PATTERN.test(h.command) || currentCommands.has(h.command)
        )
        if (keptHooks.length > 0) {
          cleaned.push({ ...matcher, hooks: keptHooks })
        }
      }

      // Check whether the current (correct) Claudinha hook is already present
      // after cleaning — idempotent on repeated spawns with the same path.
      const alreadyPresent = cleaned.some((m) =>
        m.hooks.some((h) => currentCommands.has(h.command))
      )

      existingHooks[event] = alreadyPresent ? cleaned : [...cleaned, ...claudinhaMatchers]
    }

    result.hooks = existingHooks
  }

  private mergeStatusLine(result: ClaudeSettings, existing: ClaudeSettings): void {
    const existingCmd = existing.statusLine?.command ?? ''
    // Rewrite if no statusLine is configured, or if the existing one is a
    // stale Claudinha statusline (wrong path from an earlier install).
    // Non-Claudinha user statusLines are preserved.
    if (!existing.statusLine || CLAUDINHA_STATUSLINE_PATTERN.test(existingCmd)) {
      result.statusLine = buildStatusLineConfig()
    }
  }
}

// ---------------------------------------------------------------------------
// Startup sweep — heal stale Claudinha entries across known worktrees
// ---------------------------------------------------------------------------

/**
 * One-shot pass at app launch: rewrite `.claude/settings.json` in every
 * worktree the app remembers, so stale hook-relay paths (from a prior install
 * under a different directory name) stop flooding Claude Code with errors.
 *
 * Idempotent: a worktree whose settings already point at the current path
 * re-writes as a no-op.
 */
export function healStaleWorktreeSettings(
  pm: PermissionsManager,
  worktreePaths: Iterable<string>
): void {
  const seen = new Set<string>()
  for (const wt of worktreePaths) {
    if (!wt || seen.has(wt)) continue
    seen.add(wt)
    try {
      pm.writeSettings(wt)
    } catch (err) {
      console.warn('[permissions] startup sweep: writeSettings failed for', wt, err)
    }
  }
}
