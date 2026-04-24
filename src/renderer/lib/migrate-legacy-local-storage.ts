/**
 * One-shot migration for localStorage keys renamed from `claudio:*` to
 * `claudinha:*`. Runs once on App mount. Idempotent: if the new key already
 * has a value, the legacy value is left in place untouched. The old keys are
 * preserved (not deleted) so a rollback to a pre-rename build still sees
 * them.
 */
const KEY_MIGRATIONS: Array<{ from: string; to: string }> = [
  { from: 'claudio:lastRepoPath', to: 'claudinha:lastRepoPath' },
  { from: 'claudio:lastModel', to: 'claudinha:lastModel' }
]

export function migrateLegacyLocalStorage(): void {
  try {
    for (const { from, to } of KEY_MIGRATIONS) {
      if (localStorage.getItem(to) === null) {
        const legacy = localStorage.getItem(from)
        if (legacy !== null) {
          localStorage.setItem(to, legacy)
        }
      }
    }
  } catch {
    // localStorage can throw in private-browsing / storage-disabled contexts.
    // Silently skip — the app falls back to default values.
  }
}
