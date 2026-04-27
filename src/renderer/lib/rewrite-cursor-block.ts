// Recolor ink-text-input's cursor block to Claudinha gold.
//
// ink-text-input renders the input cursor as a literal inverse-video space:
// `\x1b[7m \x1b[27m` (set-inverse, space, unset-inverse). xterm draws an
// inverse cell by swapping fg/bg, so against our default theme it shows as
// `theme.foreground` (warm off-white) painted on one character cell — what
// the user perceives as "the cursor is white."
//
// We can't change theme.foreground without tinting every default-fg
// character Claude prints, so instead we surgically rewrite the exact 10-byte
// cursor pattern in incoming PTY data to a gold full-block character with an
// explicit RGB foreground. Claude's response body, prompt prefix, and the
// typed input itself are untouched — only the cursor cell turns gold.
//
// Chunk-split caveat: in principle the 10-byte pattern could span two
// PANE_DATA events. Realistic chunks are 1 KB+ and ink redraws the cursor on
// every keystroke, so a single missed render self-corrects within one
// keystroke. v1 accepts that; if it ever shows up as a flicker we'll add a
// 9-byte tail buffer per pane.

const CURSOR_PATTERN = /\x1b\[7m \x1b\[27m/g

const DARK_GOLD_BLOCK  = '\x1b[38;2;232;184;75m█\x1b[39m'  // #E8B84B
const LIGHT_GOLD_BLOCK = '\x1b[38;2;184;135;46m█\x1b[39m'  // #B8872E

export function rewriteCursorBlock(data: string, themeMode: 'dark' | 'light'): string {
  if (!data.includes('\x1b[7m \x1b[27m')) return data
  const replacement = themeMode === 'light' ? LIGHT_GOLD_BLOCK : DARK_GOLD_BLOCK
  return data.replace(CURSOR_PATTERN, replacement)
}
