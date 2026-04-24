import path from 'path'
import fs from 'fs'
import type { PaneState } from '../shared/types'
import { IPC } from '../shared/ipc-channels'
import type { PaneClosedPayload } from '../shared/ipc-channels'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import type { PtyPool } from './pty-pool'
import type { StatusDetector } from './status-detector'
import type { MetricsCollector } from './metrics-collector'
import type { GitStatusPoller } from './git-status-poller'
import type { PaneTransitionBuffer } from './pane-transition-buffer'
import type { WorkspaceManager } from './workspace-manager'
import type { InspectorService } from './inspector'
import type { PlanApprovalSequencer } from './plan-approval-sequencer'
import { addSessionHistoryEntry } from './session-history-store'
import { deregisterPaneSession, trackSessionCompleted } from './analytics/session-instrumentation'
import { trackPaneClosed } from './analytics/usage-instrumentation'
import { getStatuslineTempDir } from './constants'

/**
 * Dependencies needed to fully close a pane. Bundled into one object so
 * callers don't have to thread a dozen singletons through every call site.
 */
export interface PaneLifecycleDeps {
  sessionRegistry: SessionRegistry
  windowManager: WindowManager
  ptyPool: PtyPool
  statusDetector: StatusDetector
  metricsCollector: MetricsCollector
  gitStatusPoller: GitStatusPoller
  transitionBuffer: PaneTransitionBuffer
  workspaceManager: WorkspaceManager
  inspector?: InspectorService
  planApprovalSequencer?: PlanApprovalSequencer
}

/**
 * Tear down a pane completely: stop all subsystems watching it, record its
 * session in history, snapshot it in its workspace's dormant list, remove it from
 * the session registry, kill the PTY, delete its statusline temp file, and
 * notify the renderer window so it removes the pane from its grid.
 *
 * Extracted from the `PANE_CLOSE` and `PANE_CLOSE_WORKTREE` IPC handlers so
 * the completion executor's auto-close flow can share a single code path.
 * The `extra` overrides let the auto-close path attach a `completionAction`
 * and `prUrl` to the dormant snapshot so the dormant panel (later) can
 * distinguish merged terminals from manually-closed ones.
 */
export function closePaneInternal(
  deps: PaneLifecycleDeps,
  paneId: string,
  extra: {
    /** Optional metadata to merge into the dormant terminal snapshot */
    snapshotExtras?: Partial<Pick<import('../shared/types').TerminalSnapshot, 'completionAction' | 'prUrl'>>
  } = {}
): PaneState | null {
  const {
    sessionRegistry,
    windowManager,
    ptyPool,
    statusDetector,
    metricsCollector,
    gitStatusPoller,
    transitionBuffer,
    workspaceManager,
    inspector,
    planApprovalSequencer
  } = deps

  // Stop subsystems watching this pane.
  gitStatusPoller.unwatchPane(paneId)
  statusDetector.deregisterPane(paneId)
  metricsCollector.unwatchPane(paneId)
  transitionBuffer.clear(paneId)
  inspector?.forgetPane(paneId)
  planApprovalSequencer?.onPaneClosed(paneId)

  // Record the session for future resume before removing.
  const paneBeforeRemove = sessionRegistry.getPane(paneId)
  if (paneBeforeRemove?.sessionId) {
    addSessionHistoryEntry({
      sessionId: paneBeforeRemove.sessionId,
      worktreePath: paneBeforeRemove.worktreePath,
      repoName: paneBeforeRemove.repoName,
      worktreeName: paneBeforeRemove.worktreeName,
      sessionTitle: paneBeforeRemove.metrics.sessionTitle,
      completedAt: Date.now()
    })
  }

  // Record the terminal in its workspace's dormant list before removing from registry.
  // The snapshot picks up any completion metadata the caller supplied.
  if (paneBeforeRemove) {
    workspaceManager.removeDroneFromHive(paneBeforeRemove.workspaceId, paneBeforeRemove)
    if (extra.snapshotExtras) {
      // Patch the snapshot we just added with the extras. removeDroneFromHive
      // pushes the snapshot to the end of the dormant list, so we can mutate
      // the last entry in place.
      const workspace = workspaceManager.getWorkspace(paneBeforeRemove.workspaceId)
      if (workspace && workspace.pausedTerminals.length > 0) {
        const last = workspace.pausedTerminals[workspace.pausedTerminals.length - 1]
        if (last.paneId === paneId) {
          Object.assign(last, extra.snapshotExtras)
        }
      }
    }
    workspaceManager.pushManagerUpdate()
  }

  const pane = sessionRegistry.removePane(paneId)
  if (pane) {
    trackSessionCompleted(pane)
    deregisterPaneSession(paneId)
    const remainingCount = sessionRegistry.getPanesForWindow(pane.windowId).length
    trackPaneClosed(pane.createdAt, pane.status, remainingCount)
  }
  ptyPool.kill(paneId)

  // Delete the statusline temp file written by the hook relay (PRD F6).
  const statuslineFile = path.join(getStatuslineTempDir(), `claudinha-statusline-${paneId}.json`)
  fs.unlink(statuslineFile, () => {
    // Ignore error — file may not exist if hooks never fired.
  })

  // Notify the renderer so the pane disappears from its window.
  if (pane) {
    const targetWindow = windowManager.getWindow(pane.windowId)
    if (targetWindow && !targetWindow.isDestroyed()) {
      const closedPayload: PaneClosedPayload = { paneId }
      targetWindow.webContents.send(IPC.PANE_CLOSED, closedPayload)
    }
    // The workspace's active-repo set may have shrunk; refresh the window title.
    workspaceManager.applyWindowTitle(pane.windowId)
  }

  return pane ?? null
}
