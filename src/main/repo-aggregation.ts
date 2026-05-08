/**
 * Repo-level aggregation for the M5 RepoChangesModal.
 *
 * Given a (workspaceId, repoPath) pair, finds every pane in the workspace
 * that resolves to the same repo root, runs the per-pane projection
 * (`projectTurnsForPane`) for each, and bundles them into a single
 * `RepoTurnsGetResult` the renderer can show without N round-trips.
 *
 * Aggregation rules:
 *   - Group key is the repo root derived via `worktreePathToRepoPath` —
 *     same function the kanban repo card uses, so panes group the same
 *     way.
 *   - Workspace scope is enforced: a pane in workspace A whose repoPath
 *     matches a workspace-B request is excluded. The renderer only ever
 *     opens the modal in the context of a single workspace.
 *   - Order: panes are sorted by `createdAt` ascending so list position
 *     is stable across renders (keyboard nav can rely on it).
 */

import type { SessionRegistry } from './session-registry'
import { detectMainBranch, getCurrentBranch } from './git-status'
import { projectTurnsForPane } from './turn-projection'
import { worktreePathToRepoPath } from './repo-path'
import * as workspaceStore from './workspace-store'
import type { RepoTurnsGetResult, RepoPaneTurns } from '../shared/ipc-channels'
import type { PaneState, TurnPendingAction, PublishPath } from '../shared/types'

export async function aggregateRepoTurns(args: {
  sessionRegistry: SessionRegistry
  workspaceId: string
  repoPath: string
}): Promise<RepoTurnsGetResult> {
  const { sessionRegistry, workspaceId, repoPath } = args
  const targetRepoRoot = repoPath

  const matchingPanes: PaneState[] = []
  for (const pane of sessionRegistry.getAllPanes().values()) {
    if (pane.workspaceId !== workspaceId) continue
    const paneRepoRoot = worktreePathToRepoPath(pane.worktreePath)
    if (paneRepoRoot !== targetRepoRoot) continue
    matchingPanes.push(pane)
  }
  matchingPanes.sort((a, b) => a.createdAt - b.createdAt)

  const sections: RepoPaneTurns[] = []
  for (const pane of matchingPanes) {
    const baseBranch = await detectMainBranch(pane.worktreePath).catch(() => null)
    const currentBranch = await getCurrentBranch(pane.worktreePath).catch(() => null)
    const paneExt = pane as {
      autoCommitEnabled?: boolean
      pendingAction?: TurnPendingAction | null
      userName?: string | null
    }
    let turns: RepoPaneTurns['turns'] = []
    if (baseBranch && currentBranch) {
      turns = await projectTurnsForPane(pane.worktreePath, pane.id, baseBranch, currentBranch).catch(() => [])
    }
    sections.push({
      paneId: pane.id,
      paneName: paneExt.userName?.trim() ||
        pane.metrics.agentName ||
        pane.metrics.sessionTitle ||
        pane.worktreeName,
      worktreeName: pane.worktreeName,
      currentBranch,
      baseBranch,
      isWorktree: pane.isWorktree,
      autoCommitEnabled: paneExt.autoCommitEnabled !== false,
      pendingAction: paneExt.pendingAction ?? null,
      turns,
      diagnostic: turns.length === 0
        ? { isWorktree: pane.isWorktree, currentBranch, baseBranch }
        : undefined
    })
  }

  // Resolve the repo display label. Use the first pane's repoName when we
  // have one (every pane in a repo shares the same repoName); fall back to
  // the path's basename when no panes match (the caller may still want to
  // show an empty modal with the right title).
  const repoLabel = matchingPanes[0]?.repoName ?? lastSegment(targetRepoRoot)

  const publishPath = resolveRepoPublishPath(workspaceId, targetRepoRoot)

  return {
    error: null,
    repoLabel,
    panes: sections,
    publishPath
  }
}

function lastSegment(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * Resolve the effective publish path for a (workspace, repo) — per-repo
 * override wins, then workspace default, then 'both'. Same logic the
 * REPO_PUBLISH_PATH_GET handler uses inline; centralised here so the
 * aggregator and any other M5 caller stay consistent.
 */
function resolveRepoPublishPath(workspaceId: string, repoPath: string): PublishPath {
  const ws = workspaceStore.getWorkspace(workspaceId)
  if (!ws) return 'both'
  const override = ws.publishPathOverrides?.[repoPath]
  if (override) return override
  return ws.defaultPublishPath ?? 'both'
}
