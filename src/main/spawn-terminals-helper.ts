/**
 * spawn-terminals-helper — shared batch-spawn loop for putting N terminals
 * into a workspace's BrowserWindow.
 *
 * Extracted from the inline `spawnDrones` closure inside the
 * WORKSPACE_CREATE_WITH_TERMINALS handler so the same logic powers
 * WORKSPACE_ADD_TERMINALS (add-to-existing-workspace) without duplication.
 *
 * Per L-026, each spawned terminal owns its own PaneSpawnBuffer entry — the
 * helper opens one buffer per pane and never reuses a parent-level signal.
 *
 * What this helper does NOT do (and why):
 *   - Window/workspace creation, pendingInit, and RENDERER_READY waits — those
 *     belong to WORKSPACE_CREATE_WITH_TERMINALS, which is the only path that
 *     spawns a fresh window. Add-to-existing always has a live window.
 *   - WORKSPACE_INITIAL_SPAWN_BEGIN / _COMPLETE overlay events — only the
 *     initial-launch path mounts the covering overlay; adding to an open
 *     workspace lets terminals trickle in over the existing UI.
 *   - Active-pane assignment + workspace.applyWindowTitle / pushManagerUpdate
 *     — caller handles these, since add-vs-create want different behavior.
 */

import path from 'path'
import fs from 'fs'
import { execFileSync } from 'child_process'
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  PaneSpawnPayload,
  PaneDataPayload,
  PaneSpawnedPayload,
  PaneClosedPayload,
  PaneTerminatedPayload
} from '../shared/ipc-channels'
import type { PaneState, EffortLevel, Model } from '../shared/types'
import { addSessionHistoryEntry } from './session-history-store'
import { repoNameFromWorktreePath, normaliseRepoPath } from './repo-path'
import {
  trackPaneSpawned
} from './analytics/usage-instrumentation'
import { registerPaneSpawnMode } from './analytics/session-instrumentation'
import {
  recordPtySpawnStart,
  recordPtyFirstData,
  clearPtySpawnTracking
} from './analytics/performance-instrumentation'
import { trackPtyCrashed } from './analytics/error-instrumentation'
import type { WindowManager } from './window-manager'
import type { SessionRegistry } from './session-registry'
import type { PtyPool } from './pty-pool'
import type { HookListener } from './hook-listener'
import type { PermissionsManager } from './permissions-manager'
import type { StatusDetector } from './status-detector'
import type { MetricsCollector } from './metrics-collector'
import type { PaneTransitionBuffer } from './pane-transition-buffer'
import type { GitStatusPoller } from './git-status-poller'
import { ensureClaudinhaPathsIgnored } from './git-status'
import type { PaneSpawnBuffer } from './pane-spawn-buffer'
import type { WorkspaceManager } from './workspace-manager'
import type { PlanApprovalSequencer } from './plan-approval-sequencer'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SpawnTerminalsParams {
  workspaceId: string
  windowId: string
  /** The BrowserWindow to dispatch PANE_SPAWNED into. Required so the renderer's
   *  PaneStateProvider receives the new panes. */
  win: BrowserWindow
  /** One repo path per terminal (length must equal terminalCount). Single-repo
   *  mode passes the same path repeated; per-pane mode passes distinct paths. */
  treeRepoPaths: string[]
  terminalCount: number
  worktreeMode: 'each-own' | 'shared'
  namingMode: 'auto' | 'manual'
  manualNames?: string[]
  effortLevel: EffortLevel
  model: Model
  /** True iff the renderer requested per-pane repo paths. Affects how 'shared'
   *  collapses (across-repo shared can't share a directory; only the branch name). */
  perTree: boolean
}

export interface SpawnTerminalsDeps {
  windowManager: WindowManager
  sessionRegistry: SessionRegistry
  ptyPool: PtyPool
  hookListener: HookListener
  permissionsManager: PermissionsManager
  statusDetector: StatusDetector
  metricsCollector: MetricsCollector
  transitionBuffer: PaneTransitionBuffer
  gitStatusPoller: GitStatusPoller
  paneSpawnBuffer: PaneSpawnBuffer
  workspaceManager: WorkspaceManager
  planApprovalSequencer: PlanApprovalSequencer
  /** Caller-provided side effect that writes ~/.claude/settings.json with the
   *  given effort level. Passed in so we don't duplicate the helper. */
  writeGlobalEffortLevel: (effort: EffortLevel) => void
}

