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

/**
 * `workingHint` patterns: positive evidence that Claude is *actively* thinking
 * — used to gate the awaiting-prompt → working PTY bridge in StatusDetector.
 * The hook map already covers user-submits via `UserPromptSubmit: 'working'`
 * and tool-call transitions via `PreToolUse: 'working'`; this list exists so
 * the bridge fires only as defense-in-depth when a thinking word appears in
 * the terminal stream.
 *
 * Text-only on purpose. An earlier revision included a bare glyph class
 * `[⏺✻●◉]` to cover tool-call headers, but those characters appear in
 * Claude Code's banner / status footer / mode-toggle decorations too, so
 * the gate fired on cosmetic chunks for ~5 panes per 20-pane spawn and
 * promoted them to `working` until the SessionStart hook reset them.
 * Tool-call headers in hook mode are already covered by `PreToolUse` — the
 * bridge does not need to chase them. If a future scenario needs glyph
 * matching, anchor it (e.g. `/^⏺\s+[A-Z]\w*\(/m` for an actual tool-call
 * header line) rather than reinstating a bare class.
 */
const WORKING_HINT_PATTERNS: RegExp[] = [
  /Considering/i,
  /Thinking/i,
  /Marinating/i,
  /Pondering/i,
  /thought\s+for\b/i,
]

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const CLAUDE_PATTERNS = {
  needsInput: NEEDS_INPUT_PATTERNS,
  done: DONE_PATTERNS,
  awaitingPrompt: AWAITING_PROMPT_PATTERNS,
  workingHint: WORKING_HINT_PATTERNS
} as const

// Stop-routing is now handled directly by HookListener.routeStopStatus —
// it consults plan mode and a synchronous diff probe rather than scanning
// the PTY tail for question patterns. The previous regex classifier lived
// here.
