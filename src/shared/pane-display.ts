/**
 * Shared helpers for deriving display text from pane state. These must match
 * across the main process (inspector-built workspace summary) and renderer
 * (Kanban card / rail row) so a pane's name is identical wherever it's shown.
 */

/**
 * Minimal shape needed to resolve a pane's display name. Both the main-side
 * `PaneState` and the renderer's `RendererPane` satisfy it.
 */
export interface DisplayNamePane {
  worktreeName: string
  userName?: string | null
  metrics: {
    sessionTitle: string | null
    /**
     * `agent-name` JSONL entry. Optional so existing call sites that only
     * carry `sessionTitle` (dormant snapshots, history records) keep
     * compiling — they simply skip this rung of the chain.
     */
    agentName?: string | null
  }
}

/**
 * Resolve the pane's display name using the canonical fallback chain:
 *   `userName` (claudinha inline rename)
 *   → `metrics.agentName` (Claude Code `agent-name` JSONL entry)
 *   → `metrics.sessionTitle` (Claude Code `ai-title` JSONL entry)
 *   → `worktreeName` (final fallback; the `wt-xxxxxx` branch id).
 *
 * Keep this as the single source of truth — all UI surfaces that render a
 * pane's name must call through here so rename propagation stays consistent.
 */
export function resolvePaneDisplayName(pane: DisplayNamePane): string {
  const userName = pane.userName?.trim()
  if (userName && userName.length > 0) return userName
  const agentName = pane.metrics.agentName?.trim()
  if (agentName && agentName.length > 0) return agentName
  const title = pane.metrics.sessionTitle?.trim()
  if (title && title.length > 0) return title
  return pane.worktreeName
}
