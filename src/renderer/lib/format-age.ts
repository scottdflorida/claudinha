/**
 * Format a millisecond delta as a compact "last activity" age label.
 *
 * Default style ('single'):
 *   < 1 min  → "just now"
 *   < 1 h    → "Nm"
 *   < 1 d    → "Nh"
 *   ≥ 1 d    → "Nd"
 *
 * Mixed style ('mixed'):
 *   < 1 min  → "<1m"
 *   < 1 h    → "Nm"
 *   < 1 d    → "NhMm"  (drops minutes when 0 → "Nh")
 *   ≥ 1 d    → "NdMh"  (drops hours when 0 → "Nd")
 *
 * Negative deltas (clock skew, timestamp in the future) clamp to the
 * sub-minute label so the rail never renders "-3m" or similar nonsense.
 */
export type FormatAgeStyle = 'single' | 'mixed'

export function formatAge(deltaMs: number, style: FormatAgeStyle = 'single'): string {
  if (!Number.isFinite(deltaMs) || deltaMs < 60_000) {
    return style === 'mixed' ? '<1m' : 'just now'
  }
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    if (style === 'mixed') {
      const remM = minutes - hours * 60
      return remM > 0 ? `${hours}h${remM}m` : `${hours}h`
    }
    return `${hours}h`
  }
  const days = Math.floor(hours / 24)
  if (style === 'mixed') {
    const remH = hours - days * 24
    return remH > 0 ? `${days}d${remH}h` : `${days}d`
  }
  return `${days}d`
}
