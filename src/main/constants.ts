/**
 * Main-process constants.
 *
 * Includes permission preset and operational timeouts. Centralized here so
 * they can be made configurable in a future Pro settings panel (PRD FE1).
 */

import os from 'os'

// ---------------------------------------------------------------------------
// Default .claude/settings.json permission preset (PRD F8)
//
// Written by PermissionsManager at pane spawn time.
// No defaultMode is set — Claude Code uses its own default behavior.
// The allow list pre-approves common safe bash commands.
// The deny list blocks destructive and network operations.
// ---------------------------------------------------------------------------

export const DEFAULT_PERMISSIONS = {
  allow: [
    // Claude Code built-in tools
    'Read',
    'Edit',
    'MultiEdit',
    'Write',
    'Glob',
    'Grep',

    // Version control & package managers
    'Bash(git *)',
    'Bash(npm run *)',
    'Bash(npx *)',
    'Bash(node *)',

    // File operations
    'Bash(cat *)',
    'Bash(ls *)',
    'Bash(find *)',
    'Bash(mkdir *)',
    'Bash(cp *)',
    'Bash(mv *)',
    'Bash(touch *)',
    'Bash(chmod *)',

    // File search — fd is a modern find alternative (v2.1.72)
    'Bash(fd *)',
    'Bash(fdfind *)',

    // Common read/inspection utilities
    'Bash(head *)',
    'Bash(tail *)',
    'Bash(wc *)',
    'Bash(sort *)',
    'Bash(uniq *)',
    'Bash(grep *)',
    'Bash(diff *)',
    'Bash(file *)',
    'Bash(stat *)',

    // Text processing (v2.1.71)
    'Bash(fmt *)',
    'Bash(comm *)',
    'Bash(cmp *)',
    'Bash(numfmt *)',
    'Bash(expr *)',
    'Bash(test *)',
    'Bash(printf *)',
    'Bash(seq *)',
    'Bash(tsort *)',
    'Bash(pr *)',
    'Bash(tr *)',
    'Bash(cut *)',
    'Bash(tee *)',

    // Path utilities
    'Bash(basename *)',
    'Bash(dirname *)',
    'Bash(readlink *)',
    'Bash(realpath *)',
    'Bash(pwd)',

    // Shell built-ins & lookup
    'Bash(echo *)',
    'Bash(which *)',
    'Bash(xargs *)',
    'Bash(date *)',

    // Diagnostic / process inspection (v2.1.72)
    'Bash(lsof *)',
    'Bash(pgrep *)',
    'Bash(tput *)',
    'Bash(ss *)',

    // System info (v2.1.71)
    'Bash(getconf *)'
  ],
  deny: [
    'Bash(rm -rf /)',
    'Bash(sudo *)',
    'Bash(curl *)',
    'Bash(wget *)'
  ]
} as const

// ---------------------------------------------------------------------------
// PTY lifecycle timeouts
// ---------------------------------------------------------------------------

/**
 * Time to wait for a PTY to exit gracefully after SIGHUP before force-killing.
 * PRD F2: "wait briefly for graceful exit, then force-kill if necessary"
 */
export const PTY_GRACEFUL_KILL_TIMEOUT_MS = 2_000

/**
 * Debounce delay for PTY fallback status detection.
 * After this many ms of PTY silence, the StatusDetector classifies the state.
 * PRD F6: "500ms of silence"
 */
export const PTY_SILENCE_DEBOUNCE_MS = 500

/**
 * If no hook events are received for a pane within this time after spawn,
 * the PTY fallback status detection is activated. PRD F6.
 */
export const HOOK_FALLBACK_ACTIVATION_MS = 30_000

// ---------------------------------------------------------------------------
// Model display name abbreviation mapping (PRD F7)
//
// Used by MetricsCollector to produce the short model name shown in MetricsOverlay.
// ---------------------------------------------------------------------------

