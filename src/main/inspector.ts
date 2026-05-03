import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { IPC } from '../shared/ipc-channels'
import type { InspectorSummaryPayload } from '../shared/ipc-channels'
import type {
  WorkspaceSummary,
  InspectorReport,
  PaneState,
  ReadyPaneEntry,
  RepoRollup,
  TestHint
} from '../shared/types'
import type { SessionRegistry } from './session-registry'
import type { WorkspaceManager } from './workspace-manager'
import type { WindowManager } from './window-manager'
import type { MetricsCollector } from './metrics-collector'
import { worktreePathToRepoPath, repoNameFromWorktreePath } from './repo-path'
import {
  isClaudinhaInfrastructurePath,
  getMainRepoPath,
  detectMainBranch,
  getBaseBranchAhead
} from './git-status'
import { resolvePaneDisplayName } from '../shared/pane-display'
import { isPaneAwaitingPlanApproval } from './plan-approval-sequencer'

const execFileAsync = promisify(execFile)

/** Timeout for auxiliary git commands run inside the keeper (ms). */
const GIT_TIMEOUT = 5_000

/** Timeout for the Claude subprocess (ms). */
const LLM_TIMEOUT = 60_000

/** Max diff lines included per pane in the LLM prompt. Keeps tokens bounded. */
const MAX_DIFF_LINES_PER_TREE = 200

/**
 * Per-pane cache populated on each poll. Holds the file list (for heuristic
 * hints) alongside the unified diff stats vs the merge base. "Unified"
 * means: committed + uncommitted, measured with `git diff --numstat <base>`
 * so the Keeper can treat "what would land if we merged now" as one number.
 */
interface PaneDiffCache {
  files: string[]
  filesTouched: number
  linesAdded: number
  linesRemoved: number
  updatedAt: number
}

const EMPTY_CACHE: PaneDiffCache = {
  files: [],
  filesTouched: 0,
  linesAdded: 0,
  linesRemoved: 0,
  updatedAt: 0
}

/**
 * Per-repo cache of base-branch state. Keyed by the same `groupKey` we use
 * for `RepoRollup` (parent dir of a worktree). TTL'd at the same 30s cadence
 * as the pane git-status poller so the Push button enable predicate stays in
 * sync with diff stats without spamming git on every poll.
 */
interface BaseBranchCache {
  /** Resolved actual main repo working tree (via `git rev-parse`). */
  repoRoot: string
  /** Either 'main' or 'master' depending on what the repo uses. */
  baseBranch: string
  /** Commits the base branch is ahead of `origin/<base>`; null = unknown. */
  baseAheadOfOrigin: number | null
  updatedAt: number
}

/** TTL for base-branch cache entries (matches the pane poller cadence). */
const BASE_BRANCH_CACHE_TTL_MS = 30_000

/**
 * InspectorService — aggregates cross-pane state for a workspace, emits heuristic
 * test hints, and answers on-demand LLM report requests. Runs in the main
 * process and broadcasts summaries to each workspace's pane window via
 * `IPC.INSPECTOR_SUMMARY` whenever any input has changed.
 *
 * Hooked in from the git-status poller via `onPanePolled(paneId)` — there is
 * no separate polling loop.
 *
 * **Terminology note.** The Keeper does not surface the committed /
 * uncommitted distinction. Claudinha's merge flow auto-commits before merging
 * (see completion-executor.ts:330), so from the user's point of view any
 * pane whose diff vs main is non-empty is "ready to land." The single source
 * of truth is `git diff --numstat <base>`, which covers both.
 */
export class InspectorService {
  private readonly diffCache = new Map<string, PaneDiffCache>()
  private readonly lastBroadcast = new Map<string, string>()
  private readonly packageScriptCache = new Map<string, boolean>()
  private readonly inFlightLlm = new Map<string, Promise<InspectorReport>>()
  /** Per-repo base-branch state (commits ahead of origin). Keyed by groupKey. */
  private readonly baseBranchCache = new Map<string, BaseBranchCache>()
  /**
   * Set post-construction by index.ts to break the Inspector↔Metrics circular
   * dep. When the diff cache for a pane changes, we notify metricsCollector so
   * it re-emits PANE_METRICS — that's how the per-pane card's +A/−B chip stays
   * in sync with the repo rail (single source of truth = this.diffCache).
   */
  private metricsCollector: MetricsCollector | null = null

