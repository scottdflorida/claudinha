/**
 * bulk-action-pipeline — runs an action across N panes in a workspace,
 * accumulates per-pane results, emits progress events, and resolves
 * with the full results array.
 *
 * Per-repo serialization: actions that touch a repo's git state (merge,
 * push, PR open) acquire the side-clone manager's per-repo mutex so
 * two panes in the same repo never race the side-clone or push refs
 * concurrently. Across repos the pipeline runs panes sequentially too
 * — N is small (workspace size) and the simpler ordering keeps the
 * progress events readable.
 *
 * Errors are recorded, not thrown. The pipeline always drains so the
 * post-bulk multi-conflict modal can surface every failure at once.
 *
 * Cancellation: a `BULK_CANCEL` IPC stops the pipeline before the next
 * pane starts. In-flight actions complete (we'd rather end with a
 * coherent per-repo state than abort mid-merge).
 */

import { randomUUID } from 'crypto'

import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import type { SideCloneManager } from './side-clone-manager'
import { squashAndPublish } from './publish-engine'
import { discardTurn } from './discard-engine'
import { worktreePathToRepoPath } from './repo-path'
import { detectMainBranch, getCurrentBranch } from './git-status'
import { projectTurnsForPane } from './turn-projection'
import { IPC } from '../shared/ipc-channels'
import type {
  BulkActionKind,
  BulkActionResult,
  BulkProgressPayload,
  BulkCompletedPayload,
  BulkRunResult
} from '../shared/ipc-channels'

interface RunningRun {
  runId: string
  workspaceId: string
  repoPath: string
  cancelled: boolean
}

const ACTIVE: Map<string, RunningRun> = new Map()

export function isBulkRunActive(runId: string): boolean {
  return ACTIVE.has(runId)
}

export function cancelBulkRun(runId: string): boolean {
  const run = ACTIVE.get(runId)
  if (!run) return false
  run.cancelled = true
  return true
}

export async function runBulkAction(args: {
  workspaceId: string
  repoPath: string
  paneIds: string[]
  action: BulkActionKind
  sessionRegistry: SessionRegistry
  windowManager: WindowManager
  sideCloneManager: SideCloneManager
}): Promise<BulkRunResult> {
  const {
    workspaceId, repoPath, paneIds, action,
    sessionRegistry, windowManager, sideCloneManager
  } = args

  if (paneIds.length === 0) {
    return { error: 'no panes selected' }
  }

  const runId = randomUUID()
  const run: RunningRun = { runId, workspaceId, repoPath, cancelled: false }
  ACTIVE.set(runId, run)

  // Run async; the caller invokes us with `void` — they get { runId } back
  // immediately and listen for BULK_PROGRESS / BULK_COMPLETED events. This
  // intentionally fires-and-forgets the body so the renderer's invoke
  // returns fast.
  void (async () => {
    const results: BulkActionResult[] = []
    const total = paneIds.length
    try {
      for (let i = 0; i < paneIds.length; i++) {
        if (run.cancelled) {
          results.push({
            paneId: paneIds[i]!,
            ok: false,
            errorKind: 'unknown',
            errorMessage: 'cancelled'
          })
          // Cancellation still emits a progress tick so the renderer
          // counter doesn't stall on a half-drained run.
          broadcastToAllWindows(windowManager, IPC.BULK_PROGRESS, {
            runId,
            paneId: paneIds[i]!,
            result: results[results.length - 1]!,
            completed: i + 1,
            total
          } satisfies BulkProgressPayload)
          continue
        }
        const paneId = paneIds[i]!
        const result = await runOnePane({
          paneId,
          action,
          sessionRegistry,
          windowManager,
          sideCloneManager
        })
        results.push(result)
        broadcastToAllWindows(windowManager, IPC.BULK_PROGRESS, {
          runId, paneId, result,
          completed: i + 1,
          total
        } satisfies BulkProgressPayload)
      }
    } finally {
      ACTIVE.delete(runId)
      broadcastToAllWindows(windowManager, IPC.BULK_COMPLETED, {
        runId, results
      } satisfies BulkCompletedPayload)
    }
  })()

  return { error: null, runId }
}

