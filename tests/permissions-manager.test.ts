/**
 * PermissionsManager unit tests.
 *
 * Verifies settings.json merge logic with mocked fs and electron.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
  }
}))

vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/home/test')
  }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/app'),
    isPackaged: false
  }
}))

// Mock permissions-store — resolveEffectivePermissions delegates to DEFAULT_PERMISSIONS
vi.mock('../src/main/permissions-store', async () => {
  const constants = await vi.importActual<typeof import('../src/main/constants')>('../src/main/constants')
  return {
    resolveEffectivePermissions: vi.fn(() => ({
      allow: [...constants.DEFAULT_PERMISSIONS.allow],
      deny: [...constants.DEFAULT_PERMISSIONS.deny]
    }))
  }
})

import fs from 'fs'
import { app as electronApp } from 'electron'
import { PermissionsManager, healStaleWorktreeSettings, resolveScriptPath } from '../src/main/permissions-manager'

const mockMkdirSync = vi.mocked(fs.mkdirSync)
const mockReadFileSync = vi.mocked(fs.readFileSync)
const mockWriteFileSync = vi.mocked(fs.writeFileSync)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWrittenConfig(): Record<string, unknown> {
  expect(mockWriteFileSync).toHaveBeenCalledOnce()
  const raw = mockWriteFileSync.mock.calls[0][1] as string
  return JSON.parse(raw) as Record<string, unknown>
}

function makeExistingSettings(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    permissions: { allow: [], deny: [] },
    ...overrides
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveScriptPath', () => {
  // Restore both isPackaged and process.resourcesPath after each test so the
  // rest of the file (which assumes dev-style behavior, isPackaged=false)
  // continues to compute paths off `app.getAppPath()` exactly as before.
  let savedResourcesDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    savedResourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    ;(electronApp as unknown as { isPackaged: boolean }).isPackaged = false
  })

  afterEach(() => {
    ;(electronApp as unknown as { isPackaged: boolean }).isPackaged = false
    if (savedResourcesDescriptor) {
      Object.defineProperty(process, 'resourcesPath', savedResourcesDescriptor)
    } else {
      // process.resourcesPath isn't defined under vitest by default; remove
      // anything a test wrote so subsequent tests see the original absence.
      delete (process as unknown as { resourcesPath?: string }).resourcesPath
    }
  })

  it('uses process.resourcesPath when packaged (path must not cross app.asar)', () => {
    ;(electronApp as unknown as { isPackaged: boolean }).isPackaged = true
    Object.defineProperty(process, 'resourcesPath', {
      value: '/Applications/Claudinha.app/Contents/Resources',
      configurable: true,
      writable: true
    })

    const p = resolveScriptPath('claudinha-hook-relay.sh')

    expect(p).toBe(
      '/Applications/Claudinha.app/Contents/Resources/scripts/claudinha-hook-relay.sh'
    )
    // The bug we are pinning a regression for: in a packaged build, the
    // path must NEVER traverse through `app.asar` — that's a file, not a
    // directory, and external shells (Claude Code's hook executor) cannot
    // walk into it. ENOTDIR ("Not a directory") is the symptom this guards.
    expect(p).not.toContain('app.asar')
  })

  it('uses app.getAppPath in development', () => {
    ;(electronApp as unknown as { isPackaged: boolean }).isPackaged = false

    const p = resolveScriptPath('claudinha-hook-relay.sh')

    expect(p).toBe('/app/scripts/claudinha-hook-relay.sh')
  })

  it('handles statusline script the same way (resourcesPath in packaged, getAppPath in dev)', () => {
    ;(electronApp as unknown as { isPackaged: boolean }).isPackaged = true
    Object.defineProperty(process, 'resourcesPath', {
      value: '/packaged/Resources',
      configurable: true,
      writable: true
    })
    expect(resolveScriptPath('claudinha-statusline.sh')).toBe(
      '/packaged/Resources/scripts/claudinha-statusline.sh'
    )

    ;(electronApp as unknown as { isPackaged: boolean }).isPackaged = false
    expect(resolveScriptPath('claudinha-statusline.sh')).toBe(
      '/app/scripts/claudinha-statusline.sh'
    )
  })
})

describe('PermissionsManager.writeSettings', () => {
  let pm: PermissionsManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdirSync.mockReturnValue(undefined as unknown as string)
    pm = new PermissionsManager()
  })

  // -------------------------------------------------------------------------
  // Fresh settings
  // -------------------------------------------------------------------------

  describe('fresh settings (no existing file)', () => {
    beforeEach(() => {
      mockReadFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
    })

    it('writes allow and deny without setting defaultMode', () => {
      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const perms = config.permissions as Record<string, unknown>
      expect(perms.defaultMode).toBeUndefined()
      expect(Array.isArray(perms.allow)).toBe(true)
      expect(Array.isArray(perms.deny)).toBe(true)
    })

    it('writes all 8 hook event entries', () => {
      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const hooks = config.hooks as Record<string, unknown>
      expect(hooks).toHaveProperty('SessionStart')
      expect(hooks).toHaveProperty('UserPromptSubmit')
      expect(hooks).toHaveProperty('PreToolUse')
      expect(hooks).toHaveProperty('PostToolUse')
      expect(hooks).toHaveProperty('Notification')
      expect(hooks).toHaveProperty('Stop')
      expect(hooks).toHaveProperty('StopFailure')
      expect(hooks).toHaveProperty('PostCompact')
    })

    it('writes statusLine config', () => {
      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const sl = config.statusLine as Record<string, unknown>
      expect(sl.type).toBe('command')
      expect(typeof sl.command).toBe('string')
    })

    it('uses .sh relay script on Unix', () => {
      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const hooks = config.hooks as Record<string, unknown[]>
      const matchers = hooks['SessionStart'] as Array<{ hooks: Array<{ command: string }> }>
      const command = matchers[0].hooks[0].command
      expect(command).toContain('claudinha-hook-relay.sh')
    })
  })

  // -------------------------------------------------------------------------
  // Existing settings — merge behaviour
  // -------------------------------------------------------------------------

  describe('existing settings with no hooks', () => {
    it('adds Claudinha hooks without touching user fields', () => {
      const existing = {
        permissions: { defaultMode: 'allowAllMode', allow: ['MyTool'], deny: [] },
        customUserField: 'preserved'
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const perms = config.permissions as Record<string, unknown>
      // User's defaultMode is preserved
      expect(perms.defaultMode).toBe('allowAllMode')
      // User's custom allow entry is preserved
      expect((perms.allow as string[]).includes('MyTool')).toBe(true)
      // Claudinha hooks are present
      expect((config.hooks as Record<string, unknown>)).toHaveProperty('SessionStart')
      // Unknown top-level field is preserved
      expect(config.customUserField).toBe('preserved')
    })
  })

  describe('existing settings with Claudinha hooks already present', () => {
    it('is idempotent — does not duplicate hook entries', () => {
      // First write: fresh
      mockReadFileSync.mockImplementationOnce(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      pm.writeSettings('/tmp/worktree')
      const firstConfig = getWrittenConfig()

      // Second write: existing config already has Claudinha hooks
      vi.clearAllMocks()
      mockMkdirSync.mockReturnValue(undefined as unknown as string)
      mockReadFileSync.mockReturnValue(JSON.stringify(firstConfig) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')
      const secondConfig = getWrittenConfig()

      const hooks = secondConfig.hooks as Record<string, Array<{ hooks: unknown[] }>>
      // Each event should have exactly one matcher with exactly one hook entry
      for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'StopFailure', 'PostCompact']) {
        expect(hooks[event]).toHaveLength(1)
        expect(hooks[event][0].hooks).toHaveLength(1)
      }
    })
  })

  describe('malformed JSON in existing settings', () => {
    it('logs a warning and writes a fresh config', () => {
      mockReadFileSync.mockReturnValue('{ not valid json !!!' as unknown as Buffer)
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      pm.writeSettings('/tmp/worktree')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[permissions]'),
        expect.any(String)
      )
      const config = getWrittenConfig()
      // Fresh config written — Claudinha does not set defaultMode
      expect((config.permissions as Record<string, unknown>).defaultMode).toBeUndefined()

      consoleSpy.mockRestore()
    })
  })

  describe('existing settings with user-owned hooks', () => {
    it('preserves user hooks alongside Claudinha hooks', () => {
      const userHook = {
        matcher: '*',
        hooks: [{ type: 'command', command: 'my-custom-script.sh' }]
      }
      const existing = {
        hooks: { SessionStart: [userHook] }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const sessionStart = (config.hooks as Record<string, unknown[]>)['SessionStart']
      // User's hook entry + Claudinha hook entry
      expect(sessionStart.length).toBe(2)
      const commands = (sessionStart as Array<{ hooks: Array<{ command: string }> }>)
        .flatMap((m) => m.hooks.map((h) => h.command))
      expect(commands.some((c) => c.includes('my-custom-script.sh'))).toBe(true)
      expect(commands.some((c) => c.includes('claudinha-hook-relay'))).toBe(true)
    })
  })

  describe('allow / deny union', () => {
    it('unions allow arrays with no duplicates', () => {
      const existing = {
        permissions: {
          // 'Read' and 'Edit' are also in DEFAULT_PERMISSIONS.allow
          allow: ['Read', 'Edit', 'MyCustomTool'],
          deny: []
        }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const allow = (config.permissions as Record<string, string[]>).allow
      const readCount = allow.filter((x) => x === 'Read').length
      expect(readCount).toBe(1)
      expect(allow.includes('MyCustomTool')).toBe(true)
    })

    it('unions deny arrays with no duplicates', () => {
      const existing = {
        permissions: {
          allow: [],
          // 'Bash(sudo *)' is also in DEFAULT_PERMISSIONS.deny
          deny: ['Bash(sudo *)', 'Bash(my-deny *)']
        }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const deny = (config.permissions as Record<string, string[]>).deny
      const sudoCount = deny.filter((x) => x === 'Bash(sudo *)').length
      expect(sudoCount).toBe(1)
      expect(deny.includes('Bash(my-deny *)')).toBe(true)
    })

    // Regression: a single bad rule (lowercase tool name) used to slip through
    // to settings.json, where Claude Code would discard the ENTIRE file on
    // startup with the in-terminal "Settings Error" dialog. The validator at
    // mergePermissions must filter invalid rules and normalize fixable ones.
    it('strips invalid rules and normalizes fixable rules from the existing allow list', () => {
      const existing = {
        permissions: {
          // 'add' (lowercase) — fixable. '123foo' — unfixable, must be dropped.
          // 'bash(npm test)' (lowercase tool name) — fixable.
          allow: ['add', '123foo', 'bash(npm test)', 'MyCustomTool'],
          deny: []
        }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const allow = (config.permissions as Record<string, string[]>).allow
      // Fixed up
      expect(allow).toContain('Add')
      expect(allow).toContain('Bash(npm test)')
      // Preserved (already canonical)
      expect(allow).toContain('MyCustomTool')
      // Dropped
      expect(allow).not.toContain('add')
      expect(allow).not.toContain('123foo')
      expect(allow).not.toContain('bash(npm test)')
    })

    it('strips invalid rules from the existing deny list as well', () => {
      const existing = {
        permissions: {
          allow: [],
          deny: ['bash(rm -rf /)', '???']
        }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const deny = (config.permissions as Record<string, string[]>).deny
      expect(deny).toContain('Bash(rm -rf /)')
      expect(deny).not.toContain('???')
    })
  })

  describe('Windows path', () => {
    it('hook relay command uses .js file on win32', () => {
      const savedDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      try {
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        })

        pm.writeSettings('/tmp/worktree')

        const config = getWrittenConfig()
        const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>
        const command = hooks['SessionStart'][0].hooks[0].command
        expect(command).toContain('claudinha-hook-relay.js')
        expect(command).not.toContain('claudinha-hook-relay.sh')
      } finally {
        if (savedDescriptor) {
          Object.defineProperty(process, 'platform', savedDescriptor)
        }
      }
    })

    it('statusline config uses .js script with node wrapper on win32', () => {
      const savedDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      try {
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        })

        pm.writeSettings('/tmp/worktree')

        const config = getWrittenConfig()
        const sl = config.statusLine as Record<string, unknown>
        expect(sl.command).toContain('claudinha-statusline.js')
        expect((sl.command as string).startsWith('node ')).toBe(true)
      } finally {
        if (savedDescriptor) {
          Object.defineProperty(process, 'platform', savedDescriptor)
        }
      }
    })
  })

  describe('Unix statusline path', () => {
    it('statusline config uses .sh script directly on non-win32', () => {
      mockReadFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const sl = config.statusLine as Record<string, unknown>
      expect(sl.command).toContain('claudinha-statusline.sh')
      expect((sl.command as string).startsWith('node ')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Stale hook-relay cleanup
  //
  // Regression: worktrees written by an earlier install (when the app lived at
  // a different directory, e.g. orchard/) had absolute claudinha-hook-relay.sh
  // paths pointing at a now-deleted location. On the next pane spawn, the old
  // code appended the current path alongside the stale one, so every hook
  // event fired twice — once successfully, once with "No such file or
  // directory", flooding Claude Code with hook error toasts.
  // -------------------------------------------------------------------------

  describe('stale Claudinha hook-relay entries (cross-install rename)', () => {
    function staleHookEntry(event: string): { matcher: string; hooks: Array<{ type: string; command: string; timeout?: number }> } {
      return {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: `"/Users/scottflorida/Documents/orchard/scripts/claudinha-hook-relay.sh" ${event}`,
            timeout: 5
          }
        ]
      }
    }

    it('replaces stale orchard relay hooks with the current path on every event', () => {
      const existing = {
        hooks: {
          SessionStart: [staleHookEntry('SessionStart')],
          UserPromptSubmit: [staleHookEntry('UserPromptSubmit')],
          PreToolUse: [staleHookEntry('PreToolUse')],
          PostToolUse: [staleHookEntry('PostToolUse')],
          Notification: [staleHookEntry('Notification')],
          Stop: [staleHookEntry('Stop')],
          StopFailure: [staleHookEntry('StopFailure')],
          PostCompact: [staleHookEntry('PostCompact')]
        }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const hooks = config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>
      for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'StopFailure', 'PostCompact']) {
        expect(hooks[event]).toHaveLength(1)
        expect(hooks[event][0].hooks).toHaveLength(1)
        const cmd = hooks[event][0].hooks[0].command
        expect(cmd).toContain('/app/scripts/claudinha-hook-relay.sh')
        expect(cmd).not.toContain('orchard')
      }
    })

    it('preserves user-authored hooks alongside the stale-entry sweep', () => {
      const existing = {
        hooks: {
          PostToolUse: [
            { matcher: '*', hooks: [{ type: 'command', command: 'echo hi' }] },
            staleHookEntry('PostToolUse')
          ]
        }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const matchers = (config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)['PostToolUse']
      const commands = matchers.flatMap((m) => m.hooks.map((h) => h.command))
      expect(commands.some((c) => c === 'echo hi')).toBe(true)
      expect(commands.some((c) => c.includes('/app/scripts/claudinha-hook-relay.sh'))).toBe(true)
      expect(commands.some((c) => c.includes('orchard'))).toBe(false)
    })

    it('removes a stale relay hook that shares a matcher with a user hook without dropping the user hook', () => {
      const existing = {
        hooks: {
          PostToolUse: [
            {
              matcher: '*',
              hooks: [
                { type: 'command', command: 'echo hi' },
                { type: 'command', command: '"/Users/scottflorida/Documents/orchard/scripts/claudinha-hook-relay.sh" PostToolUse', timeout: 5 }
              ]
            }
          ]
        }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const matchers = (config.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)['PostToolUse']
      const commands = matchers.flatMap((m) => m.hooks.map((h) => h.command))
      expect(commands.some((c) => c === 'echo hi')).toBe(true)
      expect(commands.some((c) => c.includes('/app/scripts/claudinha-hook-relay.sh'))).toBe(true)
      expect(commands.some((c) => c.includes('orchard'))).toBe(false)
    })
  })

  describe('stale Claudinha statusLine (cross-install rename)', () => {
    it('replaces a stale orchard statusline with the current path', () => {
      const existing = {
        statusLine: {
          type: 'command',
          command: '/Users/scottflorida/Documents/orchard/scripts/claudinha-statusline.sh',
          padding: 0
        }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const sl = config.statusLine as Record<string, unknown>
      expect(sl.command).toBe('/app/scripts/claudinha-statusline.sh')
    })

    it('leaves a user-authored non-Claudinha statusLine untouched', () => {
      const existing = {
        statusLine: {
          type: 'command',
          command: '/usr/local/bin/my-prompt',
          padding: 1
        }
      }
      mockReadFileSync.mockReturnValue(JSON.stringify(existing) as unknown as Buffer)

      pm.writeSettings('/tmp/worktree')

      const config = getWrittenConfig()
      const sl = config.statusLine as Record<string, unknown>
      expect(sl.command).toBe('/usr/local/bin/my-prompt')
      expect(sl.padding).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// healStaleWorktreeSettings — one-shot startup sweep across known worktrees
// ---------------------------------------------------------------------------

describe('healStaleWorktreeSettings', () => {
  let pm: PermissionsManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdirSync.mockReturnValue(undefined as unknown as string)
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    pm = new PermissionsManager()
  })

  it('calls writeSettings once per unique worktree, deduping repeats', () => {
    const spy = vi.spyOn(pm, 'writeSettings')
    healStaleWorktreeSettings(pm, ['/a', '/b', '/a', '/c', '/b'])
    expect(spy).toHaveBeenCalledTimes(3)
    expect(spy).toHaveBeenCalledWith('/a')
    expect(spy).toHaveBeenCalledWith('/b')
    expect(spy).toHaveBeenCalledWith('/c')
  })

  it('skips empty-string worktree paths without throwing', () => {
    const spy = vi.spyOn(pm, 'writeSettings')
    healStaleWorktreeSettings(pm, ['', '/only-real'])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/only-real')
  })

  it('swallows writeSettings errors so one bad worktree does not abort the sweep', () => {
    const spy = vi.spyOn(pm, 'writeSettings').mockImplementation((wt: string) => {
      if (wt === '/bad') throw new Error('boom')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() =>
      healStaleWorktreeSettings(pm, ['/good-1', '/bad', '/good-2'])
    ).not.toThrow()

    expect(spy).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[permissions] startup sweep'),
      '/bad',
      expect.any(Error)
    )
    warn.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// markFolderTrusted — pre-accepts the Claude Code folder-trust prompt
// ---------------------------------------------------------------------------

describe('PermissionsManager.markFolderTrusted', () => {
  let pm: PermissionsManager

  beforeEach(() => {
    vi.clearAllMocks()
    pm = new PermissionsManager()
  })

  function getTrustWrite(): { path: string; config: Record<string, unknown> } {
    expect(mockWriteFileSync).toHaveBeenCalledOnce()
    const [path, raw] = mockWriteFileSync.mock.calls[0] as [string, string]
    return { path, config: JSON.parse(raw) as Record<string, unknown> }
  }

  it('writes ~/.claude.json with hasTrustDialogAccepted=true for the worktree path', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ projects: {} }))

    pm.markFolderTrusted('/tmp/worktree-a')

    const { path, config } = getTrustWrite()
    expect(path).toBe('/home/test/.claude.json')
    const projects = config.projects as Record<string, Record<string, unknown>>
    expect(projects['/tmp/worktree-a']).toBeDefined()
    expect(projects['/tmp/worktree-a'].hasTrustDialogAccepted).toBe(true)
  })

  it('preserves all other top-level config keys verbatim', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      anonymousId: 'abc-123',
      numStartups: 42,
      autoUpdates: true,
      projects: {}
    }))

    pm.markFolderTrusted('/tmp/worktree-b')

    const { config } = getTrustWrite()
    expect(config.anonymousId).toBe('abc-123')
    expect(config.numStartups).toBe(42)
    expect(config.autoUpdates).toBe(true)
  })

  it('preserves existing project entries (other repos) untouched', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      projects: {
        '/some/other/repo': {
          hasTrustDialogAccepted: true,
          hasCompletedProjectOnboarding: true,
          customField: 'keep me'
        }
      }
    }))

    pm.markFolderTrusted('/tmp/worktree-c')

    const { config } = getTrustWrite()
    const projects = config.projects as Record<string, Record<string, unknown>>
    expect(projects['/some/other/repo']).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
      customField: 'keep me'
    })
    expect(projects['/tmp/worktree-c'].hasTrustDialogAccepted).toBe(true)
  })

  it('preserves existing fields on the SAME worktree path while flipping trust on', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      projects: {
        '/tmp/worktree-d': {
          hasCompletedProjectOnboarding: true,
          mcpServers: { foo: { command: 'bar' } }
        }
      }
    }))

    pm.markFolderTrusted('/tmp/worktree-d')

    const { config } = getTrustWrite()
    const entry = (config.projects as Record<string, Record<string, unknown>>)['/tmp/worktree-d']
    expect(entry.hasCompletedProjectOnboarding).toBe(true)
    expect(entry.mcpServers).toEqual({ foo: { command: 'bar' } })
    expect(entry.hasTrustDialogAccepted).toBe(true)
  })

  it('creates a projects map when the existing config has none', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ anonymousId: 'xyz' }))

    pm.markFolderTrusted('/tmp/worktree-e')

    const { config } = getTrustWrite()
    expect(config.projects).toBeDefined()
    const projects = config.projects as Record<string, Record<string, unknown>>
    expect(projects['/tmp/worktree-e'].hasTrustDialogAccepted).toBe(true)
  })

  it('is a no-op (no write) when ~/.claude.json cannot be read', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    pm.markFolderTrusted('/tmp/worktree-f')

    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('swallows write failures (no throw) so a flaky FS does not break spawn', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ projects: {} }))
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('EROFS: read-only file system')
    })

    expect(() => pm.markFolderTrusted('/tmp/worktree-g')).not.toThrow()
  })
})