  /**
   * Injected getter so the RepoRollup can carry the PlanApprovalSequencer's
   * "running" flag without pulling the whole sequencer into the inspector's
   * constructor graph. Set post-construction by index.ts.
   */
  private planSequencerIsRunning: ((workspaceId: string, repoPath: string) => boolean) | null =
    null

  constructor(
    private readonly sessionRegistry: SessionRegistry,
    private readonly workspaceManager: WorkspaceManager,
    private readonly windowManager: WindowManager
  ) {}

  /**
   * Wire the MetricsCollector after construction (see constructor comment).
   * Called from index.ts alongside the other bidirectional references.
   */
  setMetricsCollector(metricsCollector: MetricsCollector): void {
    this.metricsCollector = metricsCollector
  }

  /**
   * Wire the PlanApprovalSequencer's `isRunning` getter after construction.
   * Keeps the inspector's constructor dep list stable.
   */
  setPlanSequencerGetter(fn: (workspaceId: string, repoPath: string) => boolean): void {
    this.planSequencerIsRunning = fn
  }

  /**
   * Recompute the workspace summary and broadcast if the signature has
   * changed. Public wrapper around `computeAndBroadcast` for callers like
   * the hook-listener (when a pane flips into/out of `ExitPlanMode`) and
   * the PlanApprovalSequencer (when its running state changes). Does NOT
   * run git — use `onPanePolled` for that path.
   */
  broadcastSummary(workspaceId: string): void {
    void this.computeAndBroadcast(workspaceId)
  }

  /**
   * Return the cached per-pane diff stats (files + lines added/removed vs
   * merge base), or null if the cache hasn't been populated yet. Used by
   * MetricsCollector so the Kanban card's +A/−B chip and the repo-rail row
   * both read from the same git-computed source (L-032).
   */
  getDiffStats(paneId: string): { filesTouched: number; linesAdded: number; linesRemoved: number } | null {
    const cache = this.diffCache.get(paneId)
    if (!cache) return null
    return {
      filesTouched: cache.filesTouched,
      linesAdded: cache.linesAdded,
      linesRemoved: cache.linesRemoved
    }
  }

  /**
   * Called by the git-status poller after it has written an updated GitStatus
   * for a pane. Recomputes the owning workspace's summary and broadcasts if the
   * serialized shape has changed vs the last broadcast.
   */
  async onPanePolled(paneId: string): Promise<void> {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return
    await this.refreshPaneDiff(pane)
    // Refresh per-repo base-branch state (commits ahead of origin) on the same
    // cadence as the pane diff poll. Kept TTL'd inside refreshBaseBranchAhead
    // so multi-pane workspaces don't fire redundant git calls.
    const allPanes = this.sessionRegistry.getPanesForWorkspace(pane.workspaceId)
    await this.refreshBaseBranchAhead(allPanes)
    await this.computeAndBroadcast(pane.workspaceId)
  }

  /**
   * Synchronous pull used by the IPC handler. Reads the latest PaneState +
   * cached diff stats; does NOT re-shell to git. The broadcast path runs git
   * on the poll interval so this stays snappy for drawer-open.
   */
  getSummary(workspaceId: string): WorkspaceSummary | null {
    const workspace = this.workspaceManager.getWorkspace(workspaceId)
    if (!workspace) return null
    const panes = this.sessionRegistry.getPanesForWorkspace(workspaceId)
    return this.buildSummary(workspaceId, panes)
  }

  /** Remove any cached state for a pane that's been closed. */
  forgetPane(paneId: string): void {
    this.diffCache.delete(paneId)
  }

