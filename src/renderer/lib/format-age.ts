/**
 * Format a millisecond delta as a compact "last activity" age label.
 *
 *   < 1 min  → "just now"
 *   < 1 h    → "Nm"
 *   < 1 d    → "Nh"
 *   ≥ 1 d    → "Nd"
 *
 * Negative deltas (clock skew, timestamp in the future) clamp to "just now"
 * so the rail never renders "-3m" or similar nonsense.
 */
export function formatAge(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs < 60_000) return 'just now'
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