async function runOnePane(args: {
  paneId: string
  action: BulkActionKind
  sessionRegistry: SessionRegistry
  windowManager: WindowManager
  sideCloneManager: SideCloneManager
}): Promise<BulkActionResult> {
  const { paneId, action, sessionRegistry, windowManager, sideCloneManager } = args
  const pane = sessionRegistry.getPane(paneId)
  if (!pane) {
    return { paneId, ok: false, errorKind: 'unknown', errorMessage: 'pane not found' }
  }

  const baseBranch = await detectMainBranch(pane.worktreePath).catch(() => null)
  const currentBranch = await getCurrentBranch(pane.worktreePath).catch(() => null)
  if (!baseBranch || !currentBranch) {
    return {
      paneId,
      ok: false,
      errorKind: 'unknown',
      errorMessage: 'could not resolve branch'
    }
  }

  // Pre-pull the projection so we can drive the squash with the full set
  // of open turns. Bulk actions act on "everything publishable on this
  // pane" — the user already opted in to bulk; we don't ask them to
  // re-select per pane.
  const projection = await projectTurnsForPane(
    pane.worktreePath, paneId, baseBranch, currentBranch
  ).catch(() => [])
  const publishable = projection.filter(
    (t) => t.state === 'open' || t.state === 'pushed'
  )

  if (action === 'discard-all') {
    // Discard works on tip-down: drop turns newest-first so each cascade
    // is small. discard-engine refuses non-cascade-confirmed when there
    // are dependents, but tip-down processing keeps it linear.
    if (publishable.length === 0) {
      return { paneId, ok: true }
    }
    for (const turn of [...publishable].reverse()) {
      const result = await discardTurn({
        worktreePath: pane.worktreePath,
        paneId,
        windowId: pane.windowId,
        windowManager,
        sessionRegistry,
        turnId: turn.id,
        cascadeConfirmed: true
      })
      if (!result.ok) {
        return {
          paneId,
          ok: false,
          errorKind: 'unknown',
          errorMessage: result.error ?? 'discard failed'
        }
      }
    }
    return { paneId, ok: true }
  }

  // Publish actions need a coherent commit message. Reuse the latest
  // turn's summary; if the user wants something different they should
  // publish per-pane via the per-terminal modal.
  if (publishable.length === 0) {
    return { paneId, ok: true }
  }
  const message = publishable[publishable.length - 1]!.summary || 'publish'
  const turnIds = publishable.map((t) => t.id)

  const path = bulkActionToPublishPath(action)
  if (!path) {
    return {
      paneId,
      ok: false,
      errorKind: 'unknown',
      errorMessage: `unsupported bulk action: ${action}`
    }
  }

  const repoPath = worktreePathToRepoPath(pane.worktreePath)
  const result = await squashAndPublish({
    worktreePath: pane.worktreePath,
    repoPath,
    paneId,
    windowId: pane.windowId,
    windowManager,
    sessionRegistry,
    sideCloneManager,
    turnIds,
    message,
    path,
    // Bulk runs typically merge N panes in sequence. The first one
    // FFs onto origin/base; the next one's branch was forked off the
    // OLD base, so it won't FF. Permit a merge commit there — it's
    // the correct outcome for a bulk merge of independent agents and
    // matches what a human would do merging two PRs in a row.
    allowNoFastForward: action === 'merge'
  })

  if (result.ok) {
    return { paneId, ok: true, resultUrl: result.prUrl }
  }
  // Substitute the cryptic `wt-XXXX` branch name with the pane's
  // display name so the multi-conflict modal reads in product
  // terminology. The branch name still appears in logs / git output
  // for users who need it.
  const paneLabel = describePane(pane)
  const friendlyMessage = (result.error ?? 'unknown error')
    .replace(/'wt-[0-9a-f]+'/g, `'${paneLabel}'`)
  return {
    paneId,
    ok: false,
    errorKind: classifyErrorKind(result.errorKind),
    errorMessage: friendlyMessage
  }
}

function describePane(pane: { metrics: { agentName: string | null; sessionTitle: string | null }; worktreeName: string; userName?: string | null }): string {
  return (pane.userName?.trim() ||
          pane.metrics.agentName ||
          pane.metrics.sessionTitle ||
          pane.worktreeName)
}

function classifyErrorKind(engineKind: string | undefined): BulkActionResult['errorKind'] {
  switch (engineKind) {
    case 'rebase-failed': return 'conflict'
    case 'push-rejected': return 'push-rejected'
    case 'apply-failed':  return 'conflict'
    default:              return 'unknown'
  }
}

function bulkActionToPublishPath(action: BulkActionKind):
  'push-branch' | 'direct-merge' | 'pr' | 'draft-pr' | null
{
  switch (action) {
    case 'push-branch': return 'push-branch'
    case 'merge': return 'direct-merge'
    case 'open-pr': return 'pr'
    case 'open-draft-pr': return 'draft-pr'
    case 'discard-all': return null
    default: return null
  }
}

/**
 * Broadcast a payload to every non-destroyed BrowserWindow. The
 * pipeline doesn't know which window opened the modal, and a
 * single-window pick can land on the wrong one in multi-window
 * setups, leaving the modal's counter stuck. Renderers filter by
 * runId so duplicate delivery is harmless.
 */
function broadcastToAllWindows(windowManager: WindowManager, channel: string, payload: unknown): void {
  for (const w of windowManager.getAllWindows().values()) {
    if (!w.isDestroyed()) {
      w.webContents.send(channel, payload)
    }
  }
}
