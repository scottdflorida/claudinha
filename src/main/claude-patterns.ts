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
  // A `?` somewhere in the recent (normalized) tail. The {0,1500} bound is
  // wide because Claude Code's ink TUI keeps repainting after the agent's
  // response — spinner ("Marinating…"), token counter, divider line, and
  // input box can pile on hundreds of chars of noise after the question
  // mark even after `\r` collapse. We'd rather false-positive on a `?`
  // buried in code than false-negative on a real ending question.
  /\?[^?]{0,1500}$/s,
  // Named interrogative phrasings, kept as a safety net for cases where
  // the response somehow ends in punctuation other than `?`.
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

/**
 * Normalize a raw PTY tail for question/completion classification.
 *
 * Claude Code is an ink/yoga TUI: after the agent's response it keeps
 * redrawing the input box, spinner, token counter, and a `─…─` divider line
 * via `\r`-overwrites and ANSI cursor positioning. ANSI escapes are already
 * stripped by `StatusDetector.recentStripped`, but the raw `\r` carriage
 * returns and runs of repeated divider/whitespace remain — they push real
 * signal characters far from the buffer end and inflate the noise budget
 * the regexes have to absorb. This pass:
 *   - drops `\r` (terminal "go to start of line"; meaningless without
 *     coordinated cursor state)
 *   - collapses runs of 4+ identical chars to 3 (kills the divider line)
 *   - collapses runs of horizontal whitespace and consecutive blank lines
 * The result is a much more compact, more searchable view of the same text.
 */
function normalizeForClassification(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/(.)\1{3,}/g, '$1$1$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
}

export function classifyStopOutput(
  lastOutput: string | null | undefined
): PaneStatus {
  if (!lastOutput) return STOP_CLASSIFIER.defaultStatus
  const tail =
    lastOutput.length > STOP_TAIL_SCAN_CHARS
      ? lastOutput.slice(-STOP_TAIL_SCAN_CHARS)
      : lastOutput
  const cleaned = normalizeForClassification(tail)
  for (const pattern of STOP_CLASSIFIER.questionPatterns) {
    if (pattern.test(cleaned)) return 'needs-input'
  }
  for (const pattern of STOP_CLASSIFIER.completionPatterns) {
    if (pattern.test(cleaned)) return 'done'
  }
  return STOP_CLASSIFIER.defaultStatus
}
