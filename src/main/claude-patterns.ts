/**
 * claude-patterns.ts — Regex patterns for PTY fallback status detection.
 *
 * These patterns match known Claude Code CLI output to classify pane status
 * when hook-based detection is unavailable. All patterns are heuristic:
 * Claude Code's output format may change across versions, so update this file
 * when regressions are detected (PRD F6: "keep all regex patterns in a single
 * file for easy updates").
 *
 * ANSI escape codes are stripped before matching. Patterns are tested against
 * the last chunk of PTY output received after 500ms of silence.
 */

import type { PaneStatus } from '../shared/types'

// ---------------------------------------------------------------------------
// Pattern categories
// ---------------------------------------------------------------------------

/**
 * `needs-input` patterns: Claude Code is waiting for the user to respond to
 * a permission prompt, a yes/no question, or an interactive selection dialog.
 *
 * Examples:
 *   Allow bash command `rm file.txt`? [y/n]
 *   Do you want to create this file? (Y/n)
 *   1) Yes   2) No   3) Always allow
 */
const NEEDS_INPUT_PATTERNS: RegExp[] = [
  /\[y\/n\]/i,
  /\(Y\/n\)/,
  /\(y\/N\)/,
  /\(yes\/no\)/i,
  /Do you want to\b/i,
  /Would you like to\b/i,
  /\bAllow\b.{0,60}\bDeny\b/s,
  /\bAllow\b.{0,60}\[y\/n\]/is,
  // Claude Code permission dialog: numbered options
  /1\)\s+(?:Yes|Allow|Always allow)/i
]

/**
 * `done` patterns: Claude Code has completed its current task and is showing
 * a summary before returning to the input prompt.
 *
 * Examples:
 *   ✓ Task complete
 *   Total cost: $0.02
 *   Tokens used: 1,234
 */
const DONE_PATTERNS: RegExp[] = [
  // Cost/token summary emitted by Claude Code at session end
  /\bTotal cost:/i,
  /\bTotal tokens:/i,
  /\bAPI cost:/i,
  /\bTokens used:/i,
  // Claude Code "task complete" / "done" indicators
  /✓\s+Task complete/i,
  /\bTask completed\b/i,
  /\bFinished\b.*\btask\b/i
]

/**
 * `awaiting-prompt` patterns: Claude Code is showing its REPL prompt,
 * waiting for the next user command (but not in the middle of a task).
 *
 * Examples:
 *   > (bare input prompt)
 *   ❯ (unicode prompt arrow)
 */
const AWAITING_PROMPT_PATTERNS: RegExp[] = [
  // Bare > prompt at end of line
  /(?:^|\n)>\s*$/,
  // Unicode right-pointing arrow prompt (Claude Code uses this in newer versions)
  /❯\s*$/
]

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const CLAUDE_PATTERNS = {
  needsInput: NEEDS_INPUT_PATTERNS,
  done: DONE_PATTERNS,
  awaitingPrompt: AWAITING_PROMPT_PATTERNS
} as const

// ---------------------------------------------------------------------------
// Stop-time classifier — drives Done vs Needs Input routing on Stop hooks.
// ---------------------------------------------------------------------------
//
// When Claude Code emits a `Stop` hook the agent's turn has ended. The hook
// alone can't tell us whether Claude finished a task or asked the user a
// plain-text question (the Notification hook only fires for permission
// prompts and AskUserQuestion). Without a refinement Claude's questions
// land in the Done column and stop scrolling for input. The classifier
// scans the tail of the most recent PTY buffer for question patterns and
// flips the status to needs-input when one matches.
//
// Two pattern lists are exposed so the default can be flipped later:
//   - questionPatterns: a match means "Claude is asking the user something".
//   - completionPatterns: a match means "Claude is announcing completion".
// Question patterns are checked first (so "Done. Did that work?" still
// routes to needs-input). When neither matches, defaultStatus wins.
// To flip the default later, populate completionPatterns with explicit
// completion phrases and change defaultStatus to 'needs-input'.

const STOP_QUESTION_PATTERNS: RegExp[] = [
  // A `?` near the end of the buffer. The {0,200} bound after the `?`
  // catches a clarifier sentence + the "Worked for…" footer + the prompt
  // prefix without false-matching `?` buried earlier (e.g. in code blocks).
  /\?[^?]{0,200}$/s,
  // Common interrogative phrasings, useful when the question is buried
  // before a longer post-question commentary.
  /\bWant me to\b[^.?!\n]{0,200}\?/i,
  /\bShould (I|we)\b[^.?!\n]{0,200}\?/i,
  /\bDo you want\b[^.?!\n]{0,200}\?/i,
  /\bWould you like\b[^.?!\n]{0,200}\?/i
]

const STOP_COMPLETION_PATTERNS: RegExp[] = []

export const STOP_CLASSIFIER = {
  questionPatterns: STOP_QUESTION_PATTERNS,
  completionPatterns: STOP_COMPLETION_PATTERNS,
  defaultStatus: 'done' as PaneStatus
} as const

const STOP_TAIL_SCAN_CHARS = 2000

export function classifyStopOutput(
  lastOutput: string | null | undefined
): PaneStatus {
  if (!lastOutput) return STOP_CLASSIFIER.defaultStatus
  const tail =
    lastOutput.length > STOP_TAIL_SCAN_CHARS
      ? lastOutput.slice(-STOP_TAIL_SCAN_CHARS)
      : lastOutput
  for (const pattern of STOP_CLASSIFIER.questionPatterns) {
    if (pattern.test(tail)) return 'needs-input'
  }
  for (const pattern of STOP_CLASSIFIER.completionPatterns) {
    if (pattern.test(tail)) return 'done'
  }
  return STOP_CLASSIFIER.defaultStatus
}
