import path from 'path'
import os from 'os'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { ipcMain, shell, BrowserWindow, dialog, app } from 'electron'
import { IPC } from '../shared/ipc-channels'
import { getStatuslineTempDir } from './constants'
import {
  trackPaneSpawned,
  trackPaneClosed,
  trackPaneMoved,
  trackWindowCreated,
  trackWindowClosed,
  trackFeedbackSubmitted,
  trackSpawnModeSelected,
  trackKeyboardShortcutUsed
} from './analytics/usage-instrumentation'
import {
  trackWorkspaceCreated,
  trackWorkspaceArchived,
  trackWorkspaceUnarchived,
  trackWorkspaceDeletedArchived
} from './analytics/workspace-instrumentation'
import {
  registerPaneSpawnMode,
  deregisterPaneSession,
  trackSessionCompleted
} from './analytics/session-instrumentation'
import {
  recordPtySpawnStart,
  recordPtyFirstData,
  clearPtySpawnTracking
} from './analytics/performance-instrumentation'
import { trackPtyCrashed, trackFallbackActivated } from './analytics/error-instrumentation'
import { metricsToIpc } from '../shared/ipc-channels'
import type {
  PaneSpawnPayload,
  PaneClosePayload,
  PaneInputPayload,
  PaneResizePayload,
  PaneReadyPayload,
  PaneMovePayload,
  PaneRespawnPayload,
  PaneEffortPayload,
  PaneModelPayload,
  GlobalEffortPayload,
  WindowNewPayload,
  WindowEntry,
  FeedbackSendPayload,
  WorktreeListPayload,
  WorktreeListResult,
  WorktreeEntry,
  PathValidatePayload,
  PathValidateResult,
  GitInitPayload,
  GitInitResult,
  PaneSpawnedPayload,
  PaneClosedPayload,
  PaneMovedInPayload,
  PaneTerminatedPayload,
  PaneRespawnedPayload,
  PaneDataPayload,
  PaneSpawnResult,
  PaneCloseWorktreePayload,
  PaneCloseWorktreeResult,
  PaneMergeAndClosePayload,
  PaneMergeAndCloseResult,
  CompletionMergePayload,
  CompletionPrPayload,
  CompletionAbortPayload,
  CompletionDismissPayload,
  CompletionClearStatePayload,
  CompletionCancelQueuePayload,
  CompletionResolvePayload,
  CompletionPolicySetGlobalPayload,
  CompletionPolicySetWorkspacePayload,
  CompletionPolicyGetWorkspacePayload,
  CompletionPolicyGlobalChangedPayload,
  CompletionPolicyWorkspaceChangedPayload,
  CompletionMergeAllPayload,
  CompletionMergeAllResult,
  CompletionPrAllPayload,
  CompletionPrAllResult,
  WorkspaceSetViewModePayload,
  WorkspaceSetViewModeResult,
  WorkspaceSetActivePanePayload,
  WorkspaceSetActivePaneResult,
  RepoPushBaseBranchPayload,
  RepoPushBaseBranchResult,
  RepoMergeAndPushPayload,
  RepoMergeAndPushResult,
  RepoApprovePlansInSequencePayload,
  RepoApprovePlansInSequenceResult,
  RepoStopPlanSequencePayload,
  RepoStopPlanSequenceResult,
  RepoRetryFailedMergesPayload,
  RepoRetryFailedMergesResult,
  RepoClaudeMdReadPayload,
  RepoClaudeMdReadResult,
  RepoClaudeMdSavePayload,
  RepoClaudeMdSaveResult,
  RepoDiffGetPayload,
  RepoDiffGetResult,
  PaneSetUserNamePayload,
  AppConfigSetPayload,
  AppConfigChangedPayload,
  InspectorGetSummaryPayload,
  InspectorGetSummaryResult,
  InspectorAskLlmPayload,
  InspectorAskLlmResult,
  PaneListResult,
  PaneRehydrateEntry
} from '../shared/ipc-channels'
import type { CompletionPolicy, AppConfig } from '../shared/types'
import type { PaneState, SessionHistoryEntry, EffortLevel, Model } from '../shared/types'
import type { WindowManager } from './window-manager'
import type { SessionRegistry } from './session-registry'
import type { PtyPool } from './pty-pool'
import type { HookListener } from './hook-listener'
import type { PermissionsManager } from './permissions-manager'
import type { StatusDetector } from './status-detector'
import type { MetricsCollector } from './metrics-collector'
import type { PaneTransitionBuffer } from './pane-transition-buffer'
import { PaneSpawnBuffer } from './pane-spawn-buffer'
import type { WorkspaceManager } from './workspace-manager'
import type { GitStatusPoller } from './git-status-poller'
import type { CompletionExecutor } from './completion-executor'
import type { InspectorService } from './inspector'
import type { PlanApprovalSequencer } from './plan-approval-sequencer'
import { gitWorktreeRemove, ghCliAvailable, gitPushBaseBranch, getDiff } from './git-status'
import { worktreePathToRepoPath } from './repo-path'
import { readClaudeMd, writeAndCommitClaudeMd } from './repo-claude-md'
import {
  getGlobalCompletionPolicy,
  setGlobalCompletionPolicy
} from './completion-policy-store'
import {
  getAppConfig,
  setAppConfig,
  resetAppConfig
} from './app-config-store'
import { closePaneInternal } from './pane-lifecycle'
import { getSessionHistory, addSessionHistoryEntry } from './session-history-store'
import { saveWorkspace as saveHiveToStore } from './workspace-store'
import { DEFAULT_PERMISSIONS } from './constants'
import {
  getGlobalOverrides,
  setGlobalOverrides,
  getProjectOverrides,
  setProjectOverrides,
  resetGlobalOverrides,
  resetProjectOverrides,
  getProjectPaths,
  getAllKnownRules,
  resolveEffectivePermissions
} from './permissions-store'
import type {
  PermissionsGetEffectivePayload,
  PermissionsGetEffectiveResult,
  PermissionsSetScopePayload,
  PermissionsResetScopePayload,
  PermissionsDefaultsResult,
  ClaudeCheckResult,
  WorkspaceCreateWithTerminalsPayload,
  WorkspaceCreateWithTerminalsResult,
  WorkspaceResumeLastResult,
  OpenExternalPayload,
  WorkspaceRevealPathPayload,
  WorkspaceRevealPathResult
} from '../shared/ipc-channels'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write the effortLevel field to the global ~/.claude/settings.json before
 * spawning a Claude Code process, so it starts with the correct effort.
 * Claude Code reads this on startup; PTY injection is too late. (PE-03)
 */
function writeGlobalEffortLevel(effort: EffortLevel): void {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    let settings: Record<string, unknown> = {}
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    } catch {
      // File doesn't exist or is malformed — start fresh
    }
    settings.effortLevel = effort
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
  } catch (err) {
    console.error('[ipc] failed to write effortLevel to global settings:', err)
  }
}

/**
 * Read the effortLevel field from the global ~/.claude/settings.json.
 * Returns the stored value, or 'high' if the file is missing/malformed.
 */
function readGlobalEffortLevel(): EffortLevel {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    const level = settings?.effortLevel
    if (level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh' || level === 'max') return level
  } catch {
    // File doesn't exist or is malformed
  }
  return 'high'
}

/** Default Claude model when the renderer doesn't specify one. */
const DEFAULT_MODEL: Model = 'opus'

// ---------------------------------------------------------------------------
// Pending-spawn buffer — holds PTY output for a newly spawned pane until its
// XTermView mounts and registers its pane:data listener (PANE_READY). See
// pane-spawn-buffer.ts for the full rationale; this is the shared instance
// used by every PTY spawn path in this module.
// ---------------------------------------------------------------------------

const paneSpawnBuffer = new PaneSpawnBuffer()

// ---------------------------------------------------------------------------
// Claude CLI detection
// ---------------------------------------------------------------------------

/**
 * Check if the `claude` CLI is available in the system PATH.
 */
export function checkClaudeInstalled(): ClaudeCheckResult {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    execFileSync(cmd, ['claude'], { timeout: 5_000, stdio: 'pipe' })
    // Try to get version
    let version: string | undefined
    try {
      const versionOutput = execFileSync('claude', ['--version'], { timeout: 5_000, stdio: 'pipe' })
      version = versionOutput.toString().trim().split('\n')[0]
    } catch {
      // version check failed — not critical
    }
    return { found: true, version }
  } catch {
    return { found: false }
  }
}

/**
 * Ensure the parent repo has at least one commit before we try to create a
 * worktree off it.
 *
 * Why this exists: scaffolding tools like `npx create-expo-app` run `git init`
 * but never make a commit, leaving HEAD "unborn". `git worktree add -b name`
 * inherits that empty state, so the resulting worktree's branch has no
 * commits — and any tool inside it (including Claude Code's bash tool running
 * `git log`) errors with "your current branch does not have any commits yet".
 *
 * Fix: detect the unborn HEAD and create an empty initial commit. We try the
 * user's git identity first, falling back to an Claudinha placeholder if their
 * `user.name` / `user.email` aren't configured. The user can amend the commit
 * later if they want a different author or message.
 */
export function ensureRepoHasInitialCommit(repoPath: string): void {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: repoPath,
      timeout: 5_000,
      stdio: 'pipe'
    })
    return // HEAD points at a commit — nothing to do
  } catch {
    // HEAD is unborn — fall through to create an initial commit
  }

  const message = 'Initial commit (created by Claudinha)'
  try {
    execFileSync('git', ['commit', '--allow-empty', '-m', message], {
      cwd: repoPath,
      timeout: 5_000,
      stdio: 'pipe'
    })
    return
  } catch {
    // Likely missing user.name / user.email — retry with Claudinha fallbacks
  }

  execFileSync(
    'git',
    [
      '-c', 'user.email=claudinha@local',
      '-c', 'user.name=Claudinha',
      'commit', '--allow-empty', '-m', message
    ],
    { cwd: repoPath, timeout: 5_000, stdio: 'pipe' }
  )
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

/**
 * Register all main-process IPC handlers.
 *
 * Must be called once after app.whenReady(). All singletons (windowManager,
 * sessionRegistry, ptyPool) must already be initialized before calling this.
 */
