import React from 'react'
import type { ToolUsageSummaryRecord } from '../../shared/ipc-channels'
import { HEADER_ROW2_HEIGHT_PX, TOOL_USAGE_ROW_NAME_MAX } from '../lib/constants'

// ---------------------------------------------------------------------------
// ToolUsageRow
// ---------------------------------------------------------------------------

interface ToolUsageRowProps {
  toolsUsed: ToolUsageSummaryRecord | null
  isFocused?: boolean
}

/**
 * Format and sort tool usage entries for display (PRD F5 Layer 4, Row 2).
 *
 * Exported for unit testing.
 */
export function formatToolUsage(
  toolsUsed: ToolUsageSummaryRecord | null
): string {
  if (!toolsUsed) return ''

  const entries = Object.entries(toolsUsed).filter(([, count]) => count >= 1)
  if (entries.length === 0) return ''

  // Sort descending by count
  entries.sort(([, a], [, b]) => b - a)

  return entries
    .map(([name, count]) => {
      const truncated =
        name.length > TOOL_USAGE_ROW_NAME_MAX
          ? name.slice(0, TOOL_USAGE_ROW_NAME_MAX)
          : name
      return `${truncated} ${count}`
    })
    .join(' · ')
}

/**
 * ToolUsageRow — header row 2 showing tool usage counts (PRD F5 Layer 4).
 *
 * Hidden when no tools have been used. Format: `Read 30 · Edit 15 · Bash 42`
 * sorted by count descending. MCP tool names truncated to 16 chars.
 */
export function ToolUsageRow({ toolsUsed, isFocused = false }: ToolUsageRowProps): React.JSX.Element | null {
  const text = formatToolUsage(toolsUsed)
  if (!text) return null

  return (
    <div
      className={`px-2 flex-shrink-0 overflow-hidden whitespace-nowrap text-ellipsis bg-surface text-xs font-[500] tabular-nums flex items-center ${isFocused ? 'text-fg-secondary' : 'text-fg-muted'}`}
      style={{ height: HEADER_ROW2_HEIGHT_PX }}
    >
      {text}
    </div>
  )
}
