/**
 * Remove ANSI color/cursor/title escape sequences so regex patterns match
 * cleanly. Used by the main-process status detector AND the renderer-side
 * spawn-overlay detector — both need to look at "what the user sees" rather
 * than the raw byte stream, where a marker like "Claude Code" can hide
 * inside an OSC title-set sequence (`ESC ] 0 ; Claude Code BEL`) long
 * before the visible banner draws.
 *
 * NOTE on the simple-ESC pattern: an earlier version used `[A-Za-z]` and
 * happily stripped ESC + lowercase-letter pairs that aren't valid escapes.
 * That ate the `t` of `to` in Claude Code's plan-mode footer (`shift+tab to
 * cycle` → `shift+tab o cycle`), among other surprising things. ECMA-48
 * 2-byte escapes only use C1-set finals (`@`-`_` ASCII range) plus a small
 * set of DEC-private 2-byte forms (`7`, `8`, `=`, `>`). Lowercase ASCII
 * letters never terminate a real escape. Restricting the match here fixes
 * the false-strip without re-introducing it for any actual escape.
 */
export function stripAnsi(raw: string): string {
  // CSI sequences: ESC [ ... final-byte
  return raw
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    // OSC sequences: ESC ] ... BEL/ST
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    // Character-set selection (3 bytes): ESC ( B / ESC ) 0 / etc.
    .replace(/\x1b[()*+\-./][\x20-\x7e]/g, '')
    // Simple 2-byte escapes — C1-set finals (`@`-`_`) plus DEC private
    // 7/8/=/> only. Crucially does NOT match lowercase letters, so it can't
    // chew the first letter of legitimate text bytes following a stray ESC.
    .replace(/\x1b[@-Z\\\]^_=>78]/g, '')
}
