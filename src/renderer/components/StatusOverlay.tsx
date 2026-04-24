import React from 'react'
import type { PaneStatus, GitStatus } from '../../shared/types'
import {
  Circle,
  CircleDot,
  ArrowDownToLine,
  CircleCheck,
  AlertTriangle,
  GitMerge
} from 'lucide-react'
import {
  STATUS_COLORS,
  STATUS_TERMINATED_COLOR,
  STATUS_OVERLAY_TOOL_NAME_MAX
} from '../lib/constants'
import { formatToolActivity } from '../../shared/tool-activity'
import { useStrings, type Strings } from '../lib/strings'

// ---------------------------------------------------------------------------
// StatusOverlay
// ---------------------------------------------------------------------------

interface StatusOverlayProps {
  status: PaneStatus
  activeToolName: string | null
  terminated: boolean
  gitStatus?: GitStatus | null
  isResolvingConflict?: boolean
}

const STATUS_LABELS: Record<PaneStatus, string> = {
  'awaiting-prompt': 'Awaiting orders',
  working: 'Working',
  'needs-input': 'Needs input',
  done: 'Done',
  error: 'Error'
}

/**
 * Build the status overlay label string (PRD F5 Layer 2).
 * Exported for unit testing.
 */
export function formatStatusLabel(
  status: PaneStatus,
  activeToolName: string | null,
  terminated: boolean,
  isResolvingConflict?: boolean,
  localized?: Strings
): string {
  const labels: Record<PaneStatus, string> = localized
    ? {
        'awaiting-prompt': localized.statusOverlay.labelAwaitingOrders,
        working: localized.statusOverlay.labelWorking,
        'needs-input': localized.statusOverlay.labelNeedsInput,
        done: localized.statusOverlay.labelDone,
        error: localized.statusOverlay.labelError
      }
    : STATUS_LABELS
  const lostLabel = localized?.statusOverlay.labelLost ?? 'Lost'
  const resolvingLabel = localized?.statusOverlay.labelResolvingConflict ?? 'Resolving Conflict'

  if (terminated) return lostLabel
  if (isResolvingConflict) {
    if (status === 'working' && activeToolName) {
      const phrase = formatToolActivity(activeToolName)
      const truncated =
        phrase.length > STATUS_OVERLAY_TOOL_NAME_MAX
          ? phrase.slice(0, STATUS_OVERLAY_TOOL_NAME_MAX)
          : phrase
      return localized
        ? localized.statusOverlay.labelResolvingConflictFmt(truncated)
        : `Resolving Conflict: ${truncated}`
    }
    return resolvingLabel
  }
  if (status === 'working' && activeToolName) {
    const phrase = formatToolActivity(activeToolName)
    return phrase.length > STATUS_OVERLAY_TOOL_NAME_MAX
      ? phrase.slice(0, STATUS_OVERLAY_TOOL_NAME_MAX)
      : phrase
  }
  return labels[status]
}

type StatusIconProps = {
  status: PaneStatus
  terminated: boolean
  isResolvingConflict: boolean
  color: string
}

function StatusIcon({ status, terminated, isResolvingConflict, color }: StatusIconProps): React.JSX.Element {
  const props = { size: 14, style: { color }, className: 'flex-shrink-0' }
  if (terminated || status === 'error') return <AlertTriangle {...props} />
  if (isResolvingConflict) return <GitMerge {...props} />
  if (status === 'awaiting-prompt') return <Circle {...props} />
  if (status === 'working') return <CircleDot {...props} />
  if (status === 'needs-input') return <ArrowDownToLine {...props} />
  if (status === 'done') return <CircleCheck {...props} />
  return <Circle {...props} />
}

/**
 * StatusOverlay — pill centered on the top border of a pane (PRD F5 Layer 2).
 *
 * Pill straddles the top border via translateY(-50%). bg-overlay background,
 * 1px border at status color 0.5 alpha, shadow-sm, Lucide icon + fg-primary label.
 */
export function StatusOverlay({
  status,
  activeToolName,
  terminated,
  gitStatus,
  isResolvingConflict = false
}: StatusOverlayProps): React.JSX.Element {
  const t = useStrings()
  let label = formatStatusLabel(status, activeToolName, terminated, isResolvingConflict, t)

  // Append git summary when idle (but not during conflict resolution)
  if (
    !terminated &&
    !isResolvingConflict &&
    (status === 'done' || status === 'awaiting-prompt') &&
    gitStatus
  ) {
    const parts: string[] = []
    if (gitStatus.changedFileCount > 0) parts.push(t.statusOverlay.modifiedFmt(gitStatus.changedFileCount))
    if (gitStatus.commitsAhead > 0) parts.push(t.statusOverlay.aheadFmt(gitStatus.commitsAhead))
    if (parts.length > 0) {
      label += ` \u00b7 ${parts.join(' \u00b7 ')}`
    }
  }

  const color = terminated ? STATUS_TERMINATED_COLOR : STATUS_COLORS[status]
  const borderColor = `${color}80` // 0.5 alpha
  const isWorking = !terminated && status === 'working'

  return (
    <div
      className="absolute top-0 left-1/2 z-20 pointer-events-none"
      style={{ transform: 'translate(-50%, -50%)' }}
    >
      <div
        className="inline-flex items-center gap-1.5 px-2 rounded shadow-sm whitespace-nowrap"
        style={{
          background: 'var(--color-bg-overlay)',
          border: `1px solid ${borderColor}`,
          paddingTop: 4,
          paddingBottom: 4,
          ...(isWorking && { animation: 'status-working-pulse 1.4s ease-in-out infinite' })
        }}
      >
        <StatusIcon
          status={status}
          terminated={terminated}
          isResolvingConflict={isResolvingConflict}
          color={color}
        />
        <span className="text-xs font-[500] text-fg-primary" style={{ lineHeight: '1' }}>
          {label}
        </span>
      </div>
    </div>
  )
}
