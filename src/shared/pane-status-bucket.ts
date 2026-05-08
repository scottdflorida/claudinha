import type { PaneStatus } from './types'

/**
 * Map a pane's raw `status` + `permissionMode` to the column / group it
 * should appear under in the kanban board and the repo rail.
 *
 * Plan-mode tool work shows in Planning, not Working — composing a plan is
 * a distinct activity from building code, even though both run tools. The
 * `plan-ready` state is owned by hook-listener's routeStopStatus and arrives
 * via `pane.status === 'plan-ready'` on Stop; this branch is only the
 * mid-composition case.
 *
 * Both the kanban board and the rail call this helper so they always agree
 * on which bucket a pane belongs in.
 */
export function bucketPaneStatus(
  status: PaneStatus,
  permissionMode: 'normal' | 'plan'
): PaneStatus {
  if (status === 'working' && permissionMode === 'plan') {
    return 'planning'
  }
  return status
}
