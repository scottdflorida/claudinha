/**
 * formatTimeAgo — returns a human-readable relative time string.
 * e.g. "just now", "5m ago", "3h ago", "2d ago"
 */
export function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}
