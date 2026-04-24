import Store from 'electron-store'
import type { CompletionPolicy } from '../shared/types'
import { DEFAULT_COMPLETION_POLICY } from '../shared/types'

// ---------------------------------------------------------------------------
// Completion policy persistence
//
// Stores the app-wide default CompletionPolicy (action, mergeStrategy,
// pruneOnMerge). Workspace-scoped overrides live on the Workspace itself and are
// persisted via workspace-store — they do NOT go here.
//
// Module-level singleton, same pattern as permissions-store.ts.
// ---------------------------------------------------------------------------

interface CompletionPolicySchema {
  'completion-policy.global': CompletionPolicy
}

const store = new Store<CompletionPolicySchema>({
  name: 'completion-policy'
})

/**
 * Return the persisted global completion policy, falling back to
 * DEFAULT_COMPLETION_POLICY if the user has never customized it.
 */
export function getGlobalCompletionPolicy(): CompletionPolicy {
  return store.get('completion-policy.global', { ...DEFAULT_COMPLETION_POLICY })
}

/**
 * Persist a new global completion policy. Callers are responsible for
 * broadcasting the change to any open windows.
 */
export function setGlobalCompletionPolicy(policy: CompletionPolicy): void {
  store.set('completion-policy.global', policy)
}

/**
 * Reset the global policy back to DEFAULT_COMPLETION_POLICY.
 */
export function resetGlobalCompletionPolicy(): void {
  store.set('completion-policy.global', { ...DEFAULT_COMPLETION_POLICY })
}