  /**
   * Ask Claude for a natural-language summary + test plan for the current
   * state of a workspace. Never throws; returns `{ error }` on subprocess failure.
   *
   * Guards against concurrent requests per workspace: a second call while one is
   * in-flight awaits the same promise rather than spawning a second process.
   */
  async askKeeperLLM(workspaceId: string): Promise<InspectorReport> {
    const existing = this.inFlightLlm.get(workspaceId)
    if (existing) return existing

    const work = this.doAskKeeperLLM(workspaceId)
    this.inFlightLlm.set(workspaceId, work)
    try {
      return await work
    } finally {
      this.inFlightLlm.delete(workspaceId)
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async computeAndBroadcast(workspaceId: string): Promise<void> {
    const workspace = this.workspaceManager.getWorkspace(workspaceId)
    if (!workspace || !workspace.windowId) return
    const panes = this.sessionRegistry.getPanesForWorkspace(workspaceId)
    const summary = this.buildSummary(workspaceId, panes)

    const signature = this.summarySignature(summary)
    if (this.lastBroadcast.get(workspaceId) === signature) return
    this.lastBroadcast.set(workspaceId, signature)

    const win = this.windowManager.getWindow(workspace.windowId)
    if (!win || win.isDestroyed()) return
    const payload: InspectorSummaryPayload = summary
    win.webContents.send(IPC.INSPECTOR_SUMMARY, payload)
  }

  /**
   * Build a WorkspaceSummary from the current PaneStates + cached diff stats.
   * Pure function over the inputs — used by both broadcast and get-summary.
   */
  buildSummary(workspaceId: string, panes: PaneState[]): WorkspaceSummary {
    const entries: ReadyPaneEntry[] = panes.map((pane) => this.buildTreeEntry(pane))
    const repos = this.buildRepoRollup(workspaceId, entries)
    const testHints = this.buildTestHints(panes)

    return {
      workspaceId,
      generatedAt: Date.now(),
      totalPanes: entries.length,
      totalFilesTouched: entries.reduce((sum, t) => sum + t.filesTouched, 0),
      totalLinesAdded: entries.reduce((sum, t) => sum + t.linesAdded, 0),
      totalLinesRemoved: entries.reduce((sum, t) => sum + t.linesRemoved, 0),
      readyCount: entries.filter((t) => t.isReadyToMerge).length,
      repos,
      panes: entries,
      testHints
    }
  }

  private buildTreeEntry(pane: PaneState): ReadyPaneEntry {
    const gitStatus = pane.gitStatus
    const completionState = pane.completionActionStatus?.state ?? null
    const branch = gitStatus?.branchName ?? null
    const onBaseBranch = branch === 'main' || branch === 'master'
    const cache = this.diffCache.get(pane.id) ?? EMPTY_CACHE

    // Ready to merge ⇔ Claude is done, the pane is a worktree that isn't
    // sitting on main/master, there is something to land (any diff vs base,
    // committed or not), and no merge/PR action is currently in flight.
    // L-023: this must match the per-pane Merge button's eligibility in
    // completion-executor.evaluateCompletion.
    const isReadyToMerge =
      pane.status === 'changes-ready' &&
      pane.isWorktree &&
      !onBaseBranch &&
      cache.filesTouched > 0 &&
      (completionState === null || completionState === 'ready' || completionState === 'dirty-main')

    return {
      paneId: pane.id,
      // Same fallback chain as the Kanban card's `resolvePaneDisplayName` —
      // userName → sessionTitle → worktreeName — so the repo-rail row and the
      // Kanban card always show the same label for a pane.
      paneName: resolvePaneDisplayName(pane),
      repoPath: this.normaliseRepoPath(pane.worktreePath),
      // Repair legacy panes whose persisted repoName was set from a poisoned
      // `<repoRoot>/.worktrees` repoPath before L-042's follow-up fix. Derive
      // the display name from the worktreePath so the parent repo's basename
      // is shown in the Kanban card, repo rail, and pane header.
      repoName: pane.repoName === '.worktrees'
        ? repoNameFromWorktreePath(pane.worktreePath)
        : pane.repoName,
      branchName: branch,
      filesTouched: cache.filesTouched,
      linesAdded: cache.linesAdded,
      linesRemoved: cache.linesRemoved,
      paneStatus: pane.status,
      isReadyToMerge,
      completionState,
      isAwaitingPlanApproval: isPaneAwaitingPlanApproval(pane),
      lastActivityAt: pane.statusChangedAt || pane.createdAt
    }
  }

  private normaliseRepoPath(worktreePath: string): string {
    return worktreePathToRepoPath(worktreePath)
  }

  /**
   * Refresh the per-repo base-branch ahead-of-origin cache. Called from
   * onPanePolled on the same 30s cadence as pane diff stats. Cheap because
   * it's TTL-gated per group and only runs git read-only commands
   * (`rev-parse`, `rev-list`) which don't hold index.lock (L-029 safe).
   *
   * Resolves the actual main repo working tree once per group (cached),
   * detects the base branch ('main' or 'master'), then counts commits ahead
   * of `origin/<base>`. `null` means "we don't know" — Push button stays
   * disabled.
   */
  private async refreshBaseBranchAhead(panes: PaneState[]): Promise<void> {
    if (panes.length === 0) return
    const now = Date.now()
    // Group panes by their rollup key, keeping one sample pane per group so we
    // can resolve the actual repo root.
    const samplePerGroup = new Map<string, PaneState>()
    for (const pane of panes) {
      if (!pane.isWorktree) continue
      const groupKey = this.normaliseRepoPath(pane.worktreePath)
      if (!samplePerGroup.has(groupKey)) samplePerGroup.set(groupKey, pane)
    }
    await Promise.all(
      Array.from(samplePerGroup.entries()).map(async ([groupKey, samplePane]) => {
        const cached = this.baseBranchCache.get(groupKey)
        if (cached && now - cached.updatedAt < BASE_BRANCH_CACHE_TTL_MS) return
        // Resolve repo root + base branch lazily; both are stable per group.
        let repoRoot = cached?.repoRoot
        let baseBranch = cached?.baseBranch
        if (!repoRoot) {
          repoRoot = (await getMainRepoPath(samplePane.worktreePath)) ?? undefined
          if (!repoRoot) return
        }
        if (!baseBranch) {
          baseBranch = (await detectMainBranch(repoRoot)) ?? undefined
          if (!baseBranch) return
        }
        const ahead = await getBaseBranchAhead(repoRoot, baseBranch)
        this.baseBranchCache.set(groupKey, {
          repoRoot,
          baseBranch,
          baseAheadOfOrigin: ahead,
          updatedAt: now
        })
      })
    )
  }

  /**
   * Resolve the actual main repo working tree for a group key (the per-rollup
   * `repoPath`). Returns null if the cache doesn't have it yet — call
   * `refreshBaseBranchAhead` first if the value is critical for the caller.
   */
  getRepoRootForGroup(groupKey: string): string | null {
    return this.baseBranchCache.get(groupKey)?.repoRoot ?? null
  }

  /**
   * Resolve the base branch name ('main' | 'master') for a group key. Returns
   * null if not yet cached.
   */
  getBaseBranchForGroup(groupKey: string): string | null {
    return this.baseBranchCache.get(groupKey)?.baseBranch ?? null
  }

  private buildRepoRollup(workspaceId: string, panes: ReadyPaneEntry[]): RepoRollup[] {
    const byRepo = new Map<string, RepoRollup>()
    for (const pane of panes) {
      const existing = byRepo.get(pane.repoPath)
      if (existing) {
        existing.paneCount += 1
        existing.totalFilesTouched += pane.filesTouched
        existing.totalLinesAdded += pane.linesAdded
        existing.totalLinesRemoved += pane.linesRemoved
        if (pane.isReadyToMerge) existing.readyCount += 1
        if (pane.isAwaitingPlanApproval) existing.awaitingPlanApprovalCount += 1
        if (pane.completionState === 'error') existing.erroredCount += 1
      } else {
        const baseCache = this.baseBranchCache.get(pane.repoPath)
        const sequencerRunning = this.planSequencerIsRunning?.(workspaceId, pane.repoPath) ?? false
        byRepo.set(pane.repoPath, {
          repoPath: pane.repoPath,
          repoLabel: pane.repoName,
          paneCount: 1,
          totalFilesTouched: pane.filesTouched,
          totalLinesAdded: pane.linesAdded,
          totalLinesRemoved: pane.linesRemoved,
          readyCount: pane.isReadyToMerge ? 1 : 0,
          awaitingPlanApprovalCount: pane.isAwaitingPlanApproval ? 1 : 0,
          planSequencerRunning: sequencerRunning,
          erroredCount: pane.completionState === 'error' ? 1 : 0,
          baseAheadOfOrigin: baseCache?.baseAheadOfOrigin ?? null
        })
      }
    }
    return [...byRepo.values()].sort((a, b) => a.repoLabel.localeCompare(b.repoLabel))
  }

  /**
   * Heuristic test hints. Intentionally small — richer suggestions come from
   * the LLM path. Uses cached file lists (populated on each poll) so a
   * transient git read failure doesn't empty the list instantly.
   */
  buildTestHints(panes: PaneState[]): TestHint[] {
    const hints: TestHint[] = []
    const seenPackageScripts = new Set<string>()

    for (const pane of panes) {
      const cache = this.diffCache.get(pane.id)
      const files = cache?.files ?? []

      for (const file of files) {
        if (isTestFilePath(file)) {
          hints.push({
            kind: 'changed-test-file',
            label: `${pane.worktreeName}: ${file}`,
            repoPath: this.normaliseRepoPath(pane.worktreePath),
            sourcePaneId: pane.id
          })
          continue
        }
        const adjacent = findAdjacentTestFile(pane.worktreePath, file)
        if (adjacent) {
          hints.push({
            kind: 'adjacent-test-file',
            label: `${pane.worktreeName}: ${adjacent}`,
            repoPath: this.normaliseRepoPath(pane.worktreePath),
            sourcePaneId: pane.id
          })
        }
      }

      const repoPath = this.normaliseRepoPath(pane.worktreePath)
      if (!seenPackageScripts.has(repoPath) && this.hasPackageTestScript(pane.worktreePath)) {
        hints.push({
          kind: 'package-script',
          label: `${pane.repoName}: npm test`,
          command: 'npm test',
          repoPath,
          sourcePaneId: pane.id
        })
        seenPackageScripts.add(repoPath)
      }
    }
    return hints
  }

  private hasPackageTestScript(worktreePath: string): boolean {
    if (this.packageScriptCache.has(worktreePath)) {
      return this.packageScriptCache.get(worktreePath) as boolean
    }
    try {
      const pkgPath = path.join(worktreePath, 'package.json')
      if (!fs.existsSync(pkgPath)) {
        this.packageScriptCache.set(worktreePath, false)
        return false
      }
      const raw = fs.readFileSync(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
      const has = Boolean(pkg.scripts && typeof pkg.scripts.test === 'string' && pkg.scripts.test.length > 0)
      this.packageScriptCache.set(worktreePath, has)
      return has
    } catch {
      this.packageScriptCache.set(worktreePath, false)
      return false
    }
  }

  /**
   * Refresh the cached diff stats for a single pane. Best-effort: on any git
   * failure we keep the last known cache (L-029 — read-only git commands can
   * contend with writes; don't zero out the cache on transient contention).
   *
   * Combines two git calls to cover both states a pane can be in:
   *  - `git diff --numstat <base>` — changes to TRACKED files (committed +
   *    staged + unstaged modifications vs the merge base).
   *  - `git ls-files --others --exclude-standard` — UNTRACKED new files that
   *    `git diff` doesn't see. Without this, a fresh file Claude writes
   *    without running `git add` is invisible to the Keeper even though
   *    it's counted by the per-pane "Done · N modified" header.
   *
   * Untracked file line counts come from reading each file directly (capped
   * at 1MB/file so a huge artifact can't freeze the poller).
   */
  private async refreshPaneDiff(pane: PaneState): Promise<void> {
    const base = await pickMergeBase(pane.worktreePath)
    if (!base) {
      this.diffCache.set(pane.id, { ...EMPTY_CACHE, updatedAt: Date.now() })
      return
    }

    try {
      const [numstatResult, untrackedResult] = await Promise.all([
        execFileAsync(
          'git',
          ['diff', '--numstat', base],
          { cwd: pane.worktreePath, timeout: GIT_TIMEOUT, maxBuffer: 1024 * 1024 }
        ),
        execFileAsync(
          'git',
          ['ls-files', '--others', '--exclude-standard'],
          { cwd: pane.worktreePath, timeout: GIT_TIMEOUT, maxBuffer: 1024 * 1024 }
        )
      ])

      const tracked = parseNumstat(numstatResult.stdout)
      const untracked = untrackedResult.stdout
        .split('\n')
        .filter((f) => f.length > 0 && !isClaudinhaInfrastructurePath(f))

      const untrackedLines = countUntrackedLines(pane.worktreePath, untracked)

      const files = [...tracked.files]
      for (const u of untracked) {
        if (!files.includes(u)) files.push(u)
      }

      const prev = this.diffCache.get(pane.id)
      const nextLinesAdded = tracked.linesAdded + untrackedLines
      const nextLinesRemoved = tracked.linesRemoved
      const nextFilesTouched = files.length
      this.diffCache.set(pane.id, {
        files,
        filesTouched: nextFilesTouched,
        linesAdded: nextLinesAdded,
        linesRemoved: nextLinesRemoved,
        updatedAt: Date.now()
      })
      // Notify the MetricsCollector so the per-pane Kanban card + overlay
      // refresh their +A/−B chip to match the repo rail. Skip if nothing
      // actually changed to avoid spurious IPC traffic.
      const changed =
        !prev ||
        prev.linesAdded !== nextLinesAdded ||
        prev.linesRemoved !== nextLinesRemoved ||
        prev.filesTouched !== nextFilesTouched
      if (changed) {
        this.metricsCollector?.reemitWithInspectorDiff(pane.id)
      }
    } catch {
      // Transient contention — keep last known cache.
    }
  }

  private summarySignature(summary: WorkspaceSummary): string {
    // Excludes `generatedAt` and `testHints`. Broadcast is gated on
    // semantically meaningful changes (pane state, diff counts, ready flags,
    // and per-repo base-branch ahead-of-origin so the Push button enable
    // state stays in sync with the rail).
    return JSON.stringify({
      totalPanes: summary.totalPanes,
      totalFilesTouched: summary.totalFilesTouched,
      totalLinesAdded: summary.totalLinesAdded,
      totalLinesRemoved: summary.totalLinesRemoved,
      readyCount: summary.readyCount,
      repos: summary.repos.map((r) => ({
        rp: r.repoPath,
        rc: r.readyCount,
        bao: r.baseAheadOfOrigin ?? null
      })),
      panes: summary.panes.map((t) => ({
        id: t.paneId,
        ft: t.filesTouched,
        la: t.linesAdded,
        lr: t.linesRemoved,
        ps: t.paneStatus,
        rm: t.isReadyToMerge,
        cs: t.completionState
      }))
    })
  }

  private async doAskKeeperLLM(workspaceId: string): Promise<InspectorReport> {
    const workspace = this.workspaceManager.getWorkspace(workspaceId)
    if (!workspace) {
      return { workspaceId, generatedAt: Date.now(), markdown: '', error: 'Workspace not found.' }
    }
    const panes = this.sessionRegistry.getPanesForWorkspace(workspaceId)
    if (panes.length === 0) {
      return {
        workspaceId,
        generatedAt: Date.now(),
        markdown: '_This workspace has no active panes._'
      }
    }

    let prompt: string
    try {
      prompt = await this.buildLlmPrompt(workspace.name, panes)
    } catch (err) {
      return {
        workspaceId,
        generatedAt: Date.now(),
        markdown: '',
        error: err instanceof Error ? err.message : String(err)
      }
    }

    try {
      const { stdout } = await execFileAsync(
        'claude',
        ['-p', prompt],
        { timeout: LLM_TIMEOUT, maxBuffer: 4 * 1024 * 1024 }
      )
      return { workspaceId, generatedAt: Date.now(), markdown: stdout.trim() }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { workspaceId, generatedAt: Date.now(), markdown: '', error: msg }
    }
  }

  /**
   * Build the on-demand LLM prompt. Key framing choices:
   *
   *  - No mention of "committed" or "uncommitted." In Claudinha the merge flow
   *    auto-commits before merging, so that distinction is plumbing the user
   *    shouldn't see in a Keeper report.
   *  - Includes real diff content (capped per pane) so the Keeper can
   *    describe WHAT each pane changed, not just metadata. Previous revisions
   *    only passed `git diff --stat`, which left the LLM nothing substantive
   *    to say and it fell back to git-textbook advice.
   *  - States the end goal explicitly: the user is going to merge this work
   *    into main shortly; the report should help them decide whether each
   *    pane is fit to land and what to run to validate the combined result.
   */
  private async buildLlmPrompt(displayName: string, panes: PaneState[]): Promise<string> {
    const header = [
      `You are the Inspector for a Claudinha workspace named "${displayName}".`,
      ``,
      `Context you need to use (and not second-guess):`,
      `- Each "pane" below is an independent worktree where a Claude Code session has been doing work in parallel.`,
      `- The user's end goal is to merge the ready panes into main with one click. Claudinha's merge flow auto-commits any working-pane edits before merging, so you do NOT need to talk about committing as a separate step — a pane is simply "ready to land" when it has a non-empty diff vs main and Claude is done.`,
      `- Do NOT dwell on the committed/uncommitted distinction; it is not meaningful in this product.`,
      ``,
      `Produce a brief markdown report in exactly this shape:`,
      ``,
      `## What each pane changed`,
      `- One bullet per pane describing, in plain language, what the diff actually accomplishes (not file counts or line counts — describe the substance).`,
      ``,
      `## Combined picture`,
      `- 1–2 bullets on how the panes relate: independent topics, overlapping files, complementary pieces, etc.`,
      ``,
      `## Tests to run before merging`,
      `- Concrete, targeted test commands or test names that exercise the combined changes. If a repo test script exists (npm test / pytest / etc.), mention it. Prefer the smallest test set that covers the work.`,
      ``,
      `## Risks or gaps (omit if empty)`,
      `- Only include this section if you see something worth flagging (same file edited by two panes, half-finished work, suspicious patterns).`,
      ``,
      `---`
    ].join('\n')

    const treeSections: string[] = []
    for (const pane of panes) {
      const cache = this.diffCache.get(pane.id)
      if (!cache || cache.filesTouched === 0) continue

      const sectionLines: string[] = []
      sectionLines.push(`### Pane: ${pane.worktreeName}`)
      sectionLines.push(`- repo: ${pane.repoName}`)
      sectionLines.push(`- branch: ${pane.gitStatus?.branchName ?? '(unknown)'}`)
      sectionLines.push(`- files changed: ${cache.filesTouched}, +${cache.linesAdded} / -${cache.linesRemoved}`)

      const diff = await this.getDiffContent(pane.worktreePath)
      if (diff) {
        sectionLines.push('')
        sectionLines.push('```diff')
        sectionLines.push(diff)
        sectionLines.push('```')
      }
      treeSections.push(sectionLines.join('\n'))
    }

    if (treeSections.length === 0) {
      throw new Error('No panes with changes to summarise.')
    }

    return `${header}\n\n${treeSections.join('\n\n')}`
  }

  private async getDiffContent(worktreePath: string): Promise<string | null> {
    const base = await pickMergeBase(worktreePath)
    if (!base) return null
    try {
      const [trackedDiff, untrackedResult] = await Promise.all([
        execFileAsync(
          'git',
          ['diff', '--no-color', base],
          { cwd: worktreePath, timeout: GIT_TIMEOUT, maxBuffer: 4 * 1024 * 1024 }
        ),
        execFileAsync(
          'git',
          ['ls-files', '--others', '--exclude-standard'],
          { cwd: worktreePath, timeout: GIT_TIMEOUT, maxBuffer: 1024 * 1024 }
        )
      ])

      const untracked = untrackedResult.stdout
        .split('\n')
        .filter((f) => f.length > 0 && !isClaudinhaInfrastructurePath(f))

      // Append untracked files as synthetic new-file diff sections so the LLM
      // sees them as part of "what would land." Without this, a pane whose
      // only changes are new untracked files would give the Keeper a blank
      // diff and it would have nothing substantive to describe.
      const synthetic = buildUntrackedDiffSections(worktreePath, untracked)

      let combined = trackedDiff.stdout.trim()
      if (synthetic) combined = combined ? `${combined}\n${synthetic}` : synthetic
      if (!combined) return null

      const lines = combined.split('\n')
      if (lines.length <= MAX_DIFF_LINES_PER_TREE) return combined
      return [
        ...lines.slice(0, MAX_DIFF_LINES_PER_TREE),
        `... (${lines.length - MAX_DIFF_LINES_PER_TREE} more lines omitted)`
      ].join('\n')
    } catch {
      return null
    }
  }
}

/**
 * Resolve the commit SHA to diff against for "what would land if we merged
 * this pane into main." This is the **merge-base** between HEAD and
 * main/master, NOT the tip of main.
 *
 * Why merge-base and not the branch tip: after a sibling pane merges, main
 * moves forward with commits this pane doesn't have. Diffing against the
 * updated main tip would show those sibling commits as *deletions* from this
 * pane's perspective ("main has horses.md, I don't → looks like I deleted
 * it"). The merge-base is this pane's divergence point — diffing against it
 * shows only the commits this pane has added, which is the correct "what
 * this pane contributes" answer.
 *
 * Matches the `main` → `master` fallback used elsewhere. Returns null if
 * neither base branch exists or there is no common ancestor (e.g., orphan
 * histories).
 */
async function pickMergeBase(worktreePath: string): Promise<string | null> {
  for (const branch of ['main', 'master']) {
    try {
      await execFileAsync(
        'git',
        ['rev-parse', '--verify', branch],
        { cwd: worktreePath, timeout: GIT_TIMEOUT }
      )
    } catch {
      continue
    }
    try {
      const result = await execFileAsync(
        'git',
        ['merge-base', 'HEAD', branch],
        { cwd: worktreePath, timeout: GIT_TIMEOUT }
      )
      const sha = result.stdout.trim()
      if (sha.length > 0) return sha
    } catch {
      // merge-base failed (orphan history). Try the next branch.
    }
  }
  return null
}

/** Max bytes we will read per untracked file when counting its lines. */
const UNTRACKED_FILE_READ_LIMIT = 1024 * 1024

/**
 * Read each untracked file and sum its line counts. Silently skips files we
 * can't read (binary blobs, permission errors) and anything over 1MB so a
 * huge artifact can't freeze the poller. Called from `refreshPaneDiff` as
 * part of the tracked + untracked merge.
 */
export function countUntrackedLines(worktreePath: string, files: string[]): number {
  let total = 0
  for (const file of files) {
    const abs = path.join(worktreePath, file)
    try {
      const stat = fs.statSync(abs)
      if (!stat.isFile() || stat.size > UNTRACKED_FILE_READ_LIMIT) continue
      const content = fs.readFileSync(abs, 'utf-8')
      if (content.length === 0) continue
      const newlines = (content.match(/\n/g) ?? []).length
      total += newlines + (content.endsWith('\n') ? 0 : 1)
    } catch {
      // binary, permission error, or vanished — skip.
    }
  }
  return total
}

/**
 * Synthesise unified-diff blocks for untracked files so the LLM prompt sees
 * their contents the same way it sees tracked changes. Each section looks
 * like:
 *
 *   diff --git a/<file> b/<file>
 *   new file
 *   --- /dev/null
 *   +++ b/<file>
 *   +<line 1>
 *   +<line 2>
 *
 * Files over 64KB are listed with a placeholder instead of dumping contents.
 */
export function buildUntrackedDiffSections(worktreePath: string, files: string[]): string {
  const sections: string[] = []
  for (const file of files) {
    const abs = path.join(worktreePath, file)
    try {
      const stat = fs.statSync(abs)
      if (!stat.isFile()) continue
      if (stat.size > 64 * 1024) {
        sections.push(
          [
            `diff --git a/${file} b/${file}`,
            `new file (${stat.size} bytes — contents omitted)`
          ].join('\n')
        )
        continue
      }
      const content = fs.readFileSync(abs, 'utf-8')
      const contentLines = content.length > 0 ? content.split('\n') : []
      const body = contentLines.map((line) => `+${line}`).join('\n')
      sections.push(
        [
          `diff --git a/${file} b/${file}`,
          `new file`,
          `--- /dev/null`,
          `+++ b/${file}`,
          body
        ].join('\n')
      )
    } catch {
      // skip unreadable files (binary, vanished)
    }
  }
  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// Parsers + heuristic helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Parse `git diff --numstat` output. Each line is tab-separated:
 *   `<added>\t<removed>\t<path>`
 * with `-` in the numeric columns for binary files (which we count toward
 * `filesTouched` but not `linesAdded` / `linesRemoved`).
 *
 * Claudinha's own `.claude/` directory is filtered out so our own writes to
 * per-worktree settings never show up as user work.
 */
export function parseNumstat(output: string): {
  files: string[]
  filesTouched: number
  linesAdded: number
  linesRemoved: number
} {
  const files: string[] = []
  let linesAdded = 0
  let linesRemoved = 0
  for (const line of output.split('\n')) {
    if (line.length === 0) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [added, removed, ...pathParts] = parts
    const file = pathParts.join('\t')
    if (file.startsWith('.claude/') || file === '.claude') continue
    files.push(file)
    if (added !== '-') linesAdded += parseInt(added, 10) || 0
    if (removed !== '-') linesRemoved += parseInt(removed, 10) || 0
  }
  return { files, filesTouched: files.length, linesAdded, linesRemoved }
}

export function isTestFilePath(file: string): boolean {
  return (
    /(^|\/)tests?\//.test(file) ||
    /(^|\/)__tests__\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /\.test\.py$/.test(file)
  )
}

export function findAdjacentTestFile(worktreePath: string, changedFile: string): string | null {
  const match = changedFile.match(/^(.*?)([^/]+)\.([cm]?[jt]sx?)$/)
  if (!match) return null
  const [, dir, base, ext] = match
  const candidates = [
    `${dir}${base}.test.${ext}`,
    `${dir}${base}.spec.${ext}`,
    `${dir}__tests__/${base}.${ext}`
  ]
  for (const candidate of candidates) {
    const abs = path.join(worktreePath, candidate)
    try {
      if (fs.existsSync(abs)) return candidate
    } catch {
      // ignore
    }
  }
  return null
}
