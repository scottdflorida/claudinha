import type { EffortLevel } from '../shared/types'

/**
 * Translate an EffortLevel to the value accepted by Claude Code's
 * settings.json schema. The schema enum is `low | medium | high | xhigh`;
 * `'max'` is a session-only level reachable only via the `/effort max`
 * slash command in-session. Writing `'max'` to settings.json is silently
 * rejected by Claude Code, so we persist `'xhigh'` as the baseline.
 *
 * Callers that want `'max'` behavior at spawn must additionally inject
 * `/effort max` into the PTY after Claude Code's SessionStart hook fires;
 * see spawn-terminals-helper.ts and the PANE_SPAWN / PANE_RESPAWN handlers.
 */
export function effortLevelForSettings(level: EffortLevel): 'low' | 'medium' | 'high' | 'xhigh' {
  return level === 'max' ? 'xhigh' : level
}
