import React from 'react'
import type { PaneMetricsIpc } from '../../shared/ipc-channels'

// ---------------------------------------------------------------------------
// Formatting helpers — exported for unit testing
// ---------------------------------------------------------------------------

/** Format token count: "—" | "123 tk" | "1.2k tk" | "24.1k tk" */
export function formatTokens(n: number | null): string {
  if (n === null) return '—'
  if (n < 1000) return `${n}`
  return `${(n / 1000).toFixed(1)}k`
}

/** Format context percent: "—" | "38%" */
export function formatContextPercent(n: number | null): string {
  if (n === null) return '—'
  return `${Math.round(n)}%`
}

/** Format duration in ms: "—" | "45s" | "4m12s" | "2h30m" */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  if (totalSec < 3600) {
    const minutes = Math.floor(totalSec / 60)
    const seconds = totalSec % 60
    return `${minutes}m${seconds}s`
  }
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  return `${hours}h${minutes}m`
}

/** Format lines added/removed: "—" | "+120/-30" */
export function formatLines(
  added: number | null,
  removed: number | null
): string {
  if (added === null && removed === null) return '—'
  const a = added ?? 0
  const r = removed ?? 0
  return `+${a}/-${r}`
}

/** Format cost in USD: "—" | "$0.08" */
export function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  return `$${usd.toFixed(2)}`
}

/**
 * Build the metrics display string with progressive truncation (PRD F5 Layer 3, B-040).
 *
 * Display order (left to right):
 *   "{tokens} tk · {ctx}% ctx · {duration} · {lines} [· {cost}]"
 *
 * Drop order when space is constrained (right-to-left):
 *   cost → lines → duration
 * Tokens and context % are always shown. Model is no longer included — it's
 * shown in the pane header instead.
 *
 * @param containerWidth  Available pixel width. Undefined = no truncation.
 *
 * Exported for unit testing.
 */
export function buildMetricsLabel(
  metrics: PaneMetricsIpc,
  isApiBilling: boolean,
  containerWidth: number | undefined
): string {
  const tokens = `${formatTokens(metrics.totalTokens)} tk`
  const ctx = `${formatContextPercent(metrics.contextPercent)} ctx`
  const duration = formatDuration(metrics.durationMs)
  const lines = formatLines(metrics.linesAdded, metrics.linesRemoved)
  const cost = isApiBilling ? formatCost(metrics.totalCostUsd) : null

  // Ordered list of segments: first two are always kept, rest dropped right-to-left
  const segments: string[] = [tokens, ctx, duration, lines]
  if (cost !== null) segments.push(cost)

  if (!containerWidth) {
    return segments.join(' · ')
  }

  // Approximate character budget: 8px per monospace char at 13px Menlo, minus overlay padding
  const CHAR_WIDTH_PX = 8
  const OVERLAY_PADDING_PX = 12 // px-1.5 = 6px each side
  const availableChars = Math.floor((containerWidth - OVERLAY_PADDING_PX) / CHAR_WIDTH_PX)

  // Drop from right until label fits, but never drop the first two segments (tokens + ctx)
  let candidates = [...segments]
  while (candidates.length > 2 && candidates.join(' · ').length > availableChars) {
    candidates.pop()
  }

  return candidates.join(' · ')
}

/**
 * Build the full metrics label with no truncation (for backward compatibility).
 * Exported for unit testing.
 */
export function formatMetricsLabel(
  metrics: PaneMetricsIpc,
  isApiBilling: boolean
): string {
  return buildMetricsLabel(metrics, isApiBilling, undefined)
}

// ---------------------------------------------------------------------------
// MetricsOverlay
// ---------------------------------------------------------------------------

interface MetricsOverlayProps {
  metrics: PaneMetricsIpc
  isApiBilling: boolean
  /** Available container width in px, for progressive field truncation (B-040) */
  containerWidth?: number
  /** When true, show only context % (narrow pane adaptation, B-061) */
  isNarrow?: boolean
  /** Offset from bottom in px (shifts overlay up when completion bar is visible) */
  bottomOffset?: number
}

/**
 * MetricsOverlay — metrics pill centered on the bottom border (PRD F5 Layer 3).
 *
 * Neutral gray text. Absolutely positioned within the pane's outer container.
 * Hidden when all metrics are null (no session data yet).
 *
 * Truncates fields right-to-left when containerWidth is too narrow (B-040).
 * Drop order: cost → lines → duration → model (tokens + ctx always shown).
 */
export function MetricsOverlay({
  metrics,
  isApiBilling,
  containerWidth,
  isNarrow = false,
  bottomOffset = 0
}: MetricsOverlayProps): React.JSX.Element | null {
  // Hide if no meaningful data yet
  const hasData =
    metrics.totalTokens !== null ||
    metrics.durationMs !== null ||
    metrics.modelDisplayName !== null

  if (!hasData) return null

  // Narrow pane: show only context % (B-061)
  const label = isNarrow
    ? `${formatContextPercent(metrics.contextPercent)} ctx`
    : buildMetricsLabel(metrics, isApiBilling, containerWidth)

  return (
    <div
      className="absolute left-1/2 z-20 pointer-events-none"
      style={{ transform: 'translate(-50%, 50%)', bottom: bottomOffset }}
    >
      <span
        className="inline-flex items-center px-2 whitespace-nowrap rounded shadow-sm border border-[var(--color-overlay-border)] text-[11px] font-[500] tabular-nums text-fg-secondary"
        style={{
          background: 'var(--color-bg-overlay)',
          paddingTop: 3,
          paddingBottom: 3,
          lineHeight: '1'
        }}
      >
        {label}
      </span>
    </div>
  )
}
