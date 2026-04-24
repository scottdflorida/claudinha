/**
 * Pure validation function extracted from NewWorkspaceModal.tsx for testability.
 */

/**
 * Validates the create-workspace form fields synchronously.
 * Returns null if the payload is valid, or an error message string if not.
 */
export function validateWorkspacePayload(
  workspaceType: string,
  repoPath: string,
  selectedWorktree: { path: string; branch?: string } | null
): string | null {
  if (workspaceType === 'repo') {
    if (!repoPath.trim()) return 'Repository path is required.'
    return null
  }
  if (workspaceType === 'worktree-branch') {
    if (!repoPath.trim()) return 'Repository path is required.'
    if (!selectedWorktree) return 'Select a worktree/branch.'
    return null
  }
  // 'general' type has no required fields
  return null
}