export function registerIpcHandlers(
  windowManager: WindowManager,
  sessionRegistry: SessionRegistry,
  ptyPool: PtyPool,
  hookListener: HookListener,
  permissionsManager: PermissionsManager,
  statusDetector: StatusDetector,
  metricsCollector: MetricsCollector,
  transitionBuffer: PaneTransitionBuffer,
  workspaceManager: WorkspaceManager,
  gitStatusPoller: GitStatusPoller,
  completionExecutor: CompletionExecutor,
  inspector: InspectorService,
  planApprovalSequencer: PlanApprovalSequencer
): void {
  // -------------------------------------------------------------------------
  // pane:spawn — create a new Claude Code pane
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.PANE_SPAWN, (event, payload: PaneSpawnPayload): PaneSpawnResult => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow) return { error: 'No window found.' }

    const windowId = String(senderWindow.id)

    // Resolve working directory from the payload mode
    const { worktreePath, repoPath, mode } = payload

    let resolvedWorktreePath: string
    let repoName: string
    let worktreeName: string

    if (mode === 'new-worktree') {
      // Create a git worktree as a sibling of the repo directory (B-043)
      if (!repoPath) {
        return { error: 'Repository path is required.' }
      }

      // Pre-validate that the path is a git repository
      try {
        execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, timeout: 5_000 })
      } catch {
        return { error: 'Repository path is not a git repository. Initialize one with git init or choose a different path.' }
      }

      const suffix = Math.random().toString(16).slice(2, 8)
      const rawName = payload.worktreeName?.trim() || `wt-${suffix}`
      // Sanitize to a valid git branch name: replace invalid chars with hyphens
      const wtName = rawName
        .replace(/[^\w./-]/g, '-')   // replace spaces and invalid chars
        .replace(/\.{2,}/g, '-')     // no consecutive dots
        .replace(/-{2,}/g, '-')      // collapse consecutive hyphens
        .replace(/^[-.]|[-.]$/g, '') // no leading/trailing hyphens or dots
        || `wt-${suffix}`        // fallback if sanitization empties the string
      fs.mkdirSync(path.join(repoPath, '.worktrees'), { recursive: true })
      const wtPath = path.join(repoPath, '.worktrees', wtName)
      try {
        ensureRepoHasInitialCommit(repoPath)
        execFileSync('git', ['worktree', 'add', wtPath, '-b', wtName], {
          cwd: repoPath,
          timeout: 15_000
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ipc] pane:spawn: git worktree add failed', err)
        if (msg.includes('already exists')) {
          return { error: `A worktree or branch named '${wtName}' already exists. Choose a different name.` }
        }
        return { error: 'Failed to create worktree. Check that the repository path is accessible and try again.' }
      }
      resolvedWorktreePath = wtPath
      repoName = path.basename(repoPath)
      worktreeName = wtName
    } else if (mode === 'resume-session') {
      // Resume a previous Claude Code session (PE-06)
      if (!payload.sessionId) {
        return { error: 'Session ID is required for resume mode.' }
      }
      if (!worktreePath) {
        return { error: 'Working directory path is required for resume mode.' }
      }
      try {
        const stat = fs.statSync(worktreePath)
        if (!stat.isDirectory()) {
          return { error: 'The session\'s working directory is not a valid directory.' }
        }
      } catch {
        return { error: 'The session\'s working directory no longer exists.' }
      }
      resolvedWorktreePath = worktreePath
      repoName = path.basename(repoPath ?? worktreePath)
      worktreeName = path.basename(worktreePath)
    } else if (mode === 'manual-path' || mode === 'existing-worktree') {
      // worktreePath is required for these modes
      if (!worktreePath) {
        return { error: 'Working directory path is required.' }
      }
      resolvedWorktreePath = worktreePath
      repoName = path.basename(repoPath ?? worktreePath)
      worktreeName = path.basename(worktreePath)
    } else {
      return { error: `Unknown spawn mode: ${mode}` }
    }

    // Enforce workspace type constraints on the resolved path
    const workspaceForSpawn = payload.workspaceId ? workspaceManager.getWorkspace(payload.workspaceId)
      : workspaceManager.getWorkspaceForWindow(windowId)
    if (workspaceForSpawn) {
      if (workspaceForSpawn.type === 'repo' && workspaceForSpawn.constraint.repoPath) {
        // Repo workspace: resolved path must be within (or equal to) the repo directory
        const normRepo = path.resolve(workspaceForSpawn.constraint.repoPath)
        const normResolved = path.resolve(resolvedWorktreePath)
        // Allow the path to be the repo itself, a subdirectory, or a sibling worktree
        const repoParent = path.dirname(normRepo)
        if (!normResolved.startsWith(repoParent + path.sep) && normResolved !== repoParent) {
          return { error: `Path must be within the repo (${path.basename(normRepo)}) or its worktrees.` }
        }
      }
      if (workspaceForSpawn.type === 'worktree-branch' && workspaceForSpawn.constraint.worktreePath) {
        // Worktree Branch workspace: resolved path must match the worktree path
        const normConstraint = path.resolve(workspaceForSpawn.constraint.worktreePath)
        const normResolved = path.resolve(resolvedWorktreePath)
        if (normResolved !== normConstraint) {
          return { error: `This workspace is locked to worktree: ${path.basename(normConstraint)}` }
        }
      }
    }

    const paneId = sessionRegistry.generatePaneId()
    recordPtySpawnStart(paneId)

    // Write .claude/settings.json (permissions + hooks + statusline) before spawning
    permissionsManager.writeSettings(resolvedWorktreePath)
    // Pre-accept the folder trust dialog so the user isn't prompted on launch
    // (the launch form surfaces this trust as an explicit warning).
    permissionsManager.markFolderTrusted(resolvedWorktreePath)

    // Register pane with StatusDetector; pass socket failure flag (B-058)
    statusDetector.registerPane(paneId, hookListener.socketFailed)
    // Start watching statusline temp file for metrics updates
    metricsCollector.watchPane(paneId)

    // Set effort level in global settings before spawn so Claude Code starts correctly (PE-03)
    const effortLevel = payload.effort ?? 'high'
    writeGlobalEffortLevel(effortLevel)

    // Resolve model — payload override or app default. Passed via --model flag.
    const model: Model = payload.model ?? DEFAULT_MODEL

    // Build CLI args — pass --resume for resume-session mode (PE-06)
    const spawnArgs = mode === 'resume-session'
      ? ['--resume', payload.sessionId!]
      : []

    // Gate PTY output until the renderer signals PANE_READY. Protects against
    // the "first pane in a new workspace renders incompletely" race — see
    // pane-spawn-buffer.ts. Safety timeout flushes to the window if ready
    // never arrives so we don't silently lose startup output.
    paneSpawnBuffer.open(paneId, () => {
      console.warn('[ipc] pane:ready timeout — flushing without listener ack', paneId)
      const buffered = paneSpawnBuffer.flush(paneId)
      if (!buffered) return
      const pane = sessionRegistry.getPane(paneId)
      if (!pane) return
      const win = windowManager.getWindow(pane.windowId)
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC.PANE_DATA, { paneId, data: buffered } as PaneDataPayload)
    })

    const { ptyId, isApiBilling } = ptyPool.spawn({
      paneId,
      workingDirectory: resolvedWorktreePath,
      args: spawnArgs,
      model,
      extraEnv: {
        // Pane ID injected into env so Claude Code hooks can identify the pane
        CLAUDINHA_PANE_ID: paneId,
        // Socket path so Claude Code hook relay can connect to HookListener
        CLAUDINHA_SOCKET_PATH: hookListener.getSocketPath()
      },
      onData: (data: string) => {
        // Fire-once PTY spawn latency (clears itself after first call)
        recordPtyFirstData(paneId)
        // Buffer a copy if this pane is in transition (data still flows to current window)
        transitionBuffer.write(paneId, data)
        // Feed PTY data to status detector (no-op when fallback not yet active)
        statusDetector.onData(paneId, data)
        // Hold output until the XTermView's pane:data listener is live.
        if (paneSpawnBuffer.capture(paneId, data)) return
        const pane = sessionRegistry.getPane(paneId)
        if (!pane) return
        const win = windowManager.getWindow(pane.windowId)
        if (!win || win.isDestroyed()) return
        const dataPayload: PaneDataPayload = { paneId, data }
        win.webContents.send(IPC.PANE_DATA, dataPayload)
      },
      onExit: (exitCode: number, signal?: number) => {
        clearPtySpawnTracking(paneId)
        transitionBuffer.clear(paneId)
        paneSpawnBuffer.clear(paneId)
        gitStatusPoller.unwatchPane(paneId)
        statusDetector.deregisterPane(paneId)
        metricsCollector.unwatchPane(paneId)

        const pane = sessionRegistry.getPane(paneId)
        if (!pane) {
          // Already removed by pane:close — intentional kill, no further action
          return
        }

        const win = windowManager.getWindow(pane.windowId)
        const isCrash = exitCode !== 0 && !signal

        if (isCrash) {
          // Unexpected crash — keep pane in registry, mark terminated (B-052)
          // Set terminated flag in registry so close-interceptor sees correct state
          trackPtyCrashed(exitCode, pane.createdAt)
          sessionRegistry.updatePaneStatus(paneId, 'done', 'pty-fallback')
          pane.terminated = true

          if (win && !win.isDestroyed()) {
            const terminatedPayload: PaneTerminatedPayload = { paneId, exitCode }
            win.webContents.send(IPC.PANE_TERMINATED, terminatedPayload)
          }
        } else {
          // Normal exit (exitCode === 0) or killed by signal (intentional)
          // Record session for future resume (PE-06)
          if (pane.sessionId) {
            addSessionHistoryEntry({
              sessionId: pane.sessionId,
              worktreePath: pane.worktreePath,
              repoName: pane.repoName,
              worktreeName: pane.worktreeName,
              sessionTitle: pane.metrics.sessionTitle,
              completedAt: Date.now()
            })
          }
          // Record terminal in workspace's dormant list
          workspaceManager.removeDroneFromHive(pane.workspaceId, pane)
          planApprovalSequencer.onPaneClosed(paneId)
          sessionRegistry.removePane(paneId)
          if (win && !win.isDestroyed()) {
            const closedPayload: PaneClosedPayload = { paneId }
            win.webContents.send(IPC.PANE_CLOSED, closedPayload)
          }
        }
      }
    })

    const initialMetrics = {
      totalTokens: null,
      contextPercent: null,
      toolsUsed: null,
      totalCostUsd: null,
      durationMs: null,
      modelDisplayName: null,
      linesAdded: null,
      linesRemoved: null,
      sessionTitle: null
    }

    // Resolve workspaceId — use payload's workspaceId, or the window's existing workspace,
    // or auto-create a general workspace for the window (Phase 1 compatibility)
    let resolvedHiveId = payload.workspaceId
    if (!resolvedHiveId) {
      const existingHive = workspaceManager.getWorkspaceForWindow(windowId)
      if (existingHive) {
        resolvedHiveId = existingHive.id
      } else {
        const autoHive = workspaceManager.createWorkspace({
          type: 'general',
          constraint: {},
          windowId
        })
        resolvedHiveId = autoHive.id
      }
    }

    const paneState: PaneState = {
      id: paneId,
      windowId,
      workspaceId: resolvedHiveId,
      ptyId,
      sessionId: null,
      transcriptPath: null,
      contextWindowSize: null,
      repoName,
      worktreeName,
      worktreePath: resolvedWorktreePath,
      status: 'awaiting-prompt',
      activeToolName: null,
      statusChangedAt: Date.now(),
      statusSource: 'pty-fallback',
      isFocused: false,
      hasUnseenStatusChange: false,
      isApiBilling,
      effort: effortLevel,
      model,
      metrics: initialMetrics,
      createdAt: Date.now(),
      gitStatus: null,
      isWorktree: mode === 'new-worktree' || mode === 'existing-worktree',
      completionActionStatus: null
    }

    sessionRegistry.registerPane(paneState)
    gitStatusPoller.watchPane(paneId)
    workspaceManager.addDroneToHive(resolvedHiveId, paneId)
    registerPaneSpawnMode(paneId, mode)
    trackPaneSpawned(mode, sessionRegistry.getPanesForWindow(windowId).length)
    trackSpawnModeSelected(mode)

    const spawnedPayload: PaneSpawnedPayload = {
      paneId,
      repoName,
      worktreeName,
      worktreePath: resolvedWorktreePath,
      isApiBilling,
      effort: effortLevel,
      model,
      isWorktree: mode === 'new-worktree' || mode === 'existing-worktree'
    }
    event.sender.send(IPC.PANE_SPAWNED, spawnedPayload)

    // A new pane may introduce a new repo in a general workspace; refresh the title.
    workspaceManager.applyWindowTitle(windowId)
    workspaceManager.pushManagerUpdate()

    return { error: null }
  })

  // -------------------------------------------------------------------------
  // pane:close — kill PTY and remove pane
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.PANE_CLOSE, (event, payload: PaneClosePayload) => {
    const { paneId } = payload
    const closedPane = closePaneInternal(
      {
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
      },
      paneId,
      { snapshotExtras: { completionAction: 'manual-close' } }
    )
    // closePaneInternal notifies the pane's home window. If the pane was
    // already gone (closedPane === null), also notify the sender so its
    // renderer tears down any stale references.
    if (!closedPane) {
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      if (senderWindow && !senderWindow.isDestroyed()) {
        const closedPayload: PaneClosedPayload = { paneId }
        senderWindow.webContents.send(IPC.PANE_CLOSED, closedPayload)
      }
    }
  })

  // -------------------------------------------------------------------------
  // pane:close-worktree — close a pane with git/worktree operations
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.PANE_CLOSE_WORKTREE, async (_event, payload: PaneCloseWorktreePayload): Promise<PaneCloseWorktreeResult> => {
    const { paneId, action } = payload
    const pane = sessionRegistry.getPane(paneId)
    if (!pane) return { error: 'Pane not found.' }

    // Close actions never auto-commit. keep-close leaves the worktree on disk
    // including any uncommitted work (session resume picks up dirty state);
    // prune-close destroys it. The modal warns the user about prune + dirty.
    if (action === 'prune-close') {
      const pruneErr = await gitWorktreeRemove(pane.worktreePath)
      if (pruneErr) return { error: `Worktree removal failed: ${pruneErr}` }
    }

    closePaneInternal(
      {
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
      },
      paneId,
      { snapshotExtras: { completionAction: 'manual-close' } }
    )

    return { error: null }
  })

  // -------------------------------------------------------------------------
  // pane:merge-and-close — merge the worktree into its base, then close.
  // Wraps completionExecutor.executeMerge so the PaneCloseConfirmModal can
  // fire one IPC and get a unified success/error result back. On conflict or
  // dirty-main, the pane stays open and the state comes back to the caller.
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.PANE_MERGE_AND_CLOSE, async (_event, payload: PaneMergeAndClosePayload): Promise<PaneMergeAndCloseResult> => {
    const { paneId, strategy } = payload
    const pane = sessionRegistry.getPane(paneId)
    if (!pane) return { error: 'Pane not found.' }
    if (!pane.isWorktree) return { error: 'Pane is not a worktree.' }

    const mergeResult = await completionExecutor.executeMerge(paneId, strategy)
    if (mergeResult.error) {
      const errText = String(mergeResult.error)
      // CompletionExecutor surfaces state via broadcast; infer from the error
      // text so the renderer can react appropriately. The strings come from
      // completion-executor.ts (processMergeJob).
      let state: 'conflict' | 'dirty-main' | 'blocked' | undefined
      if (/conflict/i.test(errText)) state = 'conflict'
      else if (/dirty[- ]main|main.*dirty|uncommitted changes on main/i.test(errText)) state = 'dirty-main'
      else if (/queued|in progress|busy/i.test(errText)) state = 'blocked'
      return { error: errText, state }
    }

    closePaneInternal(
      {
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
      },
      paneId,
      { snapshotExtras: { completionAction: 'merged' } }
    )

    return { error: null }
  })

  // -------------------------------------------------------------------------
  // pane:respawn — restart PTY for a crashed pane (B-052)
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.PANE_RESPAWN, (event, payload: PaneRespawnPayload) => {
    const { paneId } = payload

    const pane = sessionRegistry.getPane(paneId)
    if (!pane || !pane.terminated) {
      console.warn('[ipc] pane:respawn: pane not found or not terminated', paneId)
      return
    }

    // Reset pane state in registry
    pane.terminated = false
    pane.sessionId = null
    pane.transcriptPath = null
    sessionRegistry.updatePaneStatus(paneId, 'awaiting-prompt', 'pty-fallback')

    // Write fresh .claude/settings.json before respawning
    permissionsManager.writeSettings(pane.worktreePath)
    statusDetector.registerPane(paneId, hookListener.socketFailed)
    metricsCollector.watchPane(paneId)

    // Set effort level in global settings before respawn (PE-03)
    writeGlobalEffortLevel(pane.effort ?? 'high')

    // Spawn new PTY in the same worktree, preserving the user's model choice
    // (set originally on PANE_SPAWN, possibly updated live via PANE_MODEL).
    ptyPool.spawn({
      paneId,
      workingDirectory: pane.worktreePath,
      model: pane.model ?? DEFAULT_MODEL,
      extraEnv: {
        CLAUDINHA_PANE_ID: paneId,
        CLAUDINHA_SOCKET_PATH: hookListener.getSocketPath()
      },
      onData: (data: string) => {
        transitionBuffer.write(paneId, data)
        const currentPane = sessionRegistry.getPane(paneId)
        if (!currentPane) return
        const win = windowManager.getWindow(currentPane.windowId)
        if (!win || win.isDestroyed()) return
        const dataPayload: PaneDataPayload = { paneId, data }
        win.webContents.send(IPC.PANE_DATA, dataPayload)
        statusDetector.onData(paneId, data)
      },
      onExit: (exitCode: number, signal?: number) => {
        transitionBuffer.clear(paneId)
        gitStatusPoller.unwatchPane(paneId)
        statusDetector.deregisterPane(paneId)
        metricsCollector.unwatchPane(paneId)

        const currentPane = sessionRegistry.getPane(paneId)
        if (!currentPane) return

        const win = windowManager.getWindow(currentPane.windowId)
        const isCrash = exitCode !== 0 && !signal

        if (isCrash) {
          sessionRegistry.updatePaneStatus(paneId, 'done', 'pty-fallback')
          currentPane.terminated = true
          if (win && !win.isDestroyed()) {
            const terminatedPayload: PaneTerminatedPayload = { paneId, exitCode }
            win.webContents.send(IPC.PANE_TERMINATED, terminatedPayload)
          }
        } else {
          planApprovalSequencer.onPaneClosed(paneId)
          sessionRegistry.removePane(paneId)
          if (win && !win.isDestroyed()) {
            const closedPayload: PaneClosedPayload = { paneId }
            win.webContents.send(IPC.PANE_CLOSED, closedPayload)
          }
        }
      }
    })

    // Notify renderer that the pane is active again
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (senderWindow && !senderWindow.isDestroyed()) {
      const respawnedPayload: PaneRespawnedPayload = { paneId }
      senderWindow.webContents.send(IPC.PANE_RESPAWNED, respawnedPayload)
    }
  })

  // -------------------------------------------------------------------------
  // pane:input — forward keyboard input to PTY
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.PANE_INPUT, (_event, payload: PaneInputPayload) => {
    const { paneId, data } = payload
    ptyPool.write(paneId, data)
  })

  // -------------------------------------------------------------------------
  // pane:effort — update effort level in registry (PE-03)
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.PANE_EFFORT, (_event, payload: PaneEffortPayload) => {
    const pane = sessionRegistry.getPane(payload.paneId)
    if (pane) pane.effort = payload.effort
  })

  // -------------------------------------------------------------------------
  // pane:model — update Claude model in registry. Mirrors PANE_EFFORT: the
  // renderer also sends a `/model <name>` slash command directly to the PTY
  // so the live session switches immediately. The registry write here is
  // what makes the choice survive a respawn (PANE_RESPAWN reads pane.model).
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.PANE_MODEL, (_event, payload: PaneModelPayload) => {
    const pane = sessionRegistry.getPane(payload.paneId)
    if (pane) pane.model = payload.model
  })

  // -------------------------------------------------------------------------
  // pane:set-user-name — Kanban inline rename. Renderer keeps optimistic
  // local state; this mirror lets PANE_LIST_GET responses include the
  // override so a renderer reload (Cmd+R) picks it up.
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.PANE_SET_USER_NAME, (_event, payload: PaneSetUserNamePayload) => {
    const pane = sessionRegistry.getPane(payload.paneId)
    if (!pane) return
    const trimmed = typeof payload.userName === 'string' ? payload.userName.trim() : null
    pane.userName = trimmed && trimmed.length > 0 ? trimmed.slice(0, 80) : null
  })

  // -------------------------------------------------------------------------
  // global:effort — write effort to ~/.claude/settings.json + update all panes
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.GLOBAL_EFFORT, (_event, payload: GlobalEffortPayload) => {
    writeGlobalEffortLevel(payload.effort)
    for (const [, pane] of sessionRegistry.getAllPanes()) {
      if (!pane.terminated) {
        pane.effort = payload.effort
      }
    }
  })

  // -------------------------------------------------------------------------
  // global:effort:get — read current effort level from ~/.claude/settings.json
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.GLOBAL_EFFORT_GET, () => {
    return readGlobalEffortLevel()
  })

  // -------------------------------------------------------------------------
  // pane:resize — resize PTY dimensions
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.PANE_RESIZE, (_event, payload: PaneResizePayload) => {
    const { paneId, cols, rows } = payload
    ptyPool.resize(paneId, cols, rows)
  })

  // -------------------------------------------------------------------------
  // pane:list-get — return the full pane snapshot for the caller's window.
  //
  // Used by PaneStateProvider as a mount-time seed. Two scenarios this covers:
  //   1. Normal boot: the one-shot PANE_SPAWNED events landed fine in the
  //      provider's listeners, but a seed is harmless (the reducer dedupes
  //      on paneId).
  //   2. Reload / Fast-Refresh remount: the old PANE_SPAWNED events are
  //      gone and the provider's reducer is fresh — it needs this snapshot
  //      or the window shows the empty-state while PTYs are still alive.
  // Mirrors the WORKSPACE_LIST mount-seed used by useManagerState (L-014).
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.PANE_LIST_GET, (event): PaneListResult => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { panes: [] }
    const windowId = String(win.id)
    const panes = sessionRegistry.getPanesForWindow(windowId).map((pane): PaneRehydrateEntry => ({
      paneId: pane.id,
      repoName: pane.repoName,
      worktreeName: pane.worktreeName,
      worktreePath: pane.worktreePath,
      isApiBilling: pane.isApiBilling,
      effort: pane.effort,
      model: pane.model,
      isWorktree: pane.isWorktree,
      status: pane.status,
      activeToolName: pane.activeToolName,
      statusSource: pane.statusSource,
      metrics: metricsToIpc(pane.metrics),
      terminated: pane.terminated === true,
      gitStatus: pane.gitStatus,
      completionStatus: pane.completionActionStatus,
      isResolvingConflict: pane.isResolvingConflict === true,
      userName: pane.userName ?? null,
      permissionMode: pane.permissionMode ?? 'normal'
    }))
    return { panes }
  })

  // -------------------------------------------------------------------------
  // pane:ready — XTermView has mounted; flush any buffered PTY output
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.PANE_READY, (_event, payload: PaneReadyPayload) => {
    const { paneId } = payload
    const buffered = paneSpawnBuffer.flush(paneId)
    if (buffered === null || buffered.length === 0) return
    const pane = sessionRegistry.getPane(paneId)
    if (!pane) return
    const win = windowManager.getWindow(pane.windowId)
    if (!win || win.isDestroyed()) return
    const dataPayload: PaneDataPayload = { paneId, data: buffered }
    win.webContents.send(IPC.PANE_DATA, dataPayload)
  })

  // -------------------------------------------------------------------------
  // pane:move — move pane to a different window (B-048)
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.PANE_MOVE, (_event, payload: PaneMovePayload) => {
    const { paneId, targetWindowId, serializedBuffer } = payload

    const pane = sessionRegistry.getPane(paneId)
    if (!pane) {
      console.error('[ipc] pane:move: pane not found', paneId)
      return
    }

    const sourceWindowId = pane.windowId
    const sourceWindow = windowManager.getWindow(sourceWindowId)
    const targetWindow = windowManager.getWindow(targetWindowId)

    if (!targetWindow || targetWindow.isDestroyed()) {
      console.error('[ipc] pane:move: target window not found', targetWindowId)
      return
    }

    // Buffer captures any PTY output between now and the target XTermView mounting.
    // Data also continues flowing to the source window during this brief window.
    transitionBuffer.startBuffering(paneId)

    // Move pane in SessionRegistry — updates windowId on the PaneState.
    sessionRegistry.movePane(paneId, targetWindowId)
    trackPaneMoved(
      sessionRegistry.getPanesForWindow(sourceWindowId).length,
      sessionRegistry.getPanesForWindow(targetWindowId).length
    )

    // Notify source window to remove the pane from its grid
    if (sourceWindow && !sourceWindow.isDestroyed()) {
      const closedPayload: PaneClosedPayload = { paneId }
      sourceWindow.webContents.send(IPC.PANE_CLOSED, closedPayload)
    }

    // Flush buffer and combine with serialized snapshot
    const bufferedData = transitionBuffer.flush(paneId)
    const combinedBuffer = (serializedBuffer || '') + bufferedData

    // Notify target window to adopt the pane (with full state for restoration)
    const movedInPayload: PaneMovedInPayload = {
      paneId,
      repoName: pane.repoName,
      worktreeName: pane.worktreeName,
      worktreePath: pane.worktreePath,
      isApiBilling: pane.isApiBilling,
      effort: pane.effort,
      model: pane.model,
      status: pane.status,
      activeToolName: pane.activeToolName,
      metrics: metricsToIpc(pane.metrics),
      serializedBuffer: combinedBuffer
    }
    targetWindow.webContents.send(IPC.PANE_MOVED_IN, movedInPayload)

    // Both windows' titles may need updating — their active-repo sets changed.
    workspaceManager.applyWindowTitle(sourceWindowId)
    workspaceManager.applyWindowTitle(targetWindowId)

    // Manager needs to reflect the new active-pane counts for both workspaces.
    workspaceManager.pushManagerUpdate()
  })

  // -------------------------------------------------------------------------
  // window:new — open a new BrowserWindow, optionally tearing off a pane (B-049)
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.WINDOW_NEW, (_event, payload: WindowNewPayload) => {
    // Create a new general workspace for the new window
    const newHive = workspaceManager.createWorkspace({ type: 'general', constraint: {} })
    const newWin = windowManager.createWindow()
    const newWinId = String(newWin.id)
    workspaceManager.bindWindow(newHive.id, newWinId)
    workspaceManager.applyWindowTitle(newWinId)
    workspaceManager.setPendingInit(newWinId, {
      windowType: 'workspace',
      workspaceId: newHive.id,
      workspaceName: newHive.name,
      workspaceType: newHive.type,
      workspaceConstraint: newHive.constraint,
      workspaceCompletionPolicy: newHive.completionPolicy ?? null,
      workspaceViewMode: newHive.viewMode ?? 'kanban',
      workspaceActivePaneId: newHive.activePaneId ?? null,
      globalCompletionPolicy: getGlobalCompletionPolicy()
    })
    workspaceManager.pushManagerUpdate()
    trackWindowCreated('menu', windowManager.count)
    const { paneId, serializedBuffer } = payload

    if (!paneId) return // simple new window, nothing to move

    const pane = sessionRegistry.getPane(paneId)
    if (!pane) return

    const targetWindowId = String(newWin.id)

    // Start buffering PTY data for this pane. During the transition:
    // - PTY data continues flowing to the SOURCE window (live display)
    // - A copy is captured in the buffer for replay in the target
    // The pane stays in the source window until the target renderer is ready.
    transitionBuffer.startBuffering(paneId)

    // Wait for the new window's renderer to signal that its IPC listeners are
    // registered (RENDERER_READY). Only then do we move the pane — this
    // eliminates the race between did-finish-load and React effect registration.
    const readyHandler = (readyEvent: Electron.IpcMainEvent): void => {
      const senderWin = BrowserWindow.fromWebContents(readyEvent.sender)
      if (String(senderWin?.id) !== targetWindowId) return

      // This is the ready signal from our target window — remove the listener
      ipcMain.removeListener(IPC.RENDERER_READY, readyHandler)

      if (newWin.isDestroyed()) {
        transitionBuffer.clear(paneId)
        return
      }

      const sourceWindowId = pane.windowId
      const sourceWindow = windowManager.getWindow(sourceWindowId)

      // Flush buffer and combine with the serialized visual snapshot
      const bufferedData = transitionBuffer.flush(paneId)
      const combinedBuffer = (serializedBuffer || '') + bufferedData

      // NOW move the pane — PTY data starts routing to the new window.
      sessionRegistry.movePane(paneId, targetWindowId)
      trackPaneMoved(
        sessionRegistry.getPanesForWindow(sourceWindowId).length,
        sessionRegistry.getPanesForWindow(targetWindowId).length
      )

      // Notify source window to remove the pane from its grid
      if (sourceWindow && !sourceWindow.isDestroyed()) {
        const closedPayload: PaneClosedPayload = { paneId }
        sourceWindow.webContents.send(IPC.PANE_CLOSED, closedPayload)
      }

      // Notify target window to adopt the pane (with full state for restoration)
      const movedInPayload: PaneMovedInPayload = {
        paneId,
        repoName: pane.repoName,
        worktreeName: pane.worktreeName,
        worktreePath: pane.worktreePath,
        isApiBilling: pane.isApiBilling,
        effort: pane.effort,
        model: pane.model,
        status: pane.status,
        activeToolName: pane.activeToolName,
        metrics: metricsToIpc(pane.metrics),
        serializedBuffer: combinedBuffer
      }
      newWin.webContents.send(IPC.PANE_MOVED_IN, movedInPayload)

      // Source + target titles may need updating now that pane composition changed.
      workspaceManager.applyWindowTitle(sourceWindowId)
      workspaceManager.applyWindowTitle(targetWindowId)

      // Manager needs to reflect the new active-pane counts for both workspaces.
      workspaceManager.pushManagerUpdate()
    }

    ipcMain.on(IPC.RENDERER_READY, readyHandler)

    // Bring the new window to front
    newWin.focus()
  })

  // -------------------------------------------------------------------------
  // window:list — return list of open windows for WindowPicker (B-049)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.WINDOW_LIST, (event): WindowEntry[] => {
    // The transplant picker should list OTHER workspace windows only:
    // exclude the caller's own window, exclude the manager window, and
    // exclude any unbound window (shouldn't happen in practice, but safe).
    const callerWin = BrowserWindow.fromWebContents(event.sender)
    const callerId = callerWin ? String(callerWin.id) : null
    const managerId = workspaceManager.managerWindowId
    const entries: { entry: WindowEntry; workspaceNumber: number }[] = []
    for (const [id] of windowManager.getAllWindows()) {
      if (id === callerId) continue
      if (id === managerId) continue
      const workspace = workspaceManager.getWorkspaceForWindow(id)
      if (!workspace) continue
      entries.push({
        entry: { id, label: workspaceManager.computeWorkspaceTitle(workspace.id) },
        workspaceNumber: workspace.workspaceNumber
      })
    }
    // Stable order by workspace number so the picker matches what the user sees
    // in the manager and in title bars.
    entries.sort((a, b) => a.workspaceNumber - b.workspaceNumber)
    return entries.map((e) => e.entry)
  })

  // -------------------------------------------------------------------------
  // feedback:send — open a prefilled GitHub issue for bug/feature feedback
  // -------------------------------------------------------------------------

  ipcMain.on(IPC.FEEDBACK_SEND, (_event, payload: FeedbackSendPayload) => {
    const { type, message, email } = payload
    trackFeedbackSubmitted(type, message.length)
    const title = encodeURIComponent(
      type === 'bug' ? 'Bug Report' : 'Feature Request'
    )
    const body = encodeURIComponent(
      email ? `From: ${email}\n\n${message}` : message
    )
    const labels = type === 'bug' ? 'bug' : 'enhancement'
    const url = `https://github.com/scottdflorida/claudinha/issues/new?title=${title}&body=${body}&labels=${labels}`
    shell.openExternal(url).catch((err) => {
      console.error('[ipc] feedback:send: failed to open issue URL', err)
    })
  })

  // -------------------------------------------------------------------------
  // path:validate — check that a path exists and is a directory (B-045)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.PATH_VALIDATE, (_event, payload: PathValidatePayload): PathValidateResult => {
    const { path: p } = payload
    if (!p) return { valid: false, error: 'Path is empty.' }
    try {
      const stat = fs.statSync(p)
      if (!stat.isDirectory()) {
        return { valid: false, error: 'Path is not a directory.' }
      }
      // Check if this is a git repo
      let isGitRepo = false
      try {
        execFileSync('git', ['rev-parse', '--git-dir'], { cwd: p, timeout: 5_000, stdio: 'pipe' })
        isGitRepo = true
      } catch {
        // Not a git repo — that's fine
      }
      return { valid: true, isGitRepo }
    } catch {
      return { valid: false, error: 'Path does not exist.' }
    }
  })

  // -------------------------------------------------------------------------
  // path:git-init — run `git init` in a directory so the launch flow can
  // proceed when the user picks a folder that isn't yet a repo.
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.PATH_GIT_INIT, (_event, payload: GitInitPayload): GitInitResult => {
    const { path: p } = payload
    if (!p) return { ok: false, error: 'Path is empty.' }
    try {
      const stat = fs.statSync(p)
      if (!stat.isDirectory()) {
        return { ok: false, error: 'Path is not a directory.' }
      }
    } catch {
      return { ok: false, error: 'Path does not exist.' }
    }
    try {
      execFileSync('git', ['init'], { cwd: p, timeout: 10_000, stdio: 'pipe' })
      return { ok: true }
    } catch (err) {
      // execFileSync attaches captured stderr/stdout to the thrown error
      // when stdio is 'pipe'. Surface whatever git actually said so the user
      // can see why init failed (permissions, missing parent, etc.).
      const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
      const toText = (v: Buffer | string | undefined): string =>
        Buffer.isBuffer(v) ? v.toString('utf8').trim() : (v ?? '').toString().trim()
      const detail = toText(e.stderr) || toText(e.stdout) || e.message || 'git init failed'
      return { ok: false, error: `git init failed: ${detail}` }
    }
  })

  // -------------------------------------------------------------------------
  // folder:browse — open a native folder picker and return selected path
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.FOLDER_BROWSE, async (event): Promise<string | null> => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = senderWindow
      ? await dialog.showOpenDialog(senderWindow, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // -------------------------------------------------------------------------
  // worktree:list — list git worktrees for a repository (B-044)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.WORKTREE_LIST, (_event, payload: WorktreeListPayload): WorktreeListResult => {
    const { repoPath } = payload
    if (!repoPath) return { entries: [] }

    // Pre-validate that the path exists and is a directory
    try {
      const stat = fs.statSync(repoPath)
      if (!stat.isDirectory()) {
        return { entries: [], error: 'Path is not a directory.' }
      }
    } catch {
      return { entries: [], error: 'Path does not exist.' }
    }

    // Check that the path is a git repository
    try {
      execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, timeout: 5_000 })
    } catch {
      return { entries: [], error: 'Not a git repository.' }
    }

    let output: string
    try {
      output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: repoPath,
        timeout: 10_000,
        encoding: 'utf8'
      })
    } catch (err) {
      console.error('[ipc] worktree:list: git worktree list failed', err)
      return { entries: [], error: 'Could not list worktrees.' }
    }

    // Parse porcelain output:
    //   worktree /path\nHEAD abc123\nbranch refs/heads/main\n\n...
    const entries: WorktreeEntry[] = []
    const blocks = output.trim().split(/\n\n+/)
    let isFirst = true
    for (const block of blocks) {
      const lines = block.split('\n')
      let wtPath: string | null = null
      let branch: string | null = null
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wtPath = line.slice('worktree '.length).trim()
        } else if (line.startsWith('branch ')) {
          const ref = line.slice('branch '.length).trim()
          // Strip refs/heads/ prefix
          branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
        }
      }
      if (wtPath) {
        entries.push({ path: wtPath, branch, isMain: isFirst })
        isFirst = false
      }
    }
    return { entries }
  })

  // -------------------------------------------------------------------------
  // session-history:list — return recent sessions for resume (PE-06)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.SESSION_HISTORY_LIST, () => {
    return getSessionHistory()
  })

  // -------------------------------------------------------------------------
  // Permissions management — CRUD for user permission overrides
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.PERMISSIONS_GET_DEFAULTS, (): PermissionsDefaultsResult => {
    return { allow: DEFAULT_PERMISSIONS.allow, deny: DEFAULT_PERMISSIONS.deny }
  })

  ipcMain.handle(IPC.PERMISSIONS_GET_EFFECTIVE, (_e, payload: PermissionsGetEffectivePayload): PermissionsGetEffectiveResult => {
    const overrides = payload.scope === 'project' && payload.projectPath
      ? getProjectOverrides(payload.projectPath)
      : getGlobalOverrides()

    // Compute effective permissions for display
    // For global scope, use a dummy path to get just defaults + global overrides
    // For project scope, use the project path
    const worktreePath = payload.scope === 'project' && payload.projectPath
      ? payload.projectPath
      : ''
    const effective = resolveEffectivePermissions(worktreePath)

    return {
      allow: effective.allow,
      deny: effective.deny,
      overrides
    }
  })

  ipcMain.handle(IPC.PERMISSIONS_SET_SCOPE, (_e, payload: PermissionsSetScopePayload) => {
    if (payload.scope === 'project' && payload.projectPath) {
      setProjectOverrides(payload.projectPath, payload.overrides)
    } else {
      setGlobalOverrides(payload.overrides)
    }

    // Re-write .claude/settings.json for affected active panes
    for (const [, pane] of sessionRegistry.getAllPanes()) {
      if (payload.scope === 'project' && payload.projectPath) {
        // Only re-write panes whose worktreePath is under the project path
        if (!pane.worktreePath.startsWith(payload.projectPath)) continue
      }
      permissionsManager.writeSettings(pane.worktreePath)
    }
  })

  ipcMain.handle(IPC.PERMISSIONS_RESET_SCOPE, (_e, payload: PermissionsResetScopePayload) => {
    if (payload.scope === 'project' && payload.projectPath) {
      resetProjectOverrides(payload.projectPath)
    } else {
      resetGlobalOverrides()
    }

    // Re-write .claude/settings.json for affected active panes
    for (const [, pane] of sessionRegistry.getAllPanes()) {
      if (payload.scope === 'project' && payload.projectPath) {
        if (!pane.worktreePath.startsWith(payload.projectPath)) continue
      }
      permissionsManager.writeSettings(pane.worktreePath)
    }
  })

  ipcMain.handle(IPC.PERMISSIONS_GET_PROJECT_PATHS, () => {
    return getProjectPaths()
  })

  ipcMain.handle(IPC.PERMISSIONS_GET_KNOWN_RULES, () => {
    return { rules: getAllKnownRules() }
  })

  // -------------------------------------------------------------------------
  // Workspace management IPC handlers
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.WORKSPACE_CREATE, (_event, payload: { type: string; name?: string; constraint: Record<string, unknown> }) => {
    const workspace = workspaceManager.createWorkspace({
      type: payload.type as import('../shared/types').WorkspaceType,
      name: payload.name,
      constraint: payload.constraint as import('../shared/types').WorkspaceConstraint
    })
    trackWorkspaceCreated(
      workspace.type,
      workspaceManager.getActiveWorkspaces().length + workspaceManager.getDormantWorkspaces().length
    )

    // Create a window for the new workspace
    const newWin = windowManager.createWindow()
    const winId = String(newWin.id)

    // Bind window to workspace (updates status, windowId, workspaceWindowMap, persists)
    workspaceManager.bindWindow(workspace.id, winId)
    workspaceManager.applyWindowTitle(winId)

    // Register pending init for RENDERER_READY
    workspaceManager.setPendingInit(winId, {
      windowType: 'workspace',
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceType: workspace.type,
      workspaceConstraint: workspace.constraint,
      workspaceCompletionPolicy: workspace.completionPolicy ?? null,
      workspaceViewMode: workspace.viewMode ?? 'kanban',
      workspaceActivePaneId: workspace.activePaneId ?? null,
      globalCompletionPolicy: getGlobalCompletionPolicy()
    })

    workspaceManager.pushManagerUpdate()
    trackWindowCreated('menu', windowManager.count)

    newWin.focus()
    return { error: null, workspaceId: workspace.id }
  })

  ipcMain.handle(IPC.WORKSPACE_LIST, () => {
    return workspaceManager.buildManagerState()
  })

  ipcMain.handle(IPC.WORKSPACE_GET, (_event, payload: { workspaceId: string }) => {
    const workspace = workspaceManager.getWorkspace(payload.workspaceId)
    return workspace || null
  })

  ipcMain.on(IPC.MANAGER_FOCUS_WORKSPACE, (_event, payload: { workspaceId: string }) => {
    const workspace = workspaceManager.getWorkspace(payload.workspaceId)
    if (!workspace || !workspace.windowId) return
    const win = windowManager.getWindow(workspace.windowId)
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  ipcMain.on(IPC.MANAGER_FOCUS_TERMINAL, (_event, payload: { workspaceId: string; paneId: string }) => {
    const workspace = workspaceManager.getWorkspace(payload.workspaceId)
    if (!workspace || !workspace.windowId) return
    const win = windowManager.getWindow(workspace.windowId)
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
      // TODO Phase 5: focus the specific pane in the workspace window
    }
  })

  // manager:show — focus the Claudinha Command (manager) window from any workspace window
  ipcMain.on(IPC.MANAGER_SHOW, () => {
    if (!workspaceManager.managerWindowId) return
    const win = windowManager.getWindow(workspaceManager.managerWindowId)
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  // workspace:activate — reactivate a dormant workspace, optionally resuming specific terminals
  ipcMain.handle(IPC.WORKSPACE_ACTIVATE, (_event, payload: { workspaceId: string; terminalIds?: string[] }) => {
    const result = workspaceManager.activateWorkspace(payload.workspaceId, payload.terminalIds)
    if (!result) return { error: 'Workspace not found or not dormant.' }

    // The terminalsToResume are included in the WINDOW_INIT payload (set by activateWorkspace).
    // The workspace window renderer will read them and call pane:spawn for each.
    // Update the pending init to include terminalsToResume.
    const pendingInit = workspaceManager.consumePendingInit(result.windowId)
    if (pendingInit) {
      pendingInit.terminalsToResume = result.terminalsToResume.filter((d) => d.sessionId)
      workspaceManager.setPendingInit(result.windowId, pendingInit)
    }

    workspaceManager.pushManagerUpdate()
    trackWindowCreated('activate', windowManager.count)
    return { error: null }
  })

  // workspace:deactivate — deactivate an active workspace (make it dormant)
  ipcMain.handle(IPC.WORKSPACE_DEACTIVATE, (_event, payload: { workspaceId: string }) => {
    const workspace = workspaceManager.getWorkspace(payload.workspaceId)
    if (!workspace || workspace.status !== 'active') return { error: 'Workspace not found or not active.' }

    // Kill PTYs and clean up panes
    if (workspace.windowId) {
      const panes = sessionRegistry.getPanesForWindow(workspace.windowId)
      for (const pane of panes) {
        if (pane.sessionId) {
          addSessionHistoryEntry({
            sessionId: pane.sessionId,
            worktreePath: pane.worktreePath,
            repoName: pane.repoName,
            worktreeName: pane.worktreeName,
            sessionTitle: pane.metrics.sessionTitle,
            completedAt: Date.now()
          })
        }
        statusDetector.deregisterPane(pane.id)
        metricsCollector.unwatchPane(pane.id)
        transitionBuffer.clear(pane.id)
        planApprovalSequencer.onPaneClosed(pane.id)
        sessionRegistry.removePane(pane.id)
        ptyPool.kill(pane.id)
      }
      // Close the window
      const win = windowManager.getWindow(workspace.windowId)
      if (win && !win.isDestroyed()) win.destroy()
    }

    workspaceManager.deactivateWorkspace(payload.workspaceId)
    workspaceManager.pushManagerUpdate()
    return { error: null }
  })

  // workspace:delete — permanently remove a dormant workspace
  ipcMain.handle(IPC.WORKSPACE_DELETE, (_event, payload: { workspaceId: string }) => {
    const success = workspaceManager.deleteWorkspace(payload.workspaceId)
    if (!success) return { error: 'Workspace not found or not dormant.' }
    workspaceManager.pushManagerUpdate()
    return { error: null }
  })

  // workspace:archive — move a dormant workspace into the archived state
  ipcMain.handle(IPC.WORKSPACE_ARCHIVE, (_event, payload: { workspaceId: string }) => {
    const workspaceTypeAtArchive = workspaceManager.getWorkspace(payload.workspaceId)?.type ?? 'unknown'
    const success = workspaceManager.archiveWorkspace(payload.workspaceId)
    if (!success) return { error: 'Workspace not found or not dormant.' }
    workspaceManager.pushManagerUpdate()
    trackWorkspaceArchived(workspaceTypeAtArchive, workspaceManager.getArchivedWorkspaces().length)
    return { error: null }
  })

  // workspace:unarchive — restore an archived workspace back to dormant
  ipcMain.handle(IPC.WORKSPACE_UNARCHIVE, (_event, payload: { workspaceId: string }) => {
    const workspaceTypeAtUnarchive = workspaceManager.getWorkspace(payload.workspaceId)?.type ?? 'unknown'
    const success = workspaceManager.unarchiveWorkspace(payload.workspaceId)
    if (!success) return { error: 'Workspace not found or not archived.' }
    workspaceManager.pushManagerUpdate()
    trackWorkspaceUnarchived(workspaceTypeAtUnarchive)
    return { error: null }
  })

  // workspace:delete-archived — permanently remove an archived workspace
  ipcMain.handle(IPC.WORKSPACE_DELETE_ARCHIVED, (_event, payload: { workspaceId: string }) => {
    const workspaceTypeAtDelete = workspaceManager.getWorkspace(payload.workspaceId)?.type ?? 'unknown'
    const success = workspaceManager.deleteArchivedWorkspace(payload.workspaceId)
    if (!success) return { error: 'Workspace not found or not archived.' }
    workspaceManager.pushManagerUpdate()
    trackWorkspaceDeletedArchived(workspaceTypeAtDelete)
    return { error: null }
  })

  // workspace:rename — rename a workspace
  ipcMain.handle(IPC.WORKSPACE_RENAME, (_event, payload: { workspaceId: string; name: string }) => {
    const success = workspaceManager.renameWorkspace(payload.workspaceId, payload.name)
    if (!success) return { error: 'Workspace not found.' }
    workspaceManager.pushManagerUpdate()
    return { error: null }
  })

  // workspace:set-view-mode — flip a workspace between Wall and Kanban (Kanban v1)
  ipcMain.handle(
    IPC.WORKSPACE_SET_VIEW_MODE,
    (_event, payload: WorkspaceSetViewModePayload): WorkspaceSetViewModeResult => {
      if (payload.viewMode !== 'wall' && payload.viewMode !== 'kanban') {
        return { error: 'Invalid viewMode (expected "wall" or "kanban").' }
      }
      const workspace = workspaceManager.getWorkspace(payload.workspaceId)
      if (!workspace) return { error: 'Workspace not found.' }
      workspace.viewMode = payload.viewMode
      saveHiveToStore(workspace)
      workspaceManager.pushManagerUpdate()
      return { error: null }
    }
  )

  // workspace:set-active-pane — select which pane is the active terminal in Kanban view
  ipcMain.handle(
    IPC.WORKSPACE_SET_ACTIVE_PANE,
    (_event, payload: WorkspaceSetActivePanePayload): WorkspaceSetActivePaneResult => {
      const workspace = workspaceManager.getWorkspace(payload.workspaceId)
      if (!workspace) return { error: 'Workspace not found.' }
      // Allow null (clear selection) or a pane ID belonging to this workspace.
      if (payload.paneId !== null && !workspace.activePaneIds.includes(payload.paneId)) {
        return { error: 'Pane is not active in this workspace.' }
      }
      workspace.activePaneId = payload.paneId
      saveHiveToStore(workspace)
      workspaceManager.pushManagerUpdate()
      return { error: null }
    }
  )

  // workspace:dormant-terminals — get dormant terminals for a workspace
  ipcMain.handle(IPC.WORKSPACE_PAUSED_TERMINALS, (_event, payload: { workspaceId: string }) => {
    const workspace = workspaceManager.getWorkspace(payload.workspaceId)
    if (!workspace) return { pausedTerminals: [] }
    return { pausedTerminals: workspace.pausedTerminals }
  })

  // workspace:resume-terminal — resume a specific dormant terminal in its workspace
  ipcMain.handle(IPC.WORKSPACE_RESUME_TERMINAL, (event, payload: { workspaceId: string; terminalSnapshotPaneId: string }) => {
    const workspace = workspaceManager.getWorkspace(payload.workspaceId)
    if (!workspace || workspace.status !== 'active' || !workspace.windowId) {
      return { error: 'Workspace not found or not active.' }
    }

    const terminal = workspace.pausedTerminals.find((d) => d.paneId === payload.terminalSnapshotPaneId)
    if (!terminal) return { error: 'Terminal not found in paused list.' }
    if (!terminal.sessionId) return { error: 'Terminal has no session ID — cannot resume.' }

    // The renderer will call pane:spawn with resume-session mode.
    // We just need to remove the terminal from the dormant list here
    // and let the renderer handle the actual spawn.
    // Actually, let's do the spawn here programmatically by sending
    // a spawn request back — but that's complex. Instead, return the
    // terminal data and let the renderer invoke pane:spawn itself.

    // Remove from dormant list
    workspace.pausedTerminals = workspace.pausedTerminals.filter((d) => d.paneId !== payload.terminalSnapshotPaneId)
    saveHiveToStore(workspace)

    // Push updated dormant list to the workspace window
    const win = windowManager.getWindow(workspace.windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.WORKSPACE_PAUSED_UPDATE, {
        workspaceId: workspace.id,
        pausedTerminals: workspace.pausedTerminals
      })
    }
    workspaceManager.pushManagerUpdate()

    return {
      error: null,
      terminal: {
        sessionId: terminal.sessionId,
        worktreePath: terminal.worktreePath
      }
    }
  })

  // -------------------------------------------------------------------------
  // Completion actions — merge/PR flow
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.COMPLETION_MERGE, async (_event, payload: CompletionMergePayload) => {
    return completionExecutor.executeMerge(payload.paneId, payload.strategy)
  })

  ipcMain.handle(IPC.COMPLETION_PR, async (_event, payload: CompletionPrPayload) => {
    return completionExecutor.executePr(payload.paneId, payload.draft)
  })

  ipcMain.handle(IPC.COMPLETION_ABORT, async (_event, payload: CompletionAbortPayload) => {
    return completionExecutor.abortMerge(payload.paneId)
  })

  ipcMain.handle(IPC.COMPLETION_CANCEL_QUEUE, async (_event, payload: CompletionCancelQueuePayload) => {
    return completionExecutor.cancelFromQueue(payload.paneId)
  })

  ipcMain.handle(IPC.COMPLETION_RESOLVE, async (_event, payload: CompletionResolvePayload) => {
    return completionExecutor.resolveConflictWithClaude(payload.paneId)
  })

  ipcMain.on(IPC.COMPLETION_DISMISS, (_event, payload: CompletionDismissPayload) => {
    completionExecutor.dismiss(payload.paneId)
  })

  ipcMain.on(IPC.COMPLETION_CLEAR_STATE, (_event, payload: CompletionClearStatePayload) => {
    completionExecutor.clearToReady(payload.paneId)
  })

  ipcMain.handle(IPC.GH_CLI_CHECK, async () => {
    const available = await ghCliAvailable()
    return { available }
  })

  // -------------------------------------------------------------------------
  // Completion policies (Phase 3)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.COMPLETION_POLICY_GET_GLOBAL, (): CompletionPolicy => {
    return getGlobalCompletionPolicy()
  })

  ipcMain.handle(IPC.COMPLETION_POLICY_SET_GLOBAL, (_event, payload: CompletionPolicySetGlobalPayload) => {
    setGlobalCompletionPolicy(payload.policy)
    // Broadcast to every open window so stale caches refresh.
    const broadcast: CompletionPolicyGlobalChangedPayload = { policy: payload.policy }
    for (const [, win] of windowManager.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.COMPLETION_POLICY_GLOBAL_CHANGED, broadcast)
      }
    }
    return { error: null }
  })

  ipcMain.handle(IPC.COMPLETION_POLICY_GET_WORKSPACE, (_event, payload: CompletionPolicyGetWorkspacePayload) => {
    return workspaceManager.getHiveCompletionPolicy(payload.workspaceId)
  })

  ipcMain.handle(IPC.COMPLETION_POLICY_SET_WORKSPACE, (_event, payload: CompletionPolicySetWorkspacePayload) => {
    const ok = workspaceManager.setHiveCompletionPolicy(payload.workspaceId, payload.policy)
    if (!ok) return { error: 'Workspace not found.' }
    // Broadcast to the workspace's window only. Also refresh the manager state
    // so the dormant/active workspace listings reflect the new policy.
    const workspace = workspaceManager.getWorkspace(payload.workspaceId)
    if (workspace?.windowId) {
      const win = windowManager.getWindow(workspace.windowId)
      if (win && !win.isDestroyed()) {
        const broadcast: CompletionPolicyWorkspaceChangedPayload = {
          workspaceId: payload.workspaceId,
          policy: payload.policy
        }
        win.webContents.send(IPC.COMPLETION_POLICY_WORKSPACE_CHANGED, broadcast)
      }
    }
    workspaceManager.pushManagerUpdate()
    return { error: null }
  })

  // -------------------------------------------------------------------------
  // App config — user-facing preferences surfaced through the Configuration view
  // -------------------------------------------------------------------------

  function broadcastAppConfig(config: AppConfig): void {
    const payload: AppConfigChangedPayload = { config }
    for (const [, win] of windowManager.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.APP_CONFIG_CHANGED, payload)
      }
    }
  }

  ipcMain.handle(IPC.APP_CONFIG_GET, (): AppConfig => {
    return getAppConfig()
  })

  ipcMain.handle(IPC.RATE_LIMITS_GET, () => {
    return metricsCollector.getLastRateLimits()
  })

  ipcMain.handle(IPC.APP_CONFIG_SET, (_event, payload: AppConfigSetPayload): AppConfig => {
    const previous = getAppConfig()
    const next = setAppConfig(payload ?? {})
    broadcastAppConfig(next)
    if (next.language !== previous.language) {
      // Menu labels are baked into the OS menu bar at build time. Rebuild on
      // language change so File/Edit/View/etc. switch over without a restart.
      void rebuildAppMenu()
    }
    return next
  })

  ipcMain.handle(IPC.APP_CONFIG_RESET, (): AppConfig => {
    const previous = getAppConfig()
    const next = resetAppConfig()
    broadcastAppConfig(next)
    if (next.language !== previous.language) {
      void rebuildAppMenu()
    }
    return next
  })

  async function rebuildAppMenu(): Promise<void> {
    // Lazy-imported to keep ipc-handlers' static import graph minimal and
    // avoid any chance of a circular dependency with menu.ts (which itself
    // imports from app-config-store).
    const { buildMenu } = await import('./menu')
    buildMenu(windowManager, sessionRegistry, workspaceManager)
  }

  /**
   * Collect every eligible pane in a scope (workspace or global) that should
   * receive a completion action. Eligible = done + isWorktree + has work.
   */
  function collectEligiblePanes(
    scope: 'workspace' | 'global',
    workspaceId?: string,
    repoPath?: string
  ): PaneState[] {
    const all = [...sessionRegistry.getAllPanes().values()]
    const pool = scope === 'workspace' && workspaceId
      ? all.filter((p) => p.workspaceId === workspaceId)
      : all
    return pool.filter((pane) => {
      if (pane.status !== 'done') return false
      if (!pane.isWorktree) return false
      if (pane.terminated) return false
      const git = pane.gitStatus
      if (!git) return false
      if (git.commitsAhead === 0 && !git.hasUncommittedChanges) return false
      if (git.branchName === 'main' || git.branchName === 'master') return false
      // Per-repo scope (Kanban repo rail). Mirror the inspector's grouping
      // (`worktreePathToRepoPath`) so per-row and per-repo affordances pick
      // exactly the same pane set (L-023).
      if (repoPath) {
        const groupKey = worktreePathToRepoPath(pane.worktreePath)
        if (groupKey !== repoPath) return false
      }
      return true
    })
  }

  ipcMain.handle(IPC.COMPLETION_MERGE_ALL, async (_event, payload: CompletionMergeAllPayload): Promise<CompletionMergeAllResult> => {
    const { scope, workspaceId, strategy, alsoSetPolicy, repoPath } = payload

    if (alsoSetPolicy) {
      const newPolicy: CompletionPolicy = {
        action: 'auto-merge',
        mergeStrategy: strategy,
        pruneOnMerge: false
      }
      if (scope === 'global') {
        setGlobalCompletionPolicy(newPolicy)
        const broadcast: CompletionPolicyGlobalChangedPayload = { policy: newPolicy }
        for (const [, win] of windowManager.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(IPC.COMPLETION_POLICY_GLOBAL_CHANGED, broadcast)
        }
      } else if (workspaceId) {
        workspaceManager.setHiveCompletionPolicy(workspaceId, newPolicy)
        const workspace = workspaceManager.getWorkspace(workspaceId)
        if (workspace?.windowId) {
          const win = windowManager.getWindow(workspace.windowId)
          if (win && !win.isDestroyed()) {
            const broadcast: CompletionPolicyWorkspaceChangedPayload = { workspaceId, policy: newPolicy }
            win.webContents.send(IPC.COMPLETION_POLICY_WORKSPACE_CHANGED, broadcast)
          }
        }
        workspaceManager.pushManagerUpdate()
      }
    }

    const eligible = collectEligiblePanes(scope, workspaceId, repoPath)
    let enqueued = 0
    for (const pane of eligible) {
      // Fire-and-forget — each call goes through the queue and returns a
      // promise for THAT pane's processing. We don't await here because the
      // user wants the bulk action to kick off immediately; the UI follows
      // along via COMPLETION_STATUS broadcasts.
      void completionExecutor.executeMerge(pane.id, strategy)
      enqueued++
    }
    return { error: null, enqueued }
  })

  // ---------------------------------------------------------------------
  // Kanban repo-rail bulk actions: Push and Merge + push (Phase 6)
  // ---------------------------------------------------------------------

  /**
   * repo:push-base-branch — push the base branch of a single repo to origin.
   * Resolves the actual repo root and base branch from the inspector's
   * per-group cache (populated on the same 30s cadence as pane diff stats).
   * Returns an actionable error when the cache hasn't seen this repo yet so
   * the UI can suggest waiting a moment.
   */
  ipcMain.handle(
    IPC.REPO_PUSH_BASE_BRANCH,
    async (_event, payload: RepoPushBaseBranchPayload): Promise<RepoPushBaseBranchResult> => {
      const { workspaceId, repoPath } = payload
      const workspace = workspaceManager.getWorkspace(workspaceId)
      if (!workspace) return { error: 'Workspace not found.' }

      const repoRoot = inspector.getRepoRootForGroup(repoPath)
      const baseBranch = inspector.getBaseBranchForGroup(repoPath)
      if (!repoRoot || !baseBranch) {
        return { error: 'Repo state not yet polled — try again in a moment.' }
      }

      const err = await gitPushBaseBranch(repoRoot, baseBranch)
      if (err) return { error: err }
      // The next poll will refresh `baseAheadOfOrigin`; broadcasting now keeps
      // the manager view fresh in case any aggregate count changed.
      workspaceManager.pushManagerUpdate()
      return { error: null, baseAheadOfOrigin: 0 }
    }
  )

  /**
   * repo:merge-and-push — composite Kanban action. Awaits all eligible merges
   * for the given repo (serialized by the per-repo MergeQueue) and then runs a
   * single push of the resulting base-branch commits. On any merge failure
   * (conflict / dirty-main / error) the push is skipped — partial success
   * stays visible via the per-pane completion status, and the user can retry
   * Push directly once they've resolved the failed merges.
   */
  ipcMain.handle(
    IPC.REPO_MERGE_AND_PUSH,
    async (_event, payload: RepoMergeAndPushPayload): Promise<RepoMergeAndPushResult> => {
      const { workspaceId, repoPath, strategy } = payload
      const workspace = workspaceManager.getWorkspace(workspaceId)
      if (!workspace) {
        return { error: 'Workspace not found.', enqueued: 0, mergedCount: 0, pushAttempted: false }
      }

      const eligible = collectEligiblePanes('workspace', workspaceId, repoPath)
      if (eligible.length === 0) {
        return { error: null, enqueued: 0, mergedCount: 0, pushAttempted: false }
      }

      // Await each merge. Per-repo MergeQueue serializes them so this is
      // effectively sequential in terms of git operations, but the await
      // pattern makes the success/failure aggregation clean.
      const mergeResults = await Promise.all(
        eligible.map((p) => completionExecutor.executeMerge(p.id, strategy))
      )
      const mergedCount = mergeResults.filter((r) => !r.error).length
      const allSucceeded = mergedCount === eligible.length

      let pushAttempted = false
      let pushError: string | undefined
      if (allSucceeded) {
        const repoRoot = inspector.getRepoRootForGroup(repoPath)
        const baseBranch = inspector.getBaseBranchForGroup(repoPath)
        if (repoRoot && baseBranch) {
          pushAttempted = true
          const err = await gitPushBaseBranch(repoRoot, baseBranch)
          if (err) pushError = err
        }
      }

      workspaceManager.pushManagerUpdate()
      return {
        error: null,
        enqueued: eligible.length,
        mergedCount,
        pushAttempted,
        pushError
      }
    }
  )

  /**
   * repo:approve-plans-in-sequence — start the PlanApprovalSequencer for a
   * repo. Seeds the queue from every pane currently on Claude Code's
   * plan-approval picker; each gets `2\r` (auto-accept-edits approval) and
   * the next follows when the current run ends. Panes that reach the picker
   * partway through join the queue automatically.
   */
  ipcMain.handle(
    IPC.REPO_APPROVE_PLANS_IN_SEQUENCE,
    async (
      _event,
      payload: RepoApprovePlansInSequencePayload
    ): Promise<RepoApprovePlansInSequenceResult> => {
      const { workspaceId, repoPath } = payload
      const workspace = workspaceManager.getWorkspace(workspaceId)
      if (!workspace) return { error: 'Workspace not found.', queuedCount: 0 }

      const { queuedCount } = planApprovalSequencer.start(workspaceId, repoPath, () => {
        inspector.broadcastSummary(workspaceId)
      })
      return { error: null, queuedCount }
    }
  )

  /**
   * repo:stop-plan-sequence — clear any pending approvals for a repo.
   * The currently in-flight pane is left to run to completion — we don't
   * interrupt an agent that's already mid-implementation.
   */
  ipcMain.handle(
    IPC.REPO_STOP_PLAN_SEQUENCE,
    async (
      _event,
      payload: RepoStopPlanSequencePayload
    ): Promise<RepoStopPlanSequenceResult> => {
      const { workspaceId, repoPath } = payload
      const workspace = workspaceManager.getWorkspace(workspaceId)
      if (!workspace) return { error: 'Workspace not found.' }

      planApprovalSequencer.stop(workspaceId, repoPath)
      return { error: null }
    }
  )

  /**
   * repo:retry-failed-merges — re-runs the merge for every tree in a repo
   * whose last attempt left `completionActionStatus.state === 'error'`.
   * `conflict` and `dirty-main` are intentionally excluded; those need
   * per-pane manual recovery on the CompletionActionBar.
   *
   * Clears each failed pane's completion state back to `ready` before
   * re-enqueueing so the `MergeQueue` accepts it again. Fires each merge
   * fire-and-forget (mirrors `COMPLETION_MERGE_ALL`): the per-repo queue
   * serialises them internally and each pane's progress surfaces via the
   * existing `COMPLETION_STATUS` broadcasts.
   */
  ipcMain.handle(
    IPC.REPO_RETRY_FAILED_MERGES,
    async (
      _event,
      payload: RepoRetryFailedMergesPayload
    ): Promise<RepoRetryFailedMergesResult> => {
      const { workspaceId, repoPath, strategy } = payload
      const workspace = workspaceManager.getWorkspace(workspaceId)
      if (!workspace) return { error: 'Workspace not found.', retriedCount: 0 }

      const panes = sessionRegistry.getPanesForWorkspace(workspaceId)
      const failed = panes.filter((pane) => {
        if (worktreePathToRepoPath(pane.worktreePath) !== repoPath) return false
        return pane.completionActionStatus?.state === 'error'
      })
      for (const pane of failed) {
        completionExecutor.clearToReady(pane.id)
        void completionExecutor.executeMerge(pane.id, strategy)
      }
      return { error: null, retriedCount: failed.length }
    }
  )

  /**
   * repo:claude-md-read — resolve the repo root from the inspector cache and
   * read CLAUDE.md. Returns `{ content: '', mtimeMs: 0 }` when the file
   * doesn't exist yet (first edit).
   */
  ipcMain.handle(
    IPC.REPO_CLAUDE_MD_READ,
    async (_event, payload: RepoClaudeMdReadPayload): Promise<RepoClaudeMdReadResult> => {
      const { workspaceId, repoPath } = payload
      const workspace = workspaceManager.getWorkspace(workspaceId)
      if (!workspace) return { content: '', mtimeMs: 0, error: 'Workspace not found.' }

      const repoRoot = inspector.getRepoRootForGroup(repoPath)
      if (!repoRoot) {
        return {
          content: '',
          mtimeMs: 0,
          error: 'Repo state not yet polled — try again in a moment.'
        }
      }

      try {
        const result = await readClaudeMd(repoRoot)
        return { content: result.content, mtimeMs: result.mtimeMs }
      } catch (err) {
        return {
          content: '',
          mtimeMs: 0,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  /**
   * repo:claude-md-save — write, commit on base branch, and optionally push.
   * Validates `repoPath` at the IPC boundary (L-016) — only accepts a
   * `repoPath` that the inspector has already seen for this workspace, so we
   * can't be tricked into writing outside the user's known repos.
   */
  ipcMain.handle(
    IPC.REPO_CLAUDE_MD_SAVE,
    async (_event, payload: RepoClaudeMdSavePayload): Promise<RepoClaudeMdSaveResult> => {
      const { workspaceId, repoPath, content, expectedMtimeMs, push } = payload
      const workspace = workspaceManager.getWorkspace(workspaceId)
      if (!workspace) return { error: 'Workspace not found.' }

      const repoRoot = inspector.getRepoRootForGroup(repoPath)
      if (!repoRoot) {
        return { error: 'Repo state not yet polled — try again in a moment.' }
      }

      if (typeof content !== 'string') return { error: 'Invalid content.' }
      if (typeof expectedMtimeMs !== 'number') return { error: 'Invalid mtime.' }

      return writeAndCommitClaudeMd({
        repoRoot,
        content,
        expectedMtimeMs,
        push: Boolean(push)
      })
    }
  )

  /**
   * repo:diff-get — return the worktree's diff vs its base branch. Used by the
   * Kanban diff viewer modal. Truncated to 1MB; the result flag tells the
   * renderer when content was cut.
   */
  ipcMain.handle(
    IPC.REPO_DIFF_GET,
    async (_event, payload: RepoDiffGetPayload): Promise<RepoDiffGetResult> => {
      const pane = sessionRegistry.getPane(payload.paneId)
      if (!pane) return { diff: '', truncated: false, baseBranch: null, error: 'Pane not found.' }
      const result = await getDiff(pane.worktreePath)
      return result
    }
  )

  ipcMain.handle(IPC.COMPLETION_PR_ALL, async (_event, payload: CompletionPrAllPayload): Promise<CompletionPrAllResult> => {
    const { scope, workspaceId, draft, alsoSetPolicy, repoPath } = payload

    if (alsoSetPolicy) {
      const newPolicy: CompletionPolicy = {
        action: draft ? 'auto-draft-pr' : 'auto-pr',
        mergeStrategy: 'rebase-ff',
        pruneOnMerge: false
      }
      if (scope === 'global') {
        setGlobalCompletionPolicy(newPolicy)
        const broadcast: CompletionPolicyGlobalChangedPayload = { policy: newPolicy }
        for (const [, win] of windowManager.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(IPC.COMPLETION_POLICY_GLOBAL_CHANGED, broadcast)
        }
      } else if (workspaceId) {
        workspaceManager.setHiveCompletionPolicy(workspaceId, newPolicy)
        const workspace = workspaceManager.getWorkspace(workspaceId)
        if (workspace?.windowId) {
          const win = windowManager.getWindow(workspace.windowId)
          if (win && !win.isDestroyed()) {
            const broadcast: CompletionPolicyWorkspaceChangedPayload = { workspaceId, policy: newPolicy }
            win.webContents.send(IPC.COMPLETION_POLICY_WORKSPACE_CHANGED, broadcast)
          }
        }
        workspaceManager.pushManagerUpdate()
      }
    }

    // Guard: bulk PR-all without gh CLI is a dead end.
    if (!(await ghCliAvailable())) {
      return { error: 'gh CLI is not available. Install and authenticate gh to create PRs.', enqueued: 0 }
    }

    const eligible = collectEligiblePanes(scope, workspaceId, repoPath)
    let enqueued = 0
    for (const pane of eligible) {
      void completionExecutor.executePr(pane.id, draft)
      enqueued++
    }
    return { error: null, enqueued }
  })

  // -------------------------------------------------------------------------
  // claude:check — verify claude CLI is installed
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.CLAUDE_CHECK, (): ClaudeCheckResult => {
    return checkClaudeInstalled()
  })

  // -------------------------------------------------------------------------
  // open:external — open a URL in the system browser
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.OPEN_EXTERNAL, (_event, payload: OpenExternalPayload) => {
    if (payload.url) shell.openExternal(payload.url)
  })

  // -------------------------------------------------------------------------
  // workspace:reveal-path — show a filesystem path in the OS file manager
  // -------------------------------------------------------------------------

  ipcMain.handle(
    IPC.WORKSPACE_REVEAL_PATH,
    (_event, payload: WorkspaceRevealPathPayload): WorkspaceRevealPathResult => {
      const p = payload?.path
      if (typeof p !== 'string' || p.length === 0 || !path.isAbsolute(p)) {
        return { ok: false, error: 'Invalid path.' }
      }
      shell.showItemInFolder(p)
      return { ok: true }
    }
  )

  // -------------------------------------------------------------------------
  // workspace:resume-last — resume the most recently closed workspace
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.WORKSPACE_RESUME_LAST, (): WorkspaceResumeLastResult => {
    const dormantWorkspaces = workspaceManager.getDormantWorkspaces()
    if (dormantWorkspaces.length === 0) return { error: 'No dormant workspaces to resume.' }

    // Find most recently active
    const sorted = dormantWorkspaces.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    const target = sorted[0]

    const result = workspaceManager.activateWorkspace(target.id)
    if (!result) return { error: 'Failed to activate workspace.' }

    // Include terminalsToResume in the pending init
    const pendingInit = workspaceManager.consumePendingInit(result.windowId)
    if (pendingInit) {
      pendingInit.terminalsToResume = result.terminalsToResume.filter((d) => d.sessionId)
      workspaceManager.setPendingInit(result.windowId, pendingInit)
    }

    workspaceManager.pushManagerUpdate()
    trackWindowCreated('resume-last', windowManager.count)
    return { error: null, workspaceId: target.id }
  })

  // -------------------------------------------------------------------------
  // workspace:create-with-terminals — create workspace + batch spawn terminals (onboarding)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.WORKSPACE_CREATE_WITH_TERMINALS, (event, payload: WorkspaceCreateWithTerminalsPayload): WorkspaceCreateWithTerminalsResult => {
    const { repoPath, repoPaths, terminalCount, worktreeMode, namingMode, manualNames, effort, model, viewMode, name } = payload

    if (terminalCount < 1 || terminalCount > 32) return { error: 'Terminal count must be between 1 and 32.' }

    const perTree = Array.isArray(repoPaths) && repoPaths.length > 0
    // Shared + per-repo is honored now: each terminal creates its own worktree
    // in its own repo, all sharing the same (manual or auto) branch name.
    const effectiveWorktreeMode: 'each-own' | 'shared' = worktreeMode

    // Resolve a path list: one entry per pane. In single-repo mode every pane
    // shares the same path; in per-pane mode each pane has its own.
    let treeRepoPaths: string[]
    if (perTree) {
      if (repoPaths!.length !== terminalCount) {
        return { error: `Got ${repoPaths!.length} repo path${repoPaths!.length === 1 ? '' : 's'} for ${terminalCount} pane${terminalCount === 1 ? '' : 's'}.` }
      }
      treeRepoPaths = repoPaths!.map((p) => p.trim())
      for (let i = 0; i < treeRepoPaths.length; i++) {
        const p = treeRepoPaths[i]
        if (!p) return { error: `Pane ${i + 1}: repository path is required.` }
        try {
          const stat = fs.statSync(p)
          if (!stat.isDirectory()) return { error: `Pane ${i + 1}: path is not a directory.` }
        } catch {
          return { error: `Pane ${i + 1}: path does not exist.` }
        }
        try {
          execFileSync('git', ['rev-parse', '--git-dir'], { cwd: p, timeout: 5_000, stdio: 'pipe' })
        } catch {
          return { error: `Pane ${i + 1}: path is not a git repository.` }
        }
      }
    } else {
      if (!repoPath.trim()) return { error: 'Repository path is required.' }
      try {
        const stat = fs.statSync(repoPath)
        if (!stat.isDirectory()) return { error: 'Repository path is not a directory.' }
      } catch {
        return { error: 'Repository path does not exist.' }
      }
      try {
        execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, timeout: 5_000, stdio: 'pipe' })
      } catch {
        return { error: 'Path is not a git repository. Initialize with git init or choose a different path.' }
      }
      treeRepoPaths = Array(terminalCount).fill(repoPath)
    }

    // Create the workspace. Per-pane mode spans multiple repos, so the workspace has no
    // single `repoPath` constraint — use 'general' type with a name hint.
    const trimmedName = name?.trim() || undefined
    const workspace = perTree
      ? workspaceManager.createWorkspace({
          type: 'general',
          name: trimmedName,
          constraint: {}
        })
      : workspaceManager.createWorkspace({
          type: 'repo',
          name: trimmedName,
          constraint: { repoPath }
        })

    // Apply the LaunchForm's view-mode choice (Kanban v1). Defaults to 'kanban'
    // when omitted by older payloads (workspace-manager creates with 'kanban').
    if (viewMode === 'kanban' || viewMode === 'wall') {
      workspace.viewMode = viewMode
      saveHiveToStore(workspace)
    }

    // Create a window
    const newWin = windowManager.createWindow()
    const winId = String(newWin.id)
    workspaceManager.bindWindow(workspace.id, winId)
    workspaceManager.applyWindowTitle(winId)
    workspaceManager.setPendingInit(winId, {
      windowType: 'workspace',
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceType: workspace.type,
      workspaceConstraint: workspace.constraint,
      workspaceCompletionPolicy: workspace.completionPolicy ?? null,
      workspaceViewMode: workspace.viewMode ?? 'kanban',
      workspaceActivePaneId: workspace.activePaneId ?? null,
      globalCompletionPolicy: getGlobalCompletionPolicy()
    })

    const effortLevel = effort ?? 'high'
    const droneModel: Model = model ?? DEFAULT_MODEL

    // If the repo was just `git init`'d (e.g. by a scaffolding tool, or by
    // our own [init git here] button) and has no commits yet, every worktree
    // we create would inherit an unborn HEAD and break tools like git log.
    // Create an empty initial commit so worktree branches start from something.
    for (const uniqueRepo of new Set(treeRepoPaths)) {
      try {
        ensureRepoHasInitialCommit(uniqueRepo)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[workspace:create-with-terminals] failed to seed initial commit for ${uniqueRepo}: ${msg}`)
      }
    }

    // Spawning is deferred until the new window's PaneStateProvider has
    // mounted and registered its PANE_SPAWNED listener. Without this wait
    // the events fire before the renderer is subscribed and get dropped on
    // the floor — which produced empty workspace windows with zero terminals.
    // The renderer sends RENDERER_READY twice while a workspace window boots:
    //   1. From <App> right after its WINDOW_INIT listener is registered.
    //   2. From <PaneStateProvider> after PANE_SPAWNED et al are registered.
    // We hook the second one and run the spawn loop then.
    const spawnDrones = (): void => {
      // For 'shared' mode, create one worktree and reuse its path
      let sharedWorktreePath: string | null = null

      for (let i = 0; i < terminalCount; i++) {
        try {
          const droneRepoPath = treeRepoPaths[i]
          // 6 hex chars — matches single-spawn path (line 336) for consistency.
          const droneSuffix = Math.random().toString(16).slice(2, 8)
          const autoName = `wt-${droneSuffix}`
          let spawnPayload: PaneSpawnPayload

          const sanitizeName = (raw: string, fallback: string): string =>
            raw
              .replace(/[^\w./-]/g, '-')
              .replace(/\.{2,}/g, '-')
              .replace(/-{2,}/g, '-')
              .replace(/^[-.]|[-.]$/g, '')
              || fallback

          if (effectiveWorktreeMode === 'shared') {
            if (perTree) {
              // Shared + per-repo: each terminal creates its OWN worktree in its
              // own repo, all sharing the same (manual or auto) branch name.
              // Path-sharing isn't possible across different repos, so the
              // "shared" semantic reduces to "shared branch name" here.
              const rawName = (namingMode === 'manual' && manualNames?.[0]?.trim())
                || `wt-${droneSuffix}`
              const wtName = sanitizeName(rawName, `wt-${droneSuffix}`)
              spawnPayload = {
                mode: 'new-worktree',
                repoPath: droneRepoPath,
                worktreeName: wtName,
                effort: effortLevel,
                workspaceId: workspace.id
              }
            } else if (i === 0) {
              // Same repo + shared: first terminal creates the shared worktree
              const rawName = (namingMode === 'manual' && manualNames?.[0]?.trim())
                || `wt-${droneSuffix}`
              const wtName = sanitizeName(rawName, `wt-${droneSuffix}`)
              spawnPayload = {
                mode: 'new-worktree',
                repoPath: droneRepoPath,
                worktreeName: wtName,
                effort: effortLevel,
                workspaceId: workspace.id
              }
            } else {
              // Same repo + shared: subsequent terminals reuse the shared worktree path
              spawnPayload = {
                mode: 'existing-worktree',
                repoPath: droneRepoPath,
                worktreePath: sharedWorktreePath!,
                effort: effortLevel,
                workspaceId: workspace.id
              }
            }
          } else {
            // each-own mode: each terminal gets its own worktree
            const rawName = (namingMode === 'manual' && manualNames?.[i]?.trim())
              || autoName
            const wtName = sanitizeName(rawName, autoName)
            spawnPayload = {
              mode: 'new-worktree',
              repoPath: droneRepoPath,
              worktreeName: wtName,
              effort: effortLevel,
              workspaceId: workspace.id
            }
          }

          // Resolve working directory (mirrors pane:spawn logic)
          let resolvedWorktreePath: string
          let repoName: string
          let worktreeName: string

          if (spawnPayload.mode === 'new-worktree') {
            const wtName = spawnPayload.worktreeName!
            fs.mkdirSync(path.join(droneRepoPath, '.worktrees'), { recursive: true })
            const wtPath = path.join(droneRepoPath, '.worktrees', wtName)
            execFileSync('git', ['worktree', 'add', wtPath, '-b', wtName], {
              cwd: droneRepoPath,
              timeout: 15_000,
              stdio: 'pipe'
            })
            resolvedWorktreePath = wtPath
            repoName = path.basename(droneRepoPath)
            worktreeName = wtName

            // Record shared path for subsequent terminals
            if (effectiveWorktreeMode === 'shared' && i === 0) {
              sharedWorktreePath = wtPath
            }
          } else {
            resolvedWorktreePath = spawnPayload.worktreePath!
            repoName = path.basename(droneRepoPath)
            worktreeName = path.basename(resolvedWorktreePath)
          }

          // Spawn the PTY
          const paneId = sessionRegistry.generatePaneId()
          recordPtySpawnStart(paneId)
          permissionsManager.writeSettings(resolvedWorktreePath)
          // Pre-accept the folder trust dialog (see PermissionsManager).
          permissionsManager.markFolderTrusted(resolvedWorktreePath)
          statusDetector.registerPane(paneId, hookListener.socketFailed)
          metricsCollector.watchPane(paneId)
          writeGlobalEffortLevel(effortLevel)

          // Gate output until the XTermView mounts its pane:data listener.
          // This is the critical fix for the "first pane in a new workspace
          // renders incompletely" race — see pane-spawn-buffer.ts.
          paneSpawnBuffer.open(paneId, () => {
            console.warn('[ipc] pane:ready timeout — flushing without listener ack', paneId)
            const buffered = paneSpawnBuffer.flush(paneId)
            if (!buffered) return
            const pane = sessionRegistry.getPane(paneId)
            if (!pane) return
            const win = windowManager.getWindow(pane.windowId)
            if (!win || win.isDestroyed()) return
            win.webContents.send(IPC.PANE_DATA, { paneId, data: buffered } as PaneDataPayload)
          })

          const { ptyId, isApiBilling } = ptyPool.spawn({
            paneId,
            workingDirectory: resolvedWorktreePath,
            args: [],
            model: droneModel,
            extraEnv: {
              CLAUDINHA_PANE_ID: paneId,
              CLAUDINHA_SOCKET_PATH: hookListener.getSocketPath()
            },
            onData: (data: string) => {
              recordPtyFirstData(paneId)
              transitionBuffer.write(paneId, data)
              statusDetector.onData(paneId, data)
              if (paneSpawnBuffer.capture(paneId, data)) return
              const pane = sessionRegistry.getPane(paneId)
              if (!pane) return
              const win = windowManager.getWindow(pane.windowId)
              if (!win || win.isDestroyed()) return
              const dataPayload: PaneDataPayload = { paneId, data }
              win.webContents.send(IPC.PANE_DATA, dataPayload)
            },
            onExit: (exitCode: number, signal?: number) => {
              clearPtySpawnTracking(paneId)
              transitionBuffer.clear(paneId)
              paneSpawnBuffer.clear(paneId)
              gitStatusPoller.unwatchPane(paneId)
              statusDetector.deregisterPane(paneId)
              metricsCollector.unwatchPane(paneId)

              const pane = sessionRegistry.getPane(paneId)
              if (!pane) return

              const win = windowManager.getWindow(pane.windowId)
              const isCrash = exitCode !== 0 && !signal

              if (isCrash) {
                trackPtyCrashed(exitCode, pane.createdAt)
                sessionRegistry.updatePaneStatus(paneId, 'done', 'pty-fallback')
                pane.terminated = true
                if (win && !win.isDestroyed()) {
                  const terminatedPayload: PaneTerminatedPayload = { paneId, exitCode }
                  win.webContents.send(IPC.PANE_TERMINATED, terminatedPayload)
                }
              } else {
                if (pane.sessionId) {
                  addSessionHistoryEntry({
                    sessionId: pane.sessionId,
                    worktreePath: pane.worktreePath,
                    repoName: pane.repoName,
                    worktreeName: pane.worktreeName,
                    sessionTitle: pane.metrics.sessionTitle,
                    completedAt: Date.now()
                  })
                }
                workspaceManager.removeDroneFromHive(pane.workspaceId, pane)
                planApprovalSequencer.onPaneClosed(paneId)
                sessionRegistry.removePane(paneId)
                if (win && !win.isDestroyed()) {
                  const closedPayload: PaneClosedPayload = { paneId }
                  win.webContents.send(IPC.PANE_CLOSED, closedPayload)
                }
              }
            }
          })

          const initialMetrics = {
            totalTokens: null, contextPercent: null, toolsUsed: null,
            totalCostUsd: null, durationMs: null, modelDisplayName: null,
            linesAdded: null, linesRemoved: null, sessionTitle: null
          }

          const paneState: PaneState = {
            id: paneId, windowId: winId, workspaceId: workspace.id, ptyId,
            sessionId: null, transcriptPath: null, contextWindowSize: null,
            repoName, worktreeName, worktreePath: resolvedWorktreePath,
            status: 'awaiting-prompt', activeToolName: null,
            statusChangedAt: Date.now(), statusSource: 'pty-fallback',
            isFocused: false, hasUnseenStatusChange: false, isApiBilling,
            effort: effortLevel, model: droneModel, metrics: initialMetrics,
            createdAt: Date.now(),
            gitStatus: null, isWorktree: spawnPayload.mode === 'new-worktree',
            completionActionStatus: null
          }

          sessionRegistry.registerPane(paneState)
          gitStatusPoller.watchPane(paneId)
          workspaceManager.addDroneToHive(workspace.id, paneId)
          registerPaneSpawnMode(paneId, spawnPayload.mode)
          trackPaneSpawned(spawnPayload.mode, sessionRegistry.getPanesForWindow(winId).length)

          // Send pane:spawned to the new window — by the time spawnDrones()
          // runs, the renderer's PaneStateProvider has subscribed.
          const spawnedPayload: PaneSpawnedPayload = {
            paneId, repoName, worktreeName, worktreePath: resolvedWorktreePath,
            isApiBilling, effort: effortLevel, model: droneModel,
            isWorktree: spawnPayload.mode === 'new-worktree'
          }
          if (!newWin.isDestroyed()) {
            newWin.webContents.send(IPC.PANE_SPAWNED, spawnedPayload)
          }

        } catch (err) {
          // Loud failure log so missing terminals aren't a silent mystery. The
          // user has no in-window error UI for batch spawn yet — see the
          // launch flow notes for context.
          console.error(
            `[workspace:create-with-terminals] Terminal ${i + 1}/${terminalCount} failed to spawn:`,
            err
          )
        }
      }

      // All terminals spawned — reflect their repos in the window title.
      workspaceManager.applyWindowTitle(winId)
      workspaceManager.pushManagerUpdate()
    }

    let readyCount = 0
    const onRendererReady = (e: Electron.IpcMainEvent): void => {
      const w = BrowserWindow.fromWebContents(e.sender)
      if (!w || String(w.id) !== winId) return
      readyCount++
      // The 2nd ready signal comes from PaneStateProvider — listeners are
      // live by then. Earlier signals come from <App> before WindowShell
      // mounts, so spawning then would race the listener.
      if (readyCount >= 2) {
        ipcMain.removeListener(IPC.RENDERER_READY, onRendererReady)
        spawnDrones()
      }
    }
    ipcMain.on(IPC.RENDERER_READY, onRendererReady)
    newWin.once('closed', () => {
      ipcMain.removeListener(IPC.RENDERER_READY, onRendererReady)
    })

    trackWindowCreated('batch-spawn', windowManager.count)
    newWin.focus()

    return {
      error: null,
      workspaceId: workspace.id
    }
  })

  // -------------------------------------------------------------------------
  // workspace-keeper:get-summary — pull current summary for a workspace
  // -------------------------------------------------------------------------
  ipcMain.handle(
    IPC.INSPECTOR_GET_SUMMARY,
    (_event, payload: InspectorGetSummaryPayload): InspectorGetSummaryResult => {
      const summary = inspector.getSummary(payload.workspaceId)
      return { summary }
    }
  )

  // -------------------------------------------------------------------------
  // workspace-keeper:ask-llm — one-shot natural-language report via `claude -p`
  // -------------------------------------------------------------------------
  ipcMain.handle(
    IPC.INSPECTOR_ASK_LLM,
    async (_event, payload: InspectorAskLlmPayload): Promise<InspectorAskLlmResult> => {
      const report = await inspector.askKeeperLLM(payload.workspaceId)
      return { report }
    }
  )

  // -------------------------------------------------------------------------
  // analytics:track-shortcut — renderer-originated keyboard-shortcut usage
  // signal. Payload is just the symbolic action name (e.g. "new_pane") — never
  // a key sequence. Validated against a small enum to keep the catalog honest
  // if the renderer ever sends an unknown value.
  // -------------------------------------------------------------------------
  const ALLOWED_SHORTCUT_ACTIONS: ReadonlySet<string> = new Set([
    'new_pane',
    'new_window',
    'close_pane',
    'focus_next',
    'focus_prev',
    'focus_by_number',
    'move_pane',
    'show_manager',
    'feedback',
    'global_effort',
    'open_merge_menu',
    'open_pr_menu',
    'toggle_view_mode'
  ])
  ipcMain.on(IPC.ANALYTICS_TRACK_SHORTCUT, (_event, payload: { action?: unknown }) => {
    const action = typeof payload?.action === 'string' ? payload.action : null
    if (!action) return
    if (!ALLOWED_SHORTCUT_ACTIONS.has(action)) return
    trackKeyboardShortcutUsed(action)
  })
}
