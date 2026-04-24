import React, { useCallback, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type {
  CompletionMergeAllPayload,
  CompletionMergeAllResult,
  CompletionPrAllPayload,
  CompletionPrAllResult,
  RepoPushBaseBranchPayload,
  RepoPushBaseBranchResult,
  RepoMergeAndPushPayload,
  RepoMergeAndPushResult,
  RepoApprovePlansInSequencePayload,
  RepoApprovePlansInSequenceResult,
  RepoStopPlanSequencePayload,
  RepoStopPlanSequenceResult,
  RepoRetryFailedMergesPayload,
  RepoRetryFailedMergesResult
} from '../../shared/ipc-channels'
import { ipcInvoke } from '../hooks/useIpc'
import { useInspector } from '../hooks/useInspector'
import { KanbanRepoCard } from './KanbanRepoCard'
import { ClaudeMdEditorModal } from './ClaudeMdEditorModal'
import { useStrings } from '../lib/strings'

interface KanbanRepoRailProps {
  workspaceId: string | undefined
  /** Currently active pane in Kanban view (highlights the matching session row). */
  activePaneId: string | null
  /** Callback when the user clicks a session row in any repo card. */
  onSelectSession: (paneId: string) => void
  /** Opens the SpawnDialog to add a new terminal/session. */
  onSpawnClick: () => void
}

/**
 * KanbanRepoRail — bottom-left rail in Kanban view.
 *
 * One card per repo in the workspace. Each card shows rollups, status dots,
 * and a collapsible session list. Bulk-action buttons (Merge / Push /
 * Merge + push) are stubbed in Phase 5 and wired in Phase 6. The CLAUDE.md
 * editor pencil is stubbed in Phase 5 and wired in Phase 7.
 *
 * Subscribes to the workspace's INSPECTOR_SUMMARY broadcast for repo + per-pane
 * data — the same source the Inspector drawer uses, so numbers always agree.
 */
export function KanbanRepoRail({ workspaceId, activePaneId, onSelectSession, onSpawnClick }: KanbanRepoRailProps): React.JSX.Element {
  const t = useStrings()
  const { summary } = useInspector(workspaceId ?? null)
  const [editingRepo, setEditingRepo] = useState<{ repoPath: string; repoLabel: string } | null>(null)

  // Per-repo bulk actions (Phase 6). Each invokes its IPC handler; the UI
  // updates via INSPECTOR_SUMMARY broadcasts (rollup readyCount + diff stats)
  // and COMPLETION_STATUS broadcasts (per-pane sync indicator).
  const triggerMerge = useCallback(async (repoPath: string) => {
    if (!workspaceId) return
    const payload: CompletionMergeAllPayload = {
      scope: 'workspace',
      workspaceId,
      strategy: 'rebase-ff',
      repoPath
    }
    try {
      const result = (await ipcInvoke(IPC.COMPLETION_MERGE_ALL, payload)) as CompletionMergeAllResult
      if (result.error) console.warn('[KanbanRepoRail] merge failed:', result.error)
    } catch (err) {
      console.warn('[KanbanRepoRail] merge invoke failed:', err)
    }
  }, [workspaceId])

  const triggerPush = useCallback(async (repoPath: string) => {
    if (!workspaceId) return
    const payload: RepoPushBaseBranchPayload = { workspaceId, repoPath }
    try {
      const result = (await ipcInvoke(IPC.REPO_PUSH_BASE_BRANCH, payload)) as RepoPushBaseBranchResult
      if (result.error) console.warn('[KanbanRepoRail] push failed:', result.error)
    } catch (err) {
      console.warn('[KanbanRepoRail] push invoke failed:', err)
    }
  }, [workspaceId])

  const triggerMergeAndPush = useCallback(async (repoPath: string) => {
    if (!workspaceId) return
    const payload: RepoMergeAndPushPayload = {
      workspaceId,
      repoPath,
      strategy: 'rebase-ff'
    }
    try {
      const result = (await ipcInvoke(IPC.REPO_MERGE_AND_PUSH, payload)) as RepoMergeAndPushResult
      if (result.error) console.warn('[KanbanRepoRail] merge+push failed:', result.error)
      else if (result.pushError) console.warn('[KanbanRepoRail] push leg failed:', result.pushError)
    } catch (err) {
      console.warn('[KanbanRepoRail] merge+push invoke failed:', err)
    }
  }, [workspaceId])

  const triggerCreatePr = useCallback(async (repoPath: string) => {
    if (!workspaceId) return
    const payload: CompletionPrAllPayload = {
      scope: 'workspace',
      workspaceId,
      draft: false,
      repoPath
    }
    try {
      const result = (await ipcInvoke(IPC.COMPLETION_PR_ALL, payload)) as CompletionPrAllResult
      if (result.error) console.warn('[KanbanRepoRail] create PR failed:', result.error)
    } catch (err) {
      console.warn('[KanbanRepoRail] create PR invoke failed:', err)
    }
  }, [workspaceId])

  const triggerApprovePlansInSequence = useCallback(async (repoPath: string) => {
    if (!workspaceId) return
    const payload: RepoApprovePlansInSequencePayload = { workspaceId, repoPath }
    try {
      const result = (await ipcInvoke(
        IPC.REPO_APPROVE_PLANS_IN_SEQUENCE,
        payload
      )) as RepoApprovePlansInSequenceResult
      if (result.error) console.warn('[KanbanRepoRail] approve-plans failed:', result.error)
    } catch (err) {
      console.warn('[KanbanRepoRail] approve-plans invoke failed:', err)
    }
  }, [workspaceId])

  const triggerStopPlanSequence = useCallback(async (repoPath: string) => {
    if (!workspaceId) return
    const payload: RepoStopPlanSequencePayload = { workspaceId, repoPath }
    try {
      const result = (await ipcInvoke(
        IPC.REPO_STOP_PLAN_SEQUENCE,
        payload
      )) as RepoStopPlanSequenceResult
      if (result.error) console.warn('[KanbanRepoRail] stop-plan-sequence failed:', result.error)
    } catch (err) {
      console.warn('[KanbanRepoRail] stop-plan-sequence invoke failed:', err)
    }
  }, [workspaceId])

  const triggerRetryFailedMerges = useCallback(async (repoPath: string) => {
    if (!workspaceId) return
    const payload: RepoRetryFailedMergesPayload = {
      workspaceId,
      repoPath,
      strategy: 'rebase-ff'
    }
    try {
      const result = (await ipcInvoke(
        IPC.REPO_RETRY_FAILED_MERGES,
        payload
      )) as RepoRetryFailedMergesResult
      if (result.error) console.warn('[KanbanRepoRail] retry-failed-merges failed:', result.error)
    } catch (err) {
      console.warn('[KanbanRepoRail] retry-failed-merges invoke failed:', err)
    }
  }, [workspaceId])

  // Header is rendered above whatever body the rail is showing — empty state,
  // loading, or the repo cards — so the visual structure is always the same.
  const railHeader = (
    <header
      className="shrink-0 px-3 py-2 border-b border-[var(--color-border-subtle)]"
    >
      <span className="text-xs font-[600] uppercase tracking-wider text-fg-muted">
        {t.kanban.railHeader}
      </span>
    </header>
  )

  // + Terminal CTA — shown below the header in every rail state that has a
  // workspace bound. Opens the SpawnDialog.
  const railCta = (
    <div className="shrink-0 px-3 pt-3 pb-2">
      <button
        type="button"
        onClick={onSpawnClick}
        aria-label={t.kanban.newTerminalAria}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-[500] text-fg-primary bg-raised hover:bg-surface border border-[var(--color-border-subtle)] rounded px-3 py-2 transition-[color,background-color] duration-[80ms]"
      >
        {t.kanban.railNewTerminalButton}
      </button>
    </div>
  )

  if (!workspaceId) {
    return (
      <div className="h-full flex flex-col">
        {railHeader}
        <div className="p-4 text-xs text-fg-muted">{t.kanban.railNoWorkspace}</div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="h-full flex flex-col">
        {railHeader}
        {railCta}
        <div className="p-4 text-xs text-fg-muted">{t.kanban.railLoading}</div>
      </div>
    )
  }

  if (summary.repos.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {railHeader}
        {railCta}
        <div className="p-4 text-xs text-fg-muted">Spawn an agent to populate the rail.</div>
      </div>
    )
  }

  return (
    <>
      <div className="h-full flex flex-col">
        {railHeader}
        {railCta}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        {summary.repos.map((rollup) => {
          const repoPanes = summary.panes.filter((p) => p.repoPath === rollup.repoPath)
          // Enable predicates per concept doc:
          //   Merge        — readyCount > 0
          //   Push         — baseAheadOfOrigin > 0
          //   Merge + push — readyCount > 0 (after merge there's something to push)
          const baseAhead = rollup.baseAheadOfOrigin ?? 0
          const canMerge = rollup.readyCount > 0
          const canPush = baseAhead > 0
          const canMergeAndPush = canMerge // post-merge there will be commits to push
          return (
            <KanbanRepoCard
              key={rollup.repoPath}
              rollup={rollup}
              panes={repoPanes}
              activePaneId={activePaneId}
              onSelectSession={onSelectSession}
              onMerge={canMerge ? () => triggerMerge(rollup.repoPath) : undefined}
              onPush={canPush ? () => triggerPush(rollup.repoPath) : undefined}
              onMergeAndPush={canMergeAndPush ? () => triggerMergeAndPush(rollup.repoPath) : undefined}
              onCreatePr={canMerge ? () => triggerCreatePr(rollup.repoPath) : undefined}
              onEditClaudeMd={() =>
                setEditingRepo({ repoPath: rollup.repoPath, repoLabel: rollup.repoLabel })
              }
              onApprovePlansInSequence={() => triggerApprovePlansInSequence(rollup.repoPath)}
              onStopPlanSequence={() => triggerStopPlanSequence(rollup.repoPath)}
              onRetryFailedMerges={() => triggerRetryFailedMerges(rollup.repoPath)}
            />
          )
        })}
        </div>
      </div>
      {editingRepo && workspaceId && (
        <ClaudeMdEditorModal
          workspaceId={workspaceId}
          repoPath={editingRepo.repoPath}
          repoLabel={editingRepo.repoLabel}
          onClose={() => setEditingRepo(null)}
        />
      )}
    </>
  )
}