/**
 * Map of Claude Code model IDs → short display abbreviations.
 * For unknown model IDs, use the first 6 characters of the ID.
 * PRD F7: "claude-sonnet-4-6 → s4.6, claude-opus-4-6 → o4.6, claude-haiku-4-5 → h4.5"
 */
export const MODEL_ABBREVIATIONS: Record<string, string> = {
  'claude-sonnet-4-6': 's4.6',
  'claude-opus-4-6': 'o4.6',
  'claude-haiku-4-5': 'h4.5',
  'claude-haiku-4-5-20251001': 'h4.5'
}

/**
 * Abbreviate a model ID for display.
 * 1. Exact match in MODEL_ABBREVIATIONS.
 * 2. Prefix match (handles date-stamped or suffixed variants like "claude-opus-4-6[1m]").
 * 3. Fallback: strip "claude-" prefix and return the remainder (up to 10 chars).
 */
export function abbreviateModel(modelId: string): string {
  // Exact match
  if (MODEL_ABBREVIATIONS[modelId]) return MODEL_ABBREVIATIONS[modelId]

  // Prefix match — find the longest known key that the model ID starts with
  let bestMatch = ''
  for (const key of Object.keys(MODEL_ABBREVIATIONS)) {
    if (modelId.startsWith(key) && key.length > bestMatch.length) {
      bestMatch = key
    }
  }
  if (bestMatch) return MODEL_ABBREVIATIONS[bestMatch]

  // Fallback: strip "claude-" prefix for a more meaningful short name
  const stripped = modelId.startsWith('claude-') ? modelId.slice(7) : modelId
  return stripped.slice(0, 10)
}

// ---------------------------------------------------------------------------
// Model context window mapping (PRD F7, B-038)
//
// Used by MetricsCollector for the manual context % fallback calculation
// when statusline pre-calculated value is unavailable.
// ---------------------------------------------------------------------------

/**
 * Map of model ID → max context window in tokens.
 * All current Claude models have a 200K context window.
 * Default fallback for unknown models: 200K.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-opus-4-6[1m]': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000
}

/** Default context window size for unknown model IDs (200K tokens) */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/**
 * Claude Code's approximate auto-compact buffer.
 * Subtracted from the effective max context when calculating context %.
 * PRD F7: "~40-45K auto-compact buffer"
 */
export const AUTO_COMPACT_BUFFER_TOKENS = 40_000

/**
 * Resolve the effective max context for a given model ID.
 * 1. Exact match in MODEL_CONTEXT_WINDOWS.
 * 2. Prefix match (handles date-stamped or suffixed variants).
 * 3. Fallback: DEFAULT_CONTEXT_WINDOW.
 */
export function getModelContextWindow(modelId: string): number {
  // Exact match
  if (MODEL_CONTEXT_WINDOWS[modelId] !== undefined) return MODEL_CONTEXT_WINDOWS[modelId]

  // Prefix match — find the longest known key that the model ID starts with
  let bestMatch = ''
  for (const key of Object.keys(MODEL_CONTEXT_WINDOWS)) {
    if (modelId.startsWith(key) && key.length > bestMatch.length) {
      bestMatch = key
    }
  }
  if (bestMatch) return MODEL_CONTEXT_WINDOWS[bestMatch]

  return DEFAULT_CONTEXT_WINDOW
}

// ---------------------------------------------------------------------------
// Cross-platform temp directory for statusline files
// ---------------------------------------------------------------------------

/**
 * Return the temp directory used for statusline JSON files.
 *
 * On macOS/Linux, the shell script `claudinha-statusline.sh` writes to `/tmp`,
 * so the Node.js readers must also use `/tmp` to match.
 *
 * On Windows, `/tmp` does not exist. The Windows statusline script
 * (`claudinha-statusline.js`) uses `os.tmpdir()`, so the readers must match.
 */
export function getStatuslineTempDir(): string {
  return process.platform === 'win32' ? os.tmpdir() : '/tmp'
}
