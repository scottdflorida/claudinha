/**
 * Shared repo-path validation primitives for forms that ask the user to pick
 * a git repository.
 *
 * Used by both LaunchForm (new workspace) and AddTerminalsForm (add terminals
 * to existing workspace) so the two flows can never disagree on what counts as
 * a valid repo path (L-027).
 *
 * Caller owns:
 *   - debouncing (each form does its own setTimeout / clearTimeout dance),
 *   - state storage (the form keeps the result in useState so it can drive UI),
 *   - the "validating" transition before awaiting `validateRepoPath`.
 *
 * This module owns:
 *   - the IPC call shape,
 *   - the four canonical states,
 *   - the status-text mapping.
 */

import { IPC } from '../../shared/ipc-channels'
import type { PathValidateResult } from '../../shared/ipc-channels'
import { ipcInvoke } from '../hooks/useIpc'

export interface RepoValidation {
  /** null = unknown (empty input or in-flight). true / false = resolved. */
  valid: boolean | null
  /** null = unknown. true / false = resolved. Only meaningful when valid === true. */
  isGit: boolean | null
  /** Set while the IPC round-trip is in flight. */
  validating: boolean
}

export const EMPTY_VALIDATION: RepoValidation = {
  valid: null,
  isGit: null,
  validating: false
}

export const VALIDATING: RepoValidation = {
  valid: null,
  isGit: null,
  validating: true
}

/**
 * Run IPC.PATH_VALIDATE for `path` and return a fully-resolved RepoValidation.
 *
 * Returns EMPTY_VALIDATION for blank input (matches LaunchForm's "clear when
 * empty" behavior). Returns { valid: false, isGit: false, validating: false }
 * on any IPC error so the form treats invalid paths uniformly.
 */
export async function validateRepoPath(path: string): Promise<RepoValidation> {
  const trimmed = path.trim()
  if (!trimmed) return EMPTY_VALIDATION
  try {
    const result = (await ipcInvoke(IPC.PATH_VALIDATE, { path: trimmed })) as PathValidateResult
    return { valid: result.valid, isGit: result.isGitRepo ?? false, validating: false }
  } catch {
    return { valid: false, isGit: false, validating: false }
  }
}

/**
 * Map a RepoValidation + the i18n strings bundle into the status line text
 * shown beneath the input. Returns null when there's nothing to display
 * (empty input, no validation has run yet).
 */
export interface RepoStatusStrings {
  statusChecking: string
  statusPathNotFound: string
  statusValidNonGit: string
  statusValidGit: string
}

export function repoStatusText(state: RepoValidation, strings: RepoStatusStrings, hasInput: boolean): string | null {
  if (!hasInput) return null
  if (state.validating) return strings.statusChecking
  if (state.valid === false) return strings.statusPathNotFound
  if (state.valid === true && state.isGit === false) return strings.statusValidNonGit
  if (state.valid === true && state.isGit === true) return strings.statusValidGit
  return null
}
