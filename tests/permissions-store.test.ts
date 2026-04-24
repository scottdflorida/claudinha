/**
 * permissions-store unit tests.
 *
 * Verifies CRUD operations, removal tracking, reset behavior,
 * and project prefix matching for permission overrides.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

const mockStore = new Map<string, unknown>()

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      get(key: string, defaultValue?: unknown): unknown {
        return mockStore.has(key) ? mockStore.get(key) : defaultValue
      }
      set(key: string, value: unknown): void {
        mockStore.set(key, value)
      }
    }
  }
})

import {
  getGlobalOverrides,
  setGlobalOverrides,
  resetGlobalOverrides,
  getProjectOverrides,
  setProjectOverrides,
  resetProjectOverrides,
  getProjectPaths,
  getAllKnownRules,
  resolveEffectivePermissions
} from '../src/main/permissions-store'

import { DEFAULT_PERMISSIONS } from '../src/main/constants'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('permissions-store', () => {
  beforeEach(() => {
    mockStore.clear()
  })

  // -------------------------------------------------------------------------
  // Global overrides
  // -------------------------------------------------------------------------

  describe('global overrides', () => {
    it('returns empty overrides by default', () => {
      const overrides = getGlobalOverrides()
      expect(overrides.allow).toEqual([])
      expect(overrides.deny).toEqual([])
      expect(overrides.removedAllow).toEqual([])
      expect(overrides.removedDeny).toEqual([])
    })

    it('saves and retrieves global overrides', () => {
      const overrides = {
        allow: ['Bash(cargo *)'],
        deny: ['Bash(docker *)'],
        removedAllow: ['Read'],
        removedDeny: []
      }
      setGlobalOverrides(overrides)
      expect(getGlobalOverrides()).toEqual(overrides)
    })

    it('resets global overrides to empty', () => {
      setGlobalOverrides({
        allow: ['Bash(cargo *)'],
        deny: [],
        removedAllow: ['Read'],
        removedDeny: []
      })
      resetGlobalOverrides()
      const overrides = getGlobalOverrides()
      expect(overrides.allow).toEqual([])
      expect(overrides.removedAllow).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Project overrides
  // -------------------------------------------------------------------------

  describe('project overrides', () => {
    it('returns empty overrides for unknown project', () => {
      const overrides = getProjectOverrides('/unknown/path')
      expect(overrides.allow).toEqual([])
      expect(overrides.deny).toEqual([])
    })

    it('saves and retrieves project overrides', () => {
      const overrides = {
        allow: ['Bash(make *)'],
        deny: [],
        removedAllow: [],
        removedDeny: ['Bash(sudo *)']
      }
      setProjectOverrides('/my/project', overrides)
      expect(getProjectOverrides('/my/project')).toEqual(overrides)
    })

    it('resets project overrides (removes entry)', () => {
      setProjectOverrides('/my/project', {
        allow: ['Bash(make *)'],
        deny: [],
        removedAllow: [],
        removedDeny: []
      })
      resetProjectOverrides('/my/project')
      expect(getProjectOverrides('/my/project').allow).toEqual([])
    })

    it('returns project paths', () => {
      setProjectOverrides('/project/a', { allow: [], deny: [], removedAllow: [], removedDeny: [] })
      setProjectOverrides('/project/b', { allow: [], deny: [], removedAllow: [], removedDeny: [] })
      const paths = getProjectPaths()
      expect(paths).toContain('/project/a')
      expect(paths).toContain('/project/b')
    })
  })

  // -------------------------------------------------------------------------
  // resolveEffectivePermissions
  // -------------------------------------------------------------------------

  describe('resolveEffectivePermissions', () => {
    it('returns defaults when no overrides exist', () => {
      const result = resolveEffectivePermissions('/any/path')
      expect(result.allow).toEqual(expect.arrayContaining([...DEFAULT_PERMISSIONS.allow]))
      expect(result.deny).toEqual(expect.arrayContaining([...DEFAULT_PERMISSIONS.deny]))
    })

    it('applies global additions', () => {
      setGlobalOverrides({
        allow: ['Bash(cargo *)'],
        deny: ['Bash(docker *)'],
        removedAllow: [],
        removedDeny: []
      })
      const result = resolveEffectivePermissions('/any/path')
      expect(result.allow).toContain('Bash(cargo *)')
      expect(result.deny).toContain('Bash(docker *)')
    })

    it('applies global removals', () => {
      setGlobalOverrides({
        allow: [],
        deny: [],
        removedAllow: ['Read'],
        removedDeny: ['Bash(sudo *)']
      })
      const result = resolveEffectivePermissions('/any/path')
      expect(result.allow).not.toContain('Read')
      expect(result.deny).not.toContain('Bash(sudo *)')
    })

    it('applies project overrides with longest-prefix match', () => {
      setProjectOverrides('/home/user/projects', {
        allow: ['Bash(short-match *)'],
        deny: [],
        removedAllow: [],
        removedDeny: []
      })
      setProjectOverrides('/home/user/projects/my-app', {
        allow: ['Bash(long-match *)'],
        deny: [],
        removedAllow: [],
        removedDeny: []
      })
      const result = resolveEffectivePermissions('/home/user/projects/my-app/src')
      // Longest prefix match: /home/user/projects/my-app
      expect(result.allow).toContain('Bash(long-match *)')
      expect(result.allow).not.toContain('Bash(short-match *)')
    })

    it('layers global then project overrides', () => {
      // Global adds a rule
      setGlobalOverrides({
        allow: ['Bash(global-tool *)'],
        deny: [],
        removedAllow: [],
        removedDeny: []
      })
      // Project removes a default and adds its own
      setProjectOverrides('/my/project', {
        allow: ['Bash(project-tool *)'],
        deny: [],
        removedAllow: ['Read'],
        removedDeny: []
      })
      const result = resolveEffectivePermissions('/my/project/worktree')
      expect(result.allow).toContain('Bash(global-tool *)')
      expect(result.allow).toContain('Bash(project-tool *)')
      expect(result.allow).not.toContain('Read')
    })

    it('does not apply project overrides to unrelated paths', () => {
      setProjectOverrides('/project/a', {
        allow: ['Bash(a-tool *)'],
        deny: [],
        removedAllow: [],
        removedDeny: []
      })
      const result = resolveEffectivePermissions('/project/b/worktree')
      expect(result.allow).not.toContain('Bash(a-tool *)')
    })
  })

  // -------------------------------------------------------------------------
  // getAllKnownRules — autocomplete library
  // -------------------------------------------------------------------------

  describe('getAllKnownRules', () => {
    it('returns the defaults union when there are no overrides', () => {
      const rules = getAllKnownRules()
      for (const r of DEFAULT_PERMISSIONS.allow) {
        expect(rules).toContain(r)
      }
      for (const r of DEFAULT_PERMISSIONS.deny) {
        expect(rules).toContain(r)
      }
    })

    it('returns a sorted, deduplicated list', () => {
      setGlobalOverrides({
        allow: ['Bash(zzz *)', 'Bash(aaa *)'],
        deny: ['Bash(zzz *)'], // duplicate of allow
        removedAllow: [],
        removedDeny: []
      })
      const rules = getAllKnownRules()
      // Sorted
      const sorted = [...rules].sort()
      expect(rules).toEqual(sorted)
      // Deduplicated — only one occurrence of Bash(zzz *)
      expect(rules.filter((r) => r === 'Bash(zzz *)').length).toBe(1)
    })

    it('includes user entries from the global scope', () => {
      setGlobalOverrides({
        allow: ['Bash(global-only *)'],
        deny: [],
        removedAllow: [],
        removedDeny: []
      })
      expect(getAllKnownRules()).toContain('Bash(global-only *)')
    })

    it('includes user entries from every project scope', () => {
      setProjectOverrides('/project/a', {
        allow: ['Bash(project-a *)'],
        deny: [],
        removedAllow: [],
        removedDeny: []
      })
      setProjectOverrides('/project/b', {
        allow: [],
        deny: ['Bash(project-b *)'],
        removedAllow: [],
        removedDeny: []
      })
      const rules = getAllKnownRules()
      expect(rules).toContain('Bash(project-a *)')
      expect(rules).toContain('Bash(project-b *)')
    })

    it('still surfaces a default even if every scope has it as `removedAllow`', () => {
      // The library is the union of EVERY known string — removals don't strip
      // an entry from the library, only from the active list. Otherwise the
      // user couldn't easily re-add a default they had removed.
      setGlobalOverrides({
        allow: [],
        deny: [],
        removedAllow: ['Read'],
        removedDeny: []
      })
      expect(getAllKnownRules()).toContain('Read')
    })
  })
})
