import Store from 'electron-store'
import { DEFAULT_PERMISSIONS } from './constants'
import type { PermissionOverrides } from '../shared/types'

// ---------------------------------------------------------------------------
// Permission overrides persistence
//
// Module-level singleton following the session-history-store.ts pattern.
// Stores user-customized permission overrides at global and project scopes.
// ---------------------------------------------------------------------------

const EMPTY_OVERRIDES: PermissionOverrides = {
  allow: [],
  deny: [],
  removedAllow: [],
  removedDeny: []
}

interface PermissionsSchema {
  'permissions.global': PermissionOverrides
  'permissions.projects': Record<string, PermissionOverrides>
}

const store = new Store<PermissionsSchema>({
  name: 'permissions-overrides'
})

// ---------------------------------------------------------------------------
// Global overrides
// ---------------------------------------------------------------------------

export function getGlobalOverrides(): PermissionOverrides {
  return store.get('permissions.global', { ...EMPTY_OVERRIDES })
}

export function setGlobalOverrides(overrides: PermissionOverrides): void {
  store.set('permissions.global', overrides)
}

export function resetGlobalOverrides(): void {
  store.set('permissions.global', { ...EMPTY_OVERRIDES })
}

// ---------------------------------------------------------------------------
// Project overrides
// ---------------------------------------------------------------------------

export function getProjectOverrides(projectPath: string): PermissionOverrides {
  const projects = store.get('permissions.projects', {})
  return projects[projectPath] ?? { ...EMPTY_OVERRIDES }
}

export function setProjectOverrides(projectPath: string, overrides: PermissionOverrides): void {
  const projects = store.get('permissions.projects', {})
  projects[projectPath] = overrides
  store.set('permissions.projects', projects)
}

export function resetProjectOverrides(projectPath: string): void {
  const projects = store.get('permissions.projects', {})
  delete projects[projectPath]
  store.set('permissions.projects', projects)
}

export function getProjectPaths(): string[] {
  const projects = store.get('permissions.projects', {})
  return Object.keys(projects)
}

// ---------------------------------------------------------------------------
// Known rules library — union of defaults + every user-added entry across
// all scopes (global + every stored project). Powers the autocomplete library
// in the Permissions Manager view.
// ---------------------------------------------------------------------------

export function getAllKnownRules(): string[] {
  const set = new Set<string>([
    ...DEFAULT_PERMISSIONS.allow,
    ...DEFAULT_PERMISSIONS.deny,
  ])
  const global = getGlobalOverrides()
  for (const r of global.allow) set.add(r)
  for (const r of global.deny) set.add(r)
  for (const path of getProjectPaths()) {
    const p = getProjectOverrides(path)
    for (const r of p.allow) set.add(r)
    for (const r of p.deny) set.add(r)
  }
  return [...set].sort()
}

// ---------------------------------------------------------------------------
// Resolution — computes effective permissions for a worktree path
// ---------------------------------------------------------------------------

/**
 * Resolve effective permissions by layering:
 * 1. Start with DEFAULT_PERMISSIONS
 * 2. Apply global overrides (removals and additions)
 * 3. Find longest-prefix project match for worktreePath
 * 4. Apply project overrides (removals and additions)
 */
export function resolveEffectivePermissions(worktreePath: string): { allow: string[]; deny: string[] } {
  // Start with defaults
  let allow: string[] = [...DEFAULT_PERMISSIONS.allow]
  let deny: string[] = [...DEFAULT_PERMISSIONS.deny]

  // Apply global overrides
  const global = getGlobalOverrides()
  allow = allow.filter((a) => !global.removedAllow.includes(a))
  deny = deny.filter((d) => !global.removedDeny.includes(d))
  allow = [...new Set([...allow, ...global.allow])]
  deny = [...new Set([...deny, ...global.deny])]

  // Find longest-prefix project match
  const projects = store.get('permissions.projects', {})
  let bestMatch = ''
  for (const projectPath of Object.keys(projects)) {
    if (worktreePath.startsWith(projectPath) && projectPath.length > bestMatch.length) {
      bestMatch = projectPath
    }
  }

  if (bestMatch) {
    const project = projects[bestMatch]
    allow = allow.filter((a) => !project.removedAllow.includes(a))
    deny = deny.filter((d) => !project.removedDeny.includes(d))
    allow = [...new Set([...allow, ...project.allow])]
    deny = [...new Set([...deny, ...project.deny])]
  }

  return { allow, deny }
}