export interface SpawnTerminalsResult {
  /** ID of the most recently successfully spawned pane, or null if every spawn
   *  failed. WORKSPACE_CREATE_WITH_TERMINALS uses this to set the active pane. */
  lastSpawnedPaneId: string | null
  /** Per-terminal spawn errors. Non-fatal — partial-success is allowed and the
   *  successfully-spawned panes remain registered. */
  terminalErrors: string[]
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const sanitizeBranchName = (raw: string, fallback: string): string =>
  raw
    .replace(/[^\w./-]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]|[-.]$/g, '')
    || fallback

export function spawnTerminalsIntoWorkspace(
  params: SpawnTerminalsParams,
  deps: SpawnTerminalsDeps
): SpawnTerminalsResult {
  const {
    workspaceId,
    windowId,
    win,
    treeRepoPaths,
    terminalCount,
    worktreeMode,
    namingMode,
    manualNames,
    effortLevel,
    model,
    perTree
  } = params

  const {
    windowManager,
    sessionRegistry,
    ptyPool,
    hookListener,
    permissionsManager,
    statusDetector,
    metricsCollector,
    transitionBuffer,
    gitStatusPoller,
    paneSpawnBuffer,
    workspaceManager,
    planApprovalSequencer,
    writeGlobalEffortLevel
  } = deps

  let lastSpawnedPaneId: string | null = null
  const terminalErrors: string[] = []

  // For 'shared' mode, the first terminal creates the worktree and subsequent
  // terminals reuse the path. Cross-repo 'shared' can't share a path; the
  // semantic reduces to "same branch name in each repo".
  let sharedWorktreePath: string | null = null

  for (let i = 0; i < terminalCount; i++) {
    try {
      // Strip a trailing `.worktrees` off so drone worktrees don't nest and
      // their panes don't carry `.worktrees` as the display repo name (L-042).
      const droneRepoPath = normaliseRepoPath(treeRepoPaths[i])
      const droneSuffix = Math.random().toString(16).slice(2, 8)
      const autoName = `wt-${droneSuffix}`
      let spawnPayload: PaneSpawnPayload

      if (worktreeMode === 'shared') {
        if (perTree) {
          // Shared + per-repo: each terminal creates its OWN worktree in its
          // own repo, all sharing the same (manual or auto) branch name.
          const rawName = (namingMode === 'manual' && manualNames?.[0]?.trim())
            || `wt-${droneSuffix}`
          const wtName = sanitizeBranchName(rawName, `wt-${droneSuffix}`)
          spawnPayload = {
            mode: 'new-worktree',
            repoPath: droneRepoPath,
            worktreeName: wtName,
            effort: effortLevel,
            workspaceId
          }
        } else if (i === 0) {
          // Same repo + shared: first terminal creates the shared worktree
          const rawName = (namingMode === 'manual' && manualNames?.[0]?.trim())
            || `wt-${droneSuffix}`
          const wtName = sanitizeBranchName(rawName, `wt-${droneSuffix}`)
          spawnPayload = {
            mode: 'new-worktree',
            repoPath: droneRepoPath,
            worktreeName: wtName,
            effort: effortLevel,
            workspaceId
          }
        } else {
          // Same repo + shared: subsequent terminals reuse the shared path
          spawnPayload = {
            mode: 'existing-worktree',
            repoPath: droneRepoPath,
            worktreePath: sharedWorktreePath!,
            effort: effortLevel,
            workspaceId
          }
        }
      } else {
        // each-own mode: each terminal gets its own worktree
        const rawName = (namingMode === 'manual' && manualNames?.[i]?.trim())
          || autoName
        const wtName = sanitizeBranchName(rawName, autoName)
        spawnPayload = {
          mode: 'new-worktree',
          repoPath: droneRepoPath,
          worktreeName: wtName,
          effort: effortLevel,
          workspaceId
        }
      }

      // Resolve working directory (mirrors pane:spawn logic)
      let resolvedWorktreePath: string
      let repoName: string
      let worktreeName: string

      if (spawnPayload.mode === 'new-worktree') {
        const wtName = spawnPayload.worktreeName!
        ensureClaudinhaPathsIgnored(droneRepoPath)
        fs.mkdirSync(path.join(droneRepoPath, '.worktrees'), { recursive: true })
        const wtPath = path.join(droneRepoPath, '.worktrees', wtName)
        execFileSync('git', ['worktree', 'add', wtPath, '-b', wtName], {
          cwd: droneRepoPath,
          timeout: 15_000,
          stdio: 'pipe'
        })
        resolvedWorktreePath = wtPath
        repoName = repoNameFromWorktreePath(wtPath)
        worktreeName = wtName

        // Record shared path for subsequent terminals
        if (worktreeMode === 'shared' && !perTree && i === 0) {
          sharedWorktreePath = wtPath
        }
      } else {
        resolvedWorktreePath = spawnPayload.worktreePath!
        repoName = repoNameFromWorktreePath(resolvedWorktreePath)
        worktreeName = path.basename(resolvedWorktreePath)
      }

      // Spawn the PTY
      const paneId = sessionRegistry.generatePaneId()
      recordPtySpawnStart(paneId)
      permissionsManager.writeSettings(resolvedWorktreePath)
      permissionsManager.markFolderTrusted(resolvedWorktreePath)
      statusDetector.registerPane(paneId, hookListener.socketFailed)
      metricsCollector.watchPane(paneId)
      writeGlobalEffortLevel(effortLevel)

      // Per-pane gate (L-026) — flush on PANE_READY or after a safety timeout.
      paneSpawnBuffer.open(paneId, () => {
        console.warn('[spawn-terminals-helper] pane:ready timeout — flushing without listener ack', paneId)
        const buffered = paneSpawnBuffer.flush(paneId)
        if (!buffered) return
        const pane = sessionRegistry.getPane(paneId)
        if (!pane) return
        const w = windowManager.getWindow(pane.windowId)
        if (!w || w.isDestroyed()) return
        w.webContents.send(IPC.PANE_DATA, { paneId, data: buffered } as PaneDataPayload)
      })

      const { ptyId, isApiBilling } = ptyPool.prepareSpawn({
        paneId,
        workingDirectory: resolvedWorktreePath,
        args: [],
        model,
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
          const w = windowManager.getWindow(pane.windowId)
          if (!w || w.isDestroyed()) return
          const dataPayload: PaneDataPayload = { paneId, data }
          w.webContents.send(IPC.PANE_DATA, dataPayload)
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

          const w = windowManager.getWindow(pane.windowId)
          const isCrash = exitCode !== 0 && !signal

          if (isCrash) {
            trackPtyCrashed(exitCode, pane.createdAt)
            sessionRegistry.updatePaneStatus(paneId, 'needs-input', 'pty-fallback')
            pane.terminated = true
            if (w && !w.isDestroyed()) {
              const terminatedPayload: PaneTerminatedPayload = { paneId, exitCode }
              w.webContents.send(IPC.PANE_TERMINATED, terminatedPayload)
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
            if (w && !w.isDestroyed()) {
              const closedPayload: PaneClosedPayload = { paneId }
              w.webContents.send(IPC.PANE_CLOSED, closedPayload)
            }
          }
        }
      })

      const initialMetrics = {
        totalTokens: null, contextPercent: null, toolsUsed: null,
        totalCostUsd: null, durationMs: null, modelDisplayName: null,
        linesAdded: null, linesRemoved: null, sessionTitle: null,
        agentName: null, initialPrompt: null
      }

      const paneState: PaneState = {
        id: paneId, windowId, workspaceId, ptyId,
        sessionId: null, transcriptPath: null, contextWindowSize: null,
        repoName, worktreeName, worktreePath: resolvedWorktreePath,
        status: 'awaiting-prompt', activeToolName: null,
        statusChangedAt: Date.now(), statusSource: 'pty-fallback',
        isFocused: false, hasUnseenStatusChange: false, isApiBilling,
        effort: effortLevel, model, metrics: initialMetrics,
        createdAt: Date.now(),
        gitStatus: null, isWorktree: spawnPayload.mode === 'new-worktree',
        completionActionStatus: null
      }

      sessionRegistry.registerPane(paneState)
      gitStatusPoller.watchPane(paneId)
      workspaceManager.addDroneToHive(workspaceId, paneId)
      registerPaneSpawnMode(paneId, spawnPayload.mode)
      trackPaneSpawned(spawnPayload.mode, sessionRegistry.getPanesForWindow(windowId).length)

      // Notify the renderer
      const spawnedPayload: PaneSpawnedPayload = {
        paneId, repoName, worktreeName, worktreePath: resolvedWorktreePath,
        isApiBilling, effort: effortLevel, model,
        isWorktree: spawnPayload.mode === 'new-worktree'
      }
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.PANE_SPAWNED, spawnedPayload)
      }
      lastSpawnedPaneId = paneId

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[spawn-terminals-helper] Terminal ${i + 1}/${terminalCount} failed to spawn:`,
        err
      )
      terminalErrors.push(`Terminal ${i + 1}: ${msg}`)
    }
  }

  return { lastSpawnedPaneId, terminalErrors }
}
