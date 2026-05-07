/**
 * Renderer-process constants.
 */

import type { PaneStatus, EffortLevel } from '../../shared/types'

// ---------------------------------------------------------------------------
// Pane geometry (new design-system values)
// ---------------------------------------------------------------------------

export const PANE_BORDER_WIDTH_PX = 1.5
/** Alias kept for test/callsite compatibility */
export const PANE_BORDER_UNFOCUSED_PX = 1.5

export const PANE_HEADER_ROW1_HEIGHT_PX = 32
export const PANE_HEADER_ROW2_HEIGHT_PX = 24
export const PANE_HEADER_SEPARATOR_HEIGHT_PX = 1
export const PANE_HEADER_ROW1_FONT_SIZE_PX = 13
export const PANE_HEADER_ROW2_FONT_SIZE_PX = 12
export const PANE_OVERLAY_FONT_SIZE_PX = 12
export const PANE_METRICS_FONT_SIZE_PX = 11
export const PANE_NARROW_BREAKPOINT_PX = 320

// ---------------------------------------------------------------------------
// Legacy geometry aliases (kept for callsite compatibility)
// ---------------------------------------------------------------------------

export const HEADER_ROW1_HEIGHT_PX     = PANE_HEADER_ROW1_HEIGHT_PX
export const HEADER_ROW2_HEIGHT_PX     = PANE_HEADER_ROW2_HEIGHT_PX
export const HEADER_SEPARATOR_HEIGHT_PX = PANE_HEADER_SEPARATOR_HEIGHT_PX

// ---------------------------------------------------------------------------
// Background colors (dark theme defaults; CSS vars are authoritative at runtime)
// ---------------------------------------------------------------------------

export const TERMINAL_BG = '#161A17'  // = bg-canvas-dark
export const HEADER_BG   = '#1A1F1C'  // = bg-surface-dark

// ---------------------------------------------------------------------------
// Status colors — dark theme (new values per 07-design-tokens.md)
// Light-theme consumers read from CSS custom properties at runtime.
// ---------------------------------------------------------------------------

export const STATUS_COLORS: Record<PaneStatus, string> = {
  'awaiting-prompt': '#848D82',  // fg-muted
  'planning':        '#47978c',  // teal — paired with plan-ready
  'plan-ready':      '#47978c',  // teal — plan awaiting user approval
  'needs-input':     '#b0b9f9',  // soft lavender
  'working':         '#E9EDE6',  // high-contrast neutral
  'changes-ready':   '#D6A240',  // buttery amber (replaces old 'done')
}

/** Border color for a crashed/terminated PTY */
export const STATUS_TERMINATED_COLOR = '#DB4D3F'  // = status-lost

// ---------------------------------------------------------------------------
// Foreground
// ---------------------------------------------------------------------------

export const NEUTRAL_TEXT_COLOR = '#848D82'  // = fg-muted

// ---------------------------------------------------------------------------
// Git / completion colors (new values per 07-design-tokens.md)
// ---------------------------------------------------------------------------

export const GIT_UNCOMMITTED_COLOR     = '#D6A240'  // status-done hue for "dirty"
export const GIT_AHEAD_COLOR           = '#79C991'  // success-fg

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

/** Border pulse interval in ms (period preserved; interpolation now ease-in-out) */
export const BORDER_PULSE_INTERVAL_MS  = 1000
export const WORKING_PULSE_INTERVAL_MS = 1400

// ---------------------------------------------------------------------------
// Terminal settings
// ---------------------------------------------------------------------------

export const SCROLLBACK_LINES = 5000
export const MIN_PANE_COLS    = 30
export const MIN_PANE_ROWS    = 8

// ---------------------------------------------------------------------------
// Rate limit warning (PE-01)
// ---------------------------------------------------------------------------

export const RATE_LIMIT_WARNING_THRESHOLD = 90
export const RATE_LIMIT_WARNING_COLOR     = '#DB4D3F'  // = danger-fg-dark (was #EF4444)

// ---------------------------------------------------------------------------
// Context gauge warning (Kanban header)
// ---------------------------------------------------------------------------

export const CONTEXT_WARNING_THRESHOLD = 70

// ---------------------------------------------------------------------------
// Effort level icons (PE-03)
// ---------------------------------------------------------------------------

export const EFFORT_ICONS: Record<EffortLevel, string> = { low: '○', medium: '◐', high: '●', xhigh: '◉', max: '⬤' }

// ---------------------------------------------------------------------------
// Completion Action Bar
// ---------------------------------------------------------------------------

export const COMPLETION_BAR_HEIGHT_PX = 32

// ---------------------------------------------------------------------------
// String lengths
// ---------------------------------------------------------------------------

export const STATUS_OVERLAY_TOOL_NAME_MAX = 20
export const TOOL_USAGE_ROW_NAME_MAX      = 16

// ---------------------------------------------------------------------------
// GitHub / Feedback
// ---------------------------------------------------------------------------

export const GITHUB_ISSUES_URL = 'https://github.com/scottdflorida/claudinha/issues/new/choose'
