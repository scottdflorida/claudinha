/**
 * Pure validation functions extracted from SpawnDialog.tsx for testability.
 */

import {
  MIN_PANE_COLS,
  MIN_PANE_ROWS,
  HEADER_ROW1_HEIGHT_PX,
  HEADER_ROW2_HEIGHT_PX,
  HEADER_SEPARATOR_HEIGHT_PX
} from './constants'

/**
 * Returns true if adding one more pane would make any pane smaller than the
 * minimum allowed size (MIN_PANE_COLS x MIN_PANE_ROWS) given current window
 * dimensions.
 */
export function wouldExceedMinPaneSize(
  currentPaneCount: number,
  windowWidth: number,
  windowHeight: number
): boolean {
  const n = currentPaneCount + 1
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const panePixelWidth = windowWidth / cols
  const headerH = HEADER_ROW1_HEIGHT_PX + HEADER_ROW2_HEIGHT_PX + HEADER_SEPARATOR_HEIGHT_PX
  const panePixelHeight = windowHeight / rows
  const minPixelWidth = MIN_PANE_COLS * 8
  const minPixelHeight = MIN_PANE_ROWS * 17 + headerH
  return panePixelWidth < minPixelWidth || panePixelHeight < minPixelHeight
}

/**
 * Validates the spawn dialog form fields synchronously.
 * Returns null if the payload is valid, or an error message string if not.
 *
 * Note: manual-path mode has an additional async path-validation step that
 * cannot be captured here — this only checks for empty fields.
 */
export function validateSpawnPayload(
  mode: string,
  repoPath: string,
  manualPath: string,
  selectedWorktree: string | null
): string | null {
  if (mode === 'new-worktree') {
    if (!repoPath.trim()) return 'Repository path is required.'
    return null
  }
  if (mode === 'existing-worktree') {
    if (!repoPath.trim()) return 'Repository path is required.'
    if (!selectedWorktree) return 'Select a worktree.'
    return null
  }
  if (mode === 'manual-path') {
    if (!manualPath.trim()) return 'Directory path is required.'
    return null
  }
  return null
}
