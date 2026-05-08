/**
 * IPC channel name constants and typed payload definitions.
 *
 * All communication between main and renderer processes uses these channels.
 * Main process is the source of truth for PTY state, session state, and status.
 * Renderer process owns visual layout, focus state, and UI interactions.
 *
 * NOTE: IPC payloads must be JSON-serializable (no Map, no Set, no undefined —
 * use null instead). PaneMetrics.toolsUsed is represented as Record<string,number>
 * in IPC payloads (ToolUsageSummaryRecord), even though in-memory it is a Map.
 */

import type { PaneStatus, PaneMetrics, EffortLevel, Model, PermissionOverrides, WorkspaceType, WorkspaceConstraint, TerminalSnapshot, RendererWorkspace, GitStatus, PaneCloseAction, MergeStrategy, CompletionActionStatus, CompletionPolicy, AppConfig, WorkspaceSummary, InspectorReport, Turn, TurnPendingAction, PublishPath } from './types'

// ---------------------------------------------------------------------------
// Channel name constants
// ---------------------------------------------------------------------------

export const IPC = {
  // renderer → main (fire-and-forget)
  PANE_CLOSE: 'pane:close',
  PANE_INPUT: 'pane:input',
  PANE_RESIZE: 'pane:resize',
  PANE_MOVE: 'pane:move',
  PANE_RESPAWN: 'pane:respawn',
  PANE_EFFORT: 'pane:effort',
  PANE_MODEL: 'pane:model',
  GLOBAL_EFFORT: 'global:effort',
  WINDOW_NEW: 'window:new',
  FEEDBACK_SEND: 'feedback:send',

  // renderer → main (invoke/reply)
  PANE_SPAWN: 'pane:spawn',
  GLOBAL_EFFORT_GET: 'global:effort:get',
  WORKTREE_LIST: 'worktree:list',
  PATH_VALIDATE: 'path:validate',
  PATH_GIT_INIT: 'path:git-init',
  FOLDER_BROWSE: 'folder:browse',
  WINDOW_LIST: 'window:list',
  ANALYTICS_GET_CONSENT: 'analytics:get-consent',
  ANALYTICS_SET_CONSENT: 'analytics:set-consent',
  ANALYTICS_TRACK_SHORTCUT: 'analytics:track-shortcut',
  SESSION_HISTORY_LIST: 'session-history:list',

  // renderer → main (invoke/reply) — worktree close with git operations
  PANE_CLOSE_WORKTREE: 'pane:close-worktree',

  // renderer → main (invoke/reply) — merge a done+unmerged pane and close it.
  // Routes through completionExecutor.executeMerge; on conflict / dirty-main
  // the pane stays open and the error state comes back to the caller.
  PANE_MERGE_AND_CLOSE: 'pane:merge-and-close',

  // main → renderer
  PANE_SPAWNED: 'pane:spawned',
  PANE_CLOSED: 'pane:closed',
  PANE_DATA: 'pane:data',
  PANE_STATUS: 'pane:status',
  PANE_METRICS: 'pane:metrics',
  PANE_MOVED_IN: 'pane:moved-in',
  PANE_TERMINATED: 'pane:terminated',
  PANE_RESPAWNED: 'pane:respawned',

  // main → renderer — git status update for a pane
  PANE_GIT_STATUS: 'pane:git-status',

  // main → renderer — permission-mode change (normal | plan), derived from PTY output
  PANE_PERMISSION_MODE: 'pane:permission-mode',

  // main → renderer (account-level rate limit data, PE-01)
  RATE_LIMITS_UPDATE: 'rate-limits:update',

  // renderer → main (invoke/reply) — fetch last known rate limits (PE-01)
  RATE_LIMITS_GET: 'rate-limits:get',

  // menu → renderer (triggered by application menu items, B-066)
  MENU_NEW_PANE: 'menu:new-pane',
  MENU_CLOSE_PANE: 'menu:close-pane',
  MENU_ANALYTICS: 'menu:analytics',
  MENU_FEEDBACK: 'menu:feedback',

  // renderer → main (invoke/reply) — permissions management
  PERMISSIONS_GET_DEFAULTS: 'permissions:get-defaults',
  PERMISSIONS_GET_EFFECTIVE: 'permissions:get-effective',
  PERMISSIONS_SET_SCOPE: 'permissions:set-scope',
  PERMISSIONS_RESET_SCOPE: 'permissions:reset-scope',
  PERMISSIONS_GET_PROJECT_PATHS: 'permissions:get-project-paths',
  PERMISSIONS_GET_KNOWN_RULES: 'permissions:get-known-rules',

  // renderer → main (invoke/reply) — check if claude CLI is available
  CLAUDE_CHECK: 'claude:check',

  // renderer → main (invoke/reply) — create workspace + batch spawn terminals in one step
  WORKSPACE_CREATE_WITH_TERMINALS: 'workspace:create-with-terminals',

  // renderer → main (invoke/reply) — add one or more terminals to an existing workspace.
  // Same shape as create-with-terminals minus workspace-creation fields (no name,
  // no viewMode). The handler delegates to the same spawn-terminals helper used
  // by WORKSPACE_CREATE_WITH_TERMINALS so behavior stays consistent.
  WORKSPACE_ADD_TERMINALS: 'workspace:add-terminals',

  // renderer → main (invoke/reply) — resume the most recently closed workspace
  WORKSPACE_RESUME_LAST: 'workspace:resume-last',

  // renderer → main (invoke/reply) — open external URL in system browser
  OPEN_EXTERNAL: 'open:external',

  // renderer → main (invoke/reply) — reveal a filesystem path in the OS file manager
  WORKSPACE_REVEAL_PATH: 'workspace:reveal-path',

  // renderer → main: signals that IPC listeners are registered and ready
  RENDERER_READY: 'renderer:ready',

  // renderer → main (invoke/reply) — mount-time seed for the pane list.
  // Mirrors the useManagerState WORKSPACE_LIST seed (L-014): the
  // PANE_SPAWNED broadcasts that preceded the provider's mount are gone
  // forever, so the provider pulls its own state. Also recovers from a
  // full renderer reload (Cmd+R, crash+recover) without making the
  // user lose sight of their live panes.
  PANE_LIST_GET: 'pane:list-get',

  // renderer → main: per-pane XTermView has mounted and its pane:data listener
  // is live. Main flushes any PTY output that arrived before this signal and
  // then streams live. Prevents the "first pane shows partial startup output"
  // race where early PTY bytes outrun the React mount of the listener.
  PANE_READY: 'pane:ready',

  // Workspace / management close sequence. Replaces the B-051 family
  // (CONFIRM_CLOSE_SESSIONS*) with a per-pane confirmation flow.
  //
  // Main → renderer: begin a sequence for this workspace. The renderer mounts
  // the WorkspaceCloseOverlay and walks the user through one PaneCloseConfirmModal
  // per pane. Management-initiated closes set `isManagerInitiated` so the overlay
  // can show a "workspace i of n" breadcrumb.
  CLOSE_WORKSPACE_SEQUENCE_START: 'window:close-workspace-sequence-start',
  // Renderer → main: the overlay has rendered. Cancels the native-dialog
  // fallback timer, same semantics as the old CONFIRM_CLOSE_SESSIONS_ACK.
  CLOSE_WORKSPACE_SEQUENCE_ACK: 'window:close-workspace-sequence-ack',
  // Renderer → main: final response after the user has walked the sequence.
  // `cancel` leaves everything intact; `complete` means each pane was already
  // closed via its individual IPC and the window can be destroyed; `override-all`
  // means the user hit the "close all remaining" escape hatch and main should
  // force-close the remaining panes (keep-worktree semantics).
  CLOSE_WORKSPACE_SEQUENCE_RESPONSE: 'window:close-workspace-sequence-response',

  // --- Workspace management ---

  // renderer → main (invoke/reply) — workspace CRUD
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_GET: 'workspace:get',
  WORKSPACE_ACTIVATE: 'workspace:activate',
  WORKSPACE_DEACTIVATE: 'workspace:deactivate',
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_RENAME: 'workspace:rename',
  WORKSPACE_ARCHIVE: 'workspace:archive',
  WORKSPACE_UNARCHIVE: 'workspace:unarchive',
  WORKSPACE_DELETE_ARCHIVED: 'workspace:delete-archived',

  // renderer → main (invoke/reply) — workspace terminal operations
  WORKSPACE_PAUSED_TERMINALS: 'workspace:paused-terminals',
  WORKSPACE_RESUME_TERMINAL: 'workspace:resume-terminal',

  // renderer → main (invoke/reply) — view mode + active pane (Kanban view)
  WORKSPACE_SET_VIEW_MODE: 'workspace:set-view-mode',
  WORKSPACE_SET_ACTIVE_PANE: 'workspace:set-active-pane',

  // main → renderer — pushed when the management window asks to focus a
  // specific terminal in an already-active workspace. The receiving
  // workspace window switches its active pane to the requested paneId.
  WORKSPACE_FOCUS_PANE: 'workspace:focus-pane',

  // renderer → main (fire-and-forget) — manager navigation
  MANAGER_FOCUS_WORKSPACE: 'manager:focus-workspace',
  MANAGER_FOCUS_TERMINAL: 'manager:focus-terminal',
  MANAGER_SHOW: 'manager:show',

  // main → renderer — window initialization (sent after RENDERER_READY)
  WINDOW_INIT: 'window:init',

  // main → renderer — manager window state updates
  MANAGER_STATE_UPDATE: 'manager:state-update',

  // main → renderer — workspace window dormant terminal updates
  WORKSPACE_PAUSED_UPDATE: 'workspace:paused-update',

  // main → renderer — bracket the initial batch-spawn loop kicked off by
  // WORKSPACE_CREATE_WITH_TERMINALS. The renderer uses these to mount a
  // "Claudinha is launching your agent team…" overlay over the workspace
  // window so the user doesn't watch terminals trickle in one-by-one over
  // a half-built UI.
  WORKSPACE_INITIAL_SPAWN_BEGIN: 'workspace:initial-spawn-begin',
  WORKSPACE_INITIAL_SPAWN_COMPLETE: 'workspace:initial-spawn-complete',

  // --- Completion Actions v2 (turn-as-commit, Option B) ---
  //
  // See docs/implementation-plan-completion-actions.md §7. Each agent turn
  // is auto-committed as a `wip(turn-N)` commit; the renderer surfaces
  // turns and offers publish/split/discard.

  // main → renderer — broadcast events
  TURN_RECORDED: 'turn:recorded',          // a new wip-commit landed for a pane
  TURNS_UPDATED: 'turn:updated',           // full turn projection for a pane refreshed
  TURN_PENDING_ACTION: 'turn:pending-action', // pending-action for a pane changed (set | cleared)

  // renderer → main (invoke/reply) — fetch + actions
  TURNS_GET: 'turn:get',                   // fetch the current turn projection for a pane
  TURN_PUBLISH_SQUASH: 'turn:publish-squash',
  TURN_PUBLISH_INDIVIDUAL: 'turn:publish-individual',
  TURN_SPLIT: 'turn:split',
  TURN_DISCARD: 'turn:discard',
  TURN_GET_DIFF: 'turn:get-diff',
  TURN_AUTO_COMMIT_TOGGLE: 'turn:auto-commit-toggle',

  // renderer → main (invoke/reply) — Publish-path config
  REPO_PUBLISH_PATH_GET: 'repo:publish-path-get',
  REPO_PUBLISH_PATH_SET: 'repo:publish-path-set',
  WORKSPACE_DEFAULT_PATH_SET: 'workspace:default-path-set',
  WORKSPACE_DEFAULT_PATH_GET: 'workspace:default-path-get',

  // renderer → main (invoke/reply) — Repo-level aggregation (M5)
  REPO_TURNS_GET: 'repo-turns:get',

  // renderer → main (invoke/reply) — bulk operations
  BULK_RUN: 'bulk:run',
  BULK_CANCEL: 'bulk:cancel',
  // main → renderer — bulk progress events
  BULK_PROGRESS: 'bulk:progress',
  BULK_COMPLETED: 'bulk:completed',
  // renderer → main (invoke/reply) — multi-conflict resolution choice
  MERGE_CONFLICT_RESOLVE: 'merge-conflict:resolve',

  // --- Completion actions (merge/PR flow) — LEGACY v1, scheduled for deletion ---

  // renderer → main (invoke/reply)
  COMPLETION_MERGE: 'completion:merge',
  COMPLETION_PR: 'completion:pr',
  COMPLETION_ABORT: 'completion:abort',
  COMPLETION_CANCEL_QUEUE: 'completion:cancel-queue',
  COMPLETION_RESOLVE: 'completion:resolve',

  // renderer → main (fire-and-forget)
  COMPLETION_DISMISS: 'completion:dismiss',
  // renderer → main (fire-and-forget) — clear a failure state back to 'ready'
  // while keeping the bar visible so the user can retry or pick a different
  // strategy without losing the Merge/PR dropdowns.
  COMPLETION_CLEAR_STATE: 'completion:clear-state',

  // renderer → main (invoke/reply) — gh CLI availability check
  GH_CLI_CHECK: 'gh:cli-check',

  // main → renderer — completion status update for a pane
  COMPLETION_STATUS: 'completion:status',

  // main → renderer — pane is (or is not) resolving a merge conflict via Claude
  PANE_RESOLVING_CONFLICT: 'pane:resolving-conflict',

  // --- Completion policies (Phase 3) ---

  // renderer → main (invoke/reply)
  COMPLETION_POLICY_GET_GLOBAL: 'completion-policy:get-global',
  COMPLETION_POLICY_SET_GLOBAL: 'completion-policy:set-global',
  COMPLETION_POLICY_SET_WORKSPACE: 'completion-policy:set-workspace',
  COMPLETION_POLICY_GET_WORKSPACE: 'completion-policy:get-workspace',

  // renderer → main (invoke/reply) — bulk merge/PR all eligible panes
  COMPLETION_MERGE_ALL: 'completion:merge-all',
  COMPLETION_PR_ALL: 'completion:pr-all',

  // renderer → main (invoke/reply) — Kanban repo-level Push and composite Merge+Push
  REPO_PUSH_BASE_BRANCH: 'repo:push-base-branch',
  REPO_MERGE_AND_PUSH: 'repo:merge-and-push',

  // renderer → main (invoke/reply) — Kanban repo-card "Approve plans in sequence"
  //   - APPROVE starts the PlanApprovalSequencer for a repo
  //   - STOP clears pending queue without interrupting any in-flight pane
  REPO_APPROVE_PLANS_IN_SEQUENCE: 'repo:approve-plans-in-sequence',
  REPO_STOP_PLAN_SEQUENCE: 'repo:stop-plan-sequence',

  // renderer → main (invoke/reply) — Kanban repo-card "Retry failed merges"
  // Clears error state and re-runs merge for every tree in this repo whose
  // last merge landed in `completionActionStatus.state === 'error'`.
  REPO_RETRY_FAILED_MERGES: 'repo:retry-failed-merges',

  // renderer → main (invoke/reply) — Kanban CLAUDE.md editor (read + save)
  REPO_CLAUDE_MD_READ: 'repo:claude-md-read',
  REPO_CLAUDE_MD_SAVE: 'repo:claude-md-save',

  // renderer → main (invoke/reply) — Kanban diff viewer modal
  REPO_DIFF_GET: 'repo:diff-get',

  // renderer → main (invoke/reply) — Kanban dirty-main resolution modal.
  // Each operates on the filtered file set that surfaced in the dirty-main
  // completion status; .worktrees/ and .claude/ are never touched.
  GIT_COMMIT_DIRTY_MAIN: 'git:commit-dirty-main',
  GIT_STASH_DIRTY_MAIN: 'git:stash-dirty-main',
  GIT_DISCARD_DIRTY_MAIN: 'git:discard-dirty-main',

  // renderer → main (invoke/reply) — ChangesReadyModal commit-message tooling.
  // GIT_COMMIT_ALL stages + commits the worktree with a caller-supplied
  // message. GIT_PANE_COMMIT_LOG returns the commit-list shown in the modal
  // (commits ahead of upstream/base, plus pushed-state per row).
  // GIT_REWORD_COMMIT rewrites a single unpushed commit's message via amend
  // (tip) or non-interactive rebase (older); refuses if pushed or worktree dirty.
  GIT_COMMIT_ALL: 'git:commit-all',
  GIT_PANE_COMMIT_LOG: 'git:pane-commit-log',
  GIT_REWORD_COMMIT: 'git:reword-commit',
  // GIT_LIST_BRANCHES feeds the merge-target picker on ChangesReadyModal: a
  // list of local branches in the worktree's repo, plus the current branch
  // (so the picker can preselect it when opened cold).
  GIT_LIST_BRANCHES: 'git:list-branches',

  // renderer → main (fire-and-forget) — set per-pane user name override (Kanban inline rename)
  PANE_SET_USER_NAME: 'pane:set-user-name',

  // main → renderer — global policy changed (broadcast to all windows)
  COMPLETION_POLICY_GLOBAL_CHANGED: 'completion-policy:global-changed',
  // main → renderer — workspace policy changed (broadcast to that workspace's window)
  COMPLETION_POLICY_WORKSPACE_CHANGED: 'completion-policy:workspace-changed',

  // --- App config (Configuration view) ---

  // renderer → main (invoke/reply)
  APP_CONFIG_GET: 'app-config:get',
  APP_CONFIG_SET: 'app-config:set',
  APP_CONFIG_RESET: 'app-config:reset',

  // main → renderer — broadcast on every mutate so all windows stay in sync
  APP_CONFIG_CHANGED: 'app-config:changed',

  // --- Inspector (cross-pane summary drawer) ---

  // renderer → main (invoke/reply) — pull current summary for a workspace on demand
  INSPECTOR_GET_SUMMARY: 'inspector:get-summary',
  // renderer → main (invoke/reply) — one-shot claude -p for natural-language report
  INSPECTOR_ASK_LLM: 'inspector:ask-llm',
  // main → renderer — broadcast workspace summary to the workspace's window (sent only
  // when at least one input to the summary has changed vs the prior broadcast)
  INSPECTOR_SUMMARY: 'inspector:summary'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

// ---------------------------------------------------------------------------
// Serializable tool usage summary (Record instead of Map, for IPC transport)
// ---------------------------------------------------------------------------

/** JSON-serializable form of ToolUsageSummary (Map<string,number>) */
export type ToolUsageSummaryRecord = Record<string, number>

// ---------------------------------------------------------------------------
// Serializable PaneMetrics for IPC transport
// ---------------------------------------------------------------------------

export interface PaneMetricsIpc {
  totalTokens: number | null
  contextPercent: number | null
  toolsUsed: ToolUsageSummaryRecord | null
  totalCostUsd: number | null
  durationMs: number | null
  modelDisplayName: string | null
  linesAdded: number | null
  linesRemoved: number | null
  sessionTitle: string | null
  agentName: string | null
  initialPrompt: string | null
}

// ---------------------------------------------------------------------------
// Serialization helper
// ---------------------------------------------------------------------------

/**
 * Convert an in-memory PaneMetrics object to the JSON-serializable IPC form.
 * Converts toolsUsed Map → Record and preserves all nullable fields.
 */
export function metricsToIpc(metrics: PaneMetrics): PaneMetricsIpc {
  return {
    totalTokens: metrics.totalTokens,
    contextPercent: metrics.contextPercent,
    toolsUsed: metrics.toolsUsed ? Object.fromEntries(metrics.toolsUsed) : null,
    totalCostUsd: metrics.totalCostUsd,
    durationMs: metrics.durationMs,
    modelDisplayName: metrics.modelDisplayName,
    linesAdded: metrics.linesAdded,
    linesRemoved: metrics.linesRemoved,
    sessionTitle: metrics.sessionTitle,
    agentName: metrics.agentName,
    initialPrompt: metrics.initialPrompt
  }
}

// ---------------------------------------------------------------------------
// Payload type definitions — renderer → main
// ---------------------------------------------------------------------------

/** pane:spawn — request a new Claude Code terminal pane */
export interface PaneSpawnPayload {
  mode: 'new-worktree' | 'existing-worktree' | 'manual-path' | 'resume-session'
  /** Required for new-worktree and existing-worktree modes */
  repoPath?: string
  /** Required for existing-worktree and manual-path modes */
  worktreePath?: string
  /** Optional user-specified worktree name for new-worktree mode; auto-generated if omitted */
  worktreeName?: string
  /** Session ID for resume-session mode (PE-06) */
  sessionId?: string
  /** Effort level for the new pane (PE-03) */
  effort?: EffortLevel
  /** Claude model for the new pane (passed via --model on spawn) */
  model?: Model
  /** Workspace this terminal belongs to (required when workspace system is active) */
  workspaceId?: string
}

/** pane:close — request PTY kill and pane cleanup */
export interface PaneClosePayload {
  paneId: string
}

/** pane:input — user keyboard input forwarded to PTY */
export interface PaneInputPayload {
  paneId: string
  data: string
}

/** pane:resize — terminal resize event */
export interface PaneResizePayload {
  paneId: string
  cols: number
  rows: number
}

/** pane:ready — XTermView has mounted and is listening for pane:data */
export interface PaneReadyPayload {
  paneId: string
}

/** pane:move — move pane to a different window */
export interface PaneMovePayload {
  paneId: string
  targetWindowId: string
  /** xterm.js serialized buffer state for restoring terminal content in target window */
  serializedBuffer?: string
}

/** window:new — create a new window, optionally tearing a pane into it */
export interface WindowNewPayload {
  /** If provided, move this pane into the new window after it loads */
  paneId?: string
  /** Serialized xterm buffer for the torn-off pane (B-049) */
  serializedBuffer?: string
}

/** An open window entry returned by window:list */
export interface WindowEntry {
  id: string
  /** Human-readable label, e.g. "Window 1" */
  label: string
}

/** worktree:list — request list of git worktrees for a repo */
export interface WorktreeListPayload {
  repoPath: string
}

/** path:validate — check that a path exists and is a directory */
export interface PathValidatePayload {
  path: string
}

/** path:validate response */
export interface PathValidateResult {
  valid: boolean
  error?: string
  /** Whether the path is inside a git repository */
  isGitRepo?: boolean
}

/** pane:spawn response — null error means success */
export interface PaneSpawnResult {
  error: string | null
}

/** A single git worktree entry */
export interface WorktreeEntry {
  path: string
  branch: string | null
  isMain: boolean
}

/** worktree:list response */
export interface WorktreeListResult {
  entries: WorktreeEntry[]
  error?: string
}

/** feedback:send — send a bug report or feature request */
export interface FeedbackSendPayload {
  type: 'bug' | 'feature'
  message: string
  email?: string
}

// ---------------------------------------------------------------------------
// Payload type definitions — main → renderer
// ---------------------------------------------------------------------------

/** pane:spawned — confirms pane was created, provides initial metadata */
export interface PaneSpawnedPayload {
  paneId: string
  repoName: string
  worktreeName: string
  worktreePath: string
  isApiBilling: boolean
  effort: EffortLevel
  model: Model
  isWorktree: boolean
  /** Optional user-supplied display name (Kanban). Always null at spawn. */
  userName?: string | null
}

/** pane:closed — confirms pane PTY was destroyed */
export interface PaneClosedPayload {
  paneId: string
}

/** pane:data — PTY output stream chunk */
export interface PaneDataPayload {
  paneId: string
  data: string
}

/** pane:status — status change detected (emitted only on actual changes) */
export interface PaneStatusPayload {
  paneId: string
  status: PaneStatus
  activeToolName: string | null
  source: 'hook' | 'pty-fallback'
}

/** pane:metrics — metrics update from MetricsCollector */
export interface PaneMetricsPayload {
  paneId: string
  metrics: PaneMetricsIpc
}

/** pane:respawn — request to restart PTY for a terminated pane (B-052) */
export interface PaneRespawnPayload {
  paneId: string
}

/**
 * pane:list-get response — full snapshot of every live pane in the caller's
 * BrowserWindow, assembled from the main-process SessionRegistry. Used as the
 * renderer's mount-time seed so a reloaded window recovers its pane list
 * without relying on replayed PANE_SPAWNED broadcasts.
 */
export interface PaneRehydrateEntry {
  paneId: string
  repoName: string
  worktreeName: string
  worktreePath: string
  isApiBilling: boolean
  effort: EffortLevel
  model: Model
  isWorktree: boolean
  status: PaneStatus
  activeToolName: string | null
  statusSource: 'hook' | 'pty-fallback'
  metrics: PaneMetricsIpc
  terminated: boolean
  gitStatus: GitStatus | null
  completionStatus: CompletionActionStatus | null
  isResolvingConflict: boolean
  /** Optional user-supplied name override (Kanban). Null = no override. */
  userName?: string | null
  /** Current Claude Code permission mode (detected from PTY output). */
  permissionMode?: 'normal' | 'plan'
}

export interface PaneListResult {
  panes: PaneRehydrateEntry[]
}

/** pane:terminated — PTY exited unexpectedly; pane stays visible for respawn (B-052) */
export interface PaneTerminatedPayload {
  paneId: string
  exitCode: number
}

/** pane:respawned — PTY was successfully restarted (B-052) */
export interface PaneRespawnedPayload {
  paneId: string
}

/** pane:moved-in — signals the target window to adopt the pane (B-048) */
export interface PaneMovedInPayload {
  paneId: string
  repoName: string
  worktreeName: string
  worktreePath: string
  isApiBilling: boolean
  effort: EffortLevel
  model: Model
  status: import('./types').PaneStatus
  activeToolName: string | null
  metrics: PaneMetricsIpc
  /** Serialized xterm.js buffer from source window for content restoration */
  serializedBuffer?: string
}

/** pane:effort — update effort level for a pane (PE-03) */
export interface PaneEffortPayload {
  paneId: string
  effort: EffortLevel
}

/**
 * pane:set-user-name — fire-and-forget. Pass `userName: null` to clear the
 * override. Renderer keeps optimistic local state; main mirrors into the
 * SessionRegistry so PANE_LIST_GET responses pick up the new value.
 */
export interface PaneSetUserNamePayload {
  paneId: string
  userName: string | null
}

/** pane:model — update Claude model for a pane (live via /model slash command) */
export interface PaneModelPayload {
  paneId: string
  model: Model
}

/** global:effort — write effort level to ~/.claude/settings.json */
export interface GlobalEffortPayload {
  effort: EffortLevel
}

/** A single rate-limit window (5-hour or 7-day) */
export interface RateLimitWindow {
  usedPercentage: number
  /** ISO 8601 timestamp when this window resets */
  resetsAt: string
}

/** rate-limits:update — account-level rate limit data broadcast to all windows (PE-01) */
export interface RateLimitsPayload {
  fiveHour: RateLimitWindow | null
  sevenDay: RateLimitWindow | null
}

/** window:confirm-close-sessions — main asks renderer to show close confirmation (B-051) */
export interface ConfirmCloseSessionsPayload {
  activeSessionCount: number
  /** Number of worktree panes with uncommitted git changes */
  worktreeUncommittedCount?: number
  /** Summary of worktrees with uncommitted changes for display */
  uncommittedWorktrees?: Array<{ worktreeName: string; changedFileCount: number }>
}

/** window:confirm-close-sessions-response — renderer replies with user's choice (B-051) */
export interface ConfirmCloseSessionsResponsePayload {
  confirmed: boolean
  /** If true, commit all uncommitted worktree changes before closing */
  commitAll?: boolean
}

// ---------------------------------------------------------------------------
// Payload type definitions — permissions management
// ---------------------------------------------------------------------------

export interface PermissionsGetEffectivePayload {
  scope: 'global' | 'project'
  projectPath?: string
}

export interface PermissionsGetEffectiveResult {
  allow: string[]
  deny: string[]
  overrides: PermissionOverrides
}

export interface PermissionsSetScopePayload {
  scope: 'global' | 'project'
  projectPath?: string
  overrides: PermissionOverrides
}

export interface PermissionsResetScopePayload {
  scope: 'global' | 'project'
  projectPath?: string
}

export interface PermissionsDefaultsResult {
  allow: readonly string[]
  deny: readonly string[]
}

/** permissions:get-known-rules — union of defaults + every user-added entry across all scopes */
export interface PermissionsKnownRulesResult {
  rules: string[]
}

// ---------------------------------------------------------------------------
// Payload type definitions — workspace management
// ---------------------------------------------------------------------------

/** workspace:create — request to create a new workspace */
export interface WorkspaceCreatePayload {
  type: WorkspaceType
  /** Optional custom name; auto-generated from type/constraint if omitted */
  name?: string
  constraint: WorkspaceConstraint
}

/** workspace:create response */
export interface WorkspaceCreateResult {
  error: string | null
  workspaceId?: string
}

/** workspace:activate — request to activate a dormant workspace */
export interface WorkspaceActivatePayload {
  workspaceId: string
  /** Optional: only restore these specific terminals (by original paneId from TerminalSnapshot) */
  terminalIds?: string[]
}

/** workspace:activate response */
export interface WorkspaceActivateResult {
  error: string | null
}

/** workspace:deactivate — request to deactivate an active workspace */
export interface WorkspaceDeactivatePayload {
  workspaceId: string
}

/** workspace:delete — permanently remove a dormant workspace */
export interface WorkspaceDeletePayload {
  workspaceId: string
}

/** workspace:archive — move a dormant workspace into the archived state */
export interface WorkspaceArchivePayload {
  workspaceId: string
}

/** workspace:archive response */
export interface WorkspaceArchiveResult {
  error: string | null
}

/** workspace:unarchive — restore an archived workspace back to dormant */
export interface WorkspaceUnarchivePayload {
  workspaceId: string
}

/** workspace:unarchive response */
export interface WorkspaceUnarchiveResult {
  error: string | null
}

/** workspace:delete-archived — permanently remove an archived workspace */
export interface WorkspaceDeleteArchivedPayload {
  workspaceId: string
}

/** workspace:delete-archived response */
export interface WorkspaceDeleteArchivedResult {
  error: string | null
}

/** workspace:rename — rename a workspace */
export interface WorkspaceRenamePayload {
  workspaceId: string
  name: string
}

/** workspace:dormant-terminals — get dormant terminals for a workspace */
export interface WorkspacePausedTerminalsPayload {
  workspaceId: string
}

/** workspace:resume-terminal — resume a specific dormant terminal in its workspace */
export interface WorkspaceResumeTerminalPayload {
  workspaceId: string
  /** Original paneId from TerminalSnapshot */
  terminalSnapshotPaneId: string
}

/** workspace:resume-terminal response */
export interface WorkspaceResumeTerminalResult {
  error: string | null
}

/** manager:focus-workspace — focus a workspace's window */
export interface ManagerFocusWorkspacePayload {
  workspaceId: string
}

/** manager:focus-terminal — focus a specific terminal in its workspace window */
export interface ManagerFocusTerminalPayload {
  workspaceId: string
  paneId: string
}

/** window:init — sent from main to renderer after RENDERER_READY to identify window type */
export interface WindowInitPayload {
  windowType: 'manager' | 'workspace'
  workspaceId?: string
  workspaceName?: string
  workspaceType?: WorkspaceType
  workspaceConstraint?: WorkspaceConstraint
  /** Drones to auto-resume when this workspace window opens (from workspace reactivation) */
  terminalsToResume?: TerminalSnapshot[]
  /** Whether the claude CLI was found at app launch (manager window only) */
  claudeFound?: boolean
  /** Global completion policy at the time the window was opened */
  globalCompletionPolicy?: CompletionPolicy
  /** Workspace-scoped completion policy (null = inherit global). Only set for workspace windows. */
  workspaceCompletionPolicy?: CompletionPolicy | null
  /** Persisted top-level view mode for this workspace. Defaults to 'wall' when absent. */
  workspaceViewMode?: 'wall' | 'kanban'
  /** Persisted active pane in Kanban view (null when no selection yet). */
  workspaceActivePaneId?: string | null
}

/** manager:state-update — full manager state pushed to the manager window */
export interface ManagerStatePayload {
  activeWorkspaces: RendererWorkspace[]
  dormantWorkspaces: RendererWorkspace[]
  archivedWorkspaces: RendererWorkspace[]
  /** The next workspace ordinal that would be assigned to a new workspace.
   *  Used by LaunchForm to prefill the Workspace Name field. */
  nextWorkspaceNumber: number
}

/** workspace:dormant-update — dormant terminals list update for a workspace window */
export interface WorkspacePausedUpdatePayload {
  workspaceId: string
  pausedTerminals: TerminalSnapshot[]
}

// ---------------------------------------------------------------------------
// Payload type definitions — git status and worktree close
// ---------------------------------------------------------------------------

/** pane:git-status — git status update for a pane (main → renderer) */
export interface PaneGitStatusPayload {
  paneId: string
  gitStatus: GitStatus
}

/**
 * pane:permission-mode — Claude Code permission mode derived from PTY output.
 * Broadcast only on transitions (main's StatusDetector gates this). Drives the
 * Kanban mode badge and the Stop-hook plan-mode override.
 */
export interface PanePermissionModePayload {
  paneId: string
  permissionMode: 'normal' | 'plan'
}

/** pane:close-worktree — close a pane with git/worktree operations (renderer → main invoke/reply).
 *  Only keep-worktree and prune-worktree variants are supported; the merge-close
 *  action flows through IPC.PANE_MERGE_AND_CLOSE instead. */
export interface PaneCloseWorktreePayload {
  paneId: string
  action: 'keep-close' | 'prune-close'
}

/** pane:close-worktree response */
export interface PaneCloseWorktreeResult {
  error: string | null
}

/** pane:merge-and-close — merge the pane's worktree into its base branch and,
 *  on success, close the pane. Used by the "Merge & close" action in the
 *  PaneCloseConfirmModal. Conflict / dirty-main states leave the pane open
 *  and return the state so the modal can surface the error. */
export interface PaneMergeAndClosePayload {
  paneId: string
  strategy: MergeStrategy
}

export interface PaneMergeAndCloseResult {
  error: string | null
  /** When set, the merge did not complete and the pane is still open. */
  state?: 'conflict' | 'dirty-main' | 'blocked'
}

// ---------------------------------------------------------------------------
// Payload type definitions — workspace/management close sequence
// ---------------------------------------------------------------------------

/** Per-pane descriptor included in CLOSE_WORKSPACE_SEQUENCE_START. Contains
 *  exactly what the PaneCloseConfirmModal needs to render — nothing else —
 *  so the renderer doesn't have to cross-reference session state during the
 *  sequence. */
export interface CloseSequencePaneDescriptor {
  paneId: string
  status: PaneStatus
  isWorktree: boolean
  /** Human-readable repo display name */
  repoName: string
  /** Preferred display name — sessionTitle first, falls back to worktreeName. */
  agentName: string
  worktreeName: string
  /** Git snapshot at the moment the sequence started — avoids jitter if a
   *  late poll update lands mid-confirmation. */
  branchName: string | null
  hasUncommittedChanges: boolean
  changedFileCount: number
  commitsAhead: number
  /** When true the pane has never consumed tokens — the renderer still
   *  filters these to bypass the modal, but main sends them anyway so the
   *  override path can include them. */
  isUntouched: boolean
}

/** window:close-workspace-sequence-start — main → renderer */
export interface CloseWorkspaceSequenceStartPayload {
  workspaceId: string
  workspaceName: string
  panes: CloseSequencePaneDescriptor[]
  /** True when this sequence is being driven by a management-window close. */
  isManagerInitiated: boolean
  /** Populated only when isManagerInitiated is true. */
  managerProgress: { current: number; total: number } | null
}

/** window:close-workspace-sequence-response — renderer → main */
export interface CloseWorkspaceSequenceResponsePayload {
  workspaceId: string
  action: 'cancel' | 'complete' | 'override-all'
}

// ---------------------------------------------------------------------------
// Payload type definitions — completion actions (merge/PR flow)
// ---------------------------------------------------------------------------

/** completion:merge — request merge for a pane (renderer → main invoke/reply) */
export interface CompletionMergePayload {
  paneId: string
  strategy: MergeStrategy
  /** Optional explicit base branch to merge into (set by the ChangesReadyModal
   *  branch picker). When absent, the executor falls back to the auto-detected
   *  `main`/`master`. */
  targetBranch?: string
}

/** completion:merge response */
export interface CompletionMergeResult {
  error: string | null
}

/** completion:pr — request PR creation for a pane (renderer → main invoke/reply) */
export interface CompletionPrPayload {
  paneId: string
  draft: boolean
}

/** completion:pr response */
export interface CompletionPrResult {
  error: string | null
  prUrl?: string
}

/** completion:abort — abort in-progress merge/rebase (renderer → main invoke/reply) */
export interface CompletionAbortPayload {
  paneId: string
}

/** completion:abort response */
export interface CompletionAbortResult {
  error: string | null
}

/** completion:dismiss — dismiss the action bar (renderer → main fire-and-forget) */
export interface CompletionDismissPayload {
  paneId: string
}

/** completion:clear-state — reset a failed action back to 'ready' without hiding the bar */
export interface CompletionClearStatePayload {
  paneId: string
}

/** completion:cancel-queue — cancel a queued merge (renderer → main invoke/reply) */
export interface CompletionCancelQueuePayload {
  paneId: string
}

/** completion:cancel-queue response */
export interface CompletionCancelQueueResult {
  error: string | null
}

/** completion:resolve — request Claude-assisted conflict resolution (renderer → main invoke/reply) */
export interface CompletionResolvePayload {
  paneId: string
}

/** completion:resolve response */
export interface CompletionResolveResult {
  error: string | null
}

/**
 * completion:status — completion status update (main → renderer).
 * `status` may be null to signal that the action bar should be dismissed
 * (e.g. when a pane transitions out of 'done' or the user dismisses the bar).
 */
export interface CompletionStatusPayload {
  paneId: string
  status: CompletionActionStatus | null
}

/** pane:resolving-conflict — pane resolving-conflict flag update (main → renderer) */
export interface PaneResolvingConflictPayload {
  paneId: string
  isResolvingConflict: boolean
}

/** gh:cli-check response */
export interface GhCliCheckResult {
  available: boolean
}

// ---------------------------------------------------------------------------
// Payload type definitions — completion policies (Phase 3)
// ---------------------------------------------------------------------------

/** completion-policy:set-global — update the app-wide default policy */
export interface CompletionPolicySetGlobalPayload {
  policy: CompletionPolicy
}

/** completion-policy:set-workspace — update a workspace's policy override (null clears) */
export interface CompletionPolicySetWorkspacePayload {
  workspaceId: string
  policy: CompletionPolicy | null
}

/** completion-policy:get-workspace — fetch a workspace's policy override */
export interface CompletionPolicyGetWorkspacePayload {
  workspaceId: string
}

/** completion-policy:global-changed — broadcast when the global policy is updated */
export interface CompletionPolicyGlobalChangedPayload {
  policy: CompletionPolicy
}

/** completion-policy:workspace-changed — broadcast when a workspace's policy is updated */
export interface CompletionPolicyWorkspaceChangedPayload {
  workspaceId: string
  policy: CompletionPolicy | null
}

/** completion:merge-all — enqueue merges for every eligible pane in a scope */
export interface CompletionMergeAllPayload {
  scope: 'workspace' | 'global'
  /** Required when scope === 'workspace' */
  workspaceId?: string
  strategy: MergeStrategy
  /** When true, also persist the scope's policy to `auto-merge` with this strategy */
  alsoSetPolicy?: boolean
  /**
   * Optional per-repo scope. When set with scope='workspace', only panes whose
   * inspector groupKey (parent dir) matches `repoPath` are eligible. Used by
   * the Kanban repo rail's per-repo Merge button. Ignored when omitted.
   */
  repoPath?: string
}

export interface CompletionMergeAllResult {
  error: string | null
  /** How many panes were enqueued (or started) */
  enqueued: number
}

/**
 * repo:diff-get — read the unified diff of a worktree vs its base branch.
 * Used by the Kanban diff viewer modal. Truncated server-side to keep IPC
 * payloads bounded; the result indicates when truncation happened.
 */
export interface RepoDiffGetPayload {
  paneId: string
}

export interface RepoDiffGetResult {
  /** Full diff text (already truncated when `truncated` is true). */
  diff: string
  /** True when the diff exceeded the byte limit and was cut. */
  truncated: boolean
  /** Branch the diff was computed against, when known. */
  baseBranch: string | null
  /** Set on any failure (no worktree, no base branch, git error). */
  error?: string
}

/**
 * repo:claude-md-read — read the per-repo CLAUDE.md content + mtime.
 *
 * `repoPath` is the inspector groupKey (rollup repoPath); main resolves the
 * actual repo root via the inspector cache before reading.
 */
export interface RepoClaudeMdReadPayload {
  workspaceId: string
  repoPath: string
}

export interface RepoClaudeMdReadResult {
  /** File contents; empty string when the file doesn't exist yet. */
  content: string
  /** mtime captured at read; 0 when the file did not exist. Pass back on save. */
  mtimeMs: number
  /** Set when the read failed (repo unknown, FS error, etc.). */
  error?: string
}

/**
 * repo:claude-md-save — write CLAUDE.md, commit on the base branch, and
 * optionally push. Per Interpretation A in the concept doc.
 */
export interface RepoClaudeMdSavePayload {
  workspaceId: string
  repoPath: string
  content: string
  /** mtime returned by the prior read — used for the external-modification guard. */
  expectedMtimeMs: number
  /** When true, run `git push origin <base>` after the commit. */
  push: boolean
}

export interface RepoClaudeMdSaveResult {
  /**
   * Null on success.
   * 'modified-externally' when the file was changed outside the editor — the
   * renderer shows a banner and offers reload.
   * Other strings are surfaced verbatim.
   */
  error: string | null
  /** Set when error === 'modified-externally': the new on-disk content + mtime. */
  freshContent?: string
  freshMtimeMs?: number
  /** Push leg failed but the commit succeeded. UI shows this inline. */
  pushError?: string
}

/**
 * repo:push-base-branch — push a single repo's base branch to origin.
 *
 * `repoPath` is the inspector groupKey (the rollup's repoPath); main resolves
 * the actual main repo working tree via the inspector's per-group cache.
 */
export interface RepoPushBaseBranchPayload {
  workspaceId: string
  repoPath: string
}

export interface RepoPushBaseBranchResult {
  error: string | null
  /** Convenience for renderer optimism: the count after a successful push (always 0). */
  baseAheadOfOrigin?: number | null
}

/**
 * repo:merge-and-push — composite Kanban action: merge every eligible pane in
 * the given repo, then run a single push of the resulting base-branch commits.
 *
 * On any merge failure (conflict / dirty-main / error) the push is skipped.
 * The result reports per-pane completions and whether the push fired.
 */
export interface RepoMergeAndPushPayload {
  workspaceId: string
  repoPath: string
  strategy: MergeStrategy
  /** Optional explicit base branch (chosen via ChangesReadyModal's picker).
   *  When absent the executor uses the inspector's detected base. */
  targetBranch?: string
}

export interface RepoMergeAndPushResult {
  error: string | null
  /** How many panes were enqueued for merge. */
  enqueued: number
  /** How many merges completed successfully. */
  mergedCount: number
  /** Whether `git push` was actually attempted (i.e., all merges succeeded). */
  pushAttempted: boolean
  /** Push error message if push was attempted but failed. */
  pushError?: string
}

/**
 * repo:approve-plans-in-sequence — kick off the PlanApprovalSequencer for a
 * repo. Every pane currently sitting on Claude Code's plan-approval picker is
 * approved one-by-one with auto-accept-edits; after each pane's run ends, the
 * next is approved. Panes that newly enter the picker during the sequence are
 * appended to the queue.
 */
export interface RepoApprovePlansInSequencePayload {
  workspaceId: string
  repoPath: string
}

export interface RepoApprovePlansInSequenceResult {
  error: string | null
  /** How many panes were seeded into the queue at start. */
  queuedCount: number
}

/**
 * repo:stop-plan-sequence — cancel any pending approvals on the given repo.
 * The currently in-flight pane is left alone; its run continues in auto-accept
 * mode until it finishes or pauses naturally.
 */
export interface RepoStopPlanSequencePayload {
  workspaceId: string
  repoPath: string
}

export interface RepoStopPlanSequenceResult {
  error: string | null
}

/**
 * repo:retry-failed-merges — re-run the merge for every tree in a repo
 * whose last attempt left `completionActionStatus.state === 'error'`.
 *
 * Intentionally does NOT cover `'conflict'` or `'dirty-main'`: those states
 * require user interaction (Resolve-with-Claude, or cleaning up main) and
 * have their own per-pane affordances on the `CompletionActionBar`.
 */
export interface RepoRetryFailedMergesPayload {
  workspaceId: string
  repoPath: string
  strategy: MergeStrategy
}

export interface RepoRetryFailedMergesResult {
  error: string | null
  /** How many panes were kicked off for retry. */
  retriedCount: number
}

/** completion:pr-all — push & create PRs for every eligible pane in a scope */
export interface CompletionPrAllPayload {
  scope: 'workspace' | 'global'
  /** Required when scope === 'workspace' */
  workspaceId?: string
  draft: boolean
  /** When true, also persist the scope's policy to `auto-pr` / `auto-draft-pr` */
  alsoSetPolicy?: boolean
  /**
   * Optional per-repo scope. When set, only panes whose inspector groupKey
   * (parent dir of worktreePath) matches `repoPath` are eligible. Used by
   * the Kanban repo-card "Create PR" button so it only opens PRs for that
   * repo's ready trees. Mirrors CompletionMergeAllPayload.repoPath.
   */
  repoPath?: string
}

export interface CompletionPrAllResult {
  error: string | null
  /** How many panes had PRs initiated */
  enqueued: number
}

// ---------------------------------------------------------------------------
// Payload type definitions — onboarding flow
// ---------------------------------------------------------------------------

/** claude:check response */
export interface ClaudeCheckResult {
  found: boolean
  version?: string
}

/** path:validate enhanced response (isGitRepo added for onboarding) */
export interface PathValidateEnhancedResult {
  valid: boolean
  isGitRepo: boolean
  error?: string
}

/** path:git-init — run `git init` in a directory */
export interface GitInitPayload {
  path: string
}
export interface GitInitResult {
  ok: boolean
  error?: string
}

/** workspace:create-with-terminals — create a workspace and batch-spawn terminals */
export interface WorkspaceCreateWithTerminalsPayload {
  /** Single repo for all panes. Ignored (and may be '') when `repoPaths` is supplied. */
  repoPath: string
  /** Per-pane repo paths. When present, length must equal `terminalCount` and takes precedence over `repoPath`. */
  repoPaths?: string[]
  terminalCount: number
  /**
   * 'each-own'  — each terminal gets its own fresh worktree on its own branch.
   * 'shared'    — one new worktree on a shared branch, every terminal reuses it.
   * 'main'      — no worktree at all; every terminal runs in the repo root on
   *               the currently-checked-out branch (typically `main`).
   */
  worktreeMode: 'each-own' | 'shared' | 'main'
  namingMode: 'auto' | 'manual'
  manualNames?: string[]
  effort?: EffortLevel
  /** Claude model for all spawned terminals (passed via --model on spawn) */
  model?: Model
  /** Initial top-level view mode for the new workspace (Kanban v1). Defaults to 'wall' when omitted. */
  viewMode?: 'wall' | 'kanban'
  /** User-provided workspace name. Omit / empty to auto-generate "Workspace N". */
  name?: string
  /** Workspace-default publish path for the v2 turn-as-commit completion-actions
   *  flow. Per U5: required field on the launch form (defaults visible).
   *  Persisted on `Workspace.defaultPublishPath`. */
  defaultPublishPath?: PublishPath
}

/** workspace:create-with-terminals response */
export interface WorkspaceCreateWithTerminalsResult {
  error: string | null
  workspaceId?: string
  /** Per-terminal spawn errors (non-fatal; some terminals may have succeeded) */
  terminalErrors?: string[]
}

/**
 * workspace:add-terminals — batch-spawn N terminals into an existing workspace.
 *
 * Same payload shape as WORKSPACE_CREATE_WITH_TERMINALS minus the workspace-
 * creation fields: no `name`, no `viewMode`. The handler resolves the bound
 * BrowserWindow for `workspaceId` and spawns into it.
 */
export interface WorkspaceAddTerminalsPayload {
  workspaceId: string
  /** Single repo for all panes. Ignored (and may be '') when `repoPaths` is supplied. */
  repoPath: string
  /** Per-pane repo paths. When present, length must equal `terminalCount` and takes precedence over `repoPath`. */
  repoPaths?: string[]
  terminalCount: number
  /** See WorkspaceCreateWithTerminalsPayload.worktreeMode for semantics. */
  worktreeMode: 'each-own' | 'shared' | 'main'
  namingMode: 'auto' | 'manual'
  manualNames?: string[]
  effort?: EffortLevel
  /** Claude model for all spawned terminals (passed via --model on spawn) */
  model?: Model
}

/** workspace:add-terminals response */
export interface WorkspaceAddTerminalsResult {
  error: string | null
  /** Per-terminal spawn errors (non-fatal; some terminals may have succeeded) */
  terminalErrors?: string[]
}

/**
 * workspace:initial-spawn-begin — main signals the workspace window that the
 * batch-spawn loop is about to run for `expectedCount` panes. The renderer
 * mounts a covering overlay so the user sees one calm "we're launching your
 * agents" surface instead of watching panes trickle in.
 */
export interface WorkspaceInitialSpawnBeginPayload {
  workspaceId: string
  expectedCount: number
}

/**
 * workspace:initial-spawn-complete — main signals that the batch-spawn loop
 * has finished. `activePaneId` is the id of the last successfully spawned
 * pane; the renderer asserts it as the active pane (Kanban bottom region) and
 * uses this signal as one of the gates for dismissing the overlay.
 *
 * `activePaneId` is null only if every spawn in the batch failed.
 */
export interface WorkspaceInitialSpawnCompletePayload {
  workspaceId: string
  activePaneId: string | null
}

/** workspace:resume-last response */
export interface WorkspaceResumeLastResult {
  error: string | null
  workspaceId?: string
}

/** open:external payload */
export interface OpenExternalPayload {
  url: string
}

/** workspace:reveal-path payload — show a path in the OS file manager */
export interface WorkspaceRevealPathPayload {
  path: string
}

/** workspace:reveal-path response */
export interface WorkspaceRevealPathResult {
  ok: boolean
  error?: string
}

/**
 * workspace:set-view-mode — flip a workspace between Wall and Kanban.
 * Persisted on the Workspace; survives close/reopen.
 */
export interface WorkspaceSetViewModePayload {
  workspaceId: string
  viewMode: 'wall' | 'kanban'
}

export interface WorkspaceSetViewModeResult {
  error: string | null
}

/**
 * workspace:set-active-pane — mark which pane is currently focused in Kanban
 * mode. `paneId: null` clears the selection.
 */
export interface WorkspaceSetActivePanePayload {
  workspaceId: string
  paneId: string | null
}

export interface WorkspaceSetActivePaneResult {
  error: string | null
}

/**
 * workspace:focus-pane — main pushes this to a workspace window when the
 * user clicks a per-terminal Open button in the management view. The
 * workspace window switches its active pane to the given id (same code
 * path the kanban click takes), and main focuses the window separately.
 */
export interface WorkspaceFocusPanePayload {
  paneId: string
}

// ---------------------------------------------------------------------------
// Payload type definitions — app config
// ---------------------------------------------------------------------------

/** app-config:set — partial patch merged on top of current config */
export type AppConfigSetPayload = Partial<AppConfig>

/** app-config:changed — broadcast to all windows whenever the config changes */
export interface AppConfigChangedPayload {
  config: AppConfig
}

// ---------------------------------------------------------------------------
// Payload type definitions — workspace keeper
// ---------------------------------------------------------------------------

/** workspace-keeper:get-summary — fetch current summary for a workspace on drawer open */
export interface InspectorGetSummaryPayload {
  workspaceId: string
}

export interface InspectorGetSummaryResult {
  summary: WorkspaceSummary | null
}

/** workspace-keeper:ask-llm — one-shot natural-language report request */
export interface InspectorAskLlmPayload {
  workspaceId: string
}

export interface InspectorAskLlmResult {
  report: InspectorReport
}

/** workspace-keeper:summary — main → renderer broadcast of fresh summary */
export type InspectorSummaryPayload = WorkspaceSummary

// ---------------------------------------------------------------------------
// Payload type definitions — Kanban dirty-main resolution
// ---------------------------------------------------------------------------

/**
 * git:commit-dirty-main — stage the filtered dirty-main files and commit them
 * on the repo's current branch with the given message.
 *
 * `repoPath` is the absolute repo root surfaced in DirtyMainContext.path.
 * `files` mirrors the filtered set the renderer displayed — the handler
 * re-applies the Claudinha-infrastructure filter so .worktrees/ and .claude/
 * can never sneak in, even if the renderer passes them.
 */
export interface GitCommitDirtyMainPayload {
  repoPath: string
  message: string
  files: string[]
}

export interface GitCommitDirtyMainResult {
  error: string | null
}

/**
 * git:stash-dirty-main — stash the filtered dirty-main files (including
 * untracked) with the given message.
 */
export interface GitStashDirtyMainPayload {
  repoPath: string
  message: string
  files: string[]
}

export interface GitStashDirtyMainResult {
  error: string | null
}

/**
 * git:discard-dirty-main — DESTRUCTIVE. Reverts tracked modifications and
 * removes untracked files/directories in the filtered set. The handler parses
 * porcelain codes to route tracked vs untracked per file.
 */
export interface GitDiscardDirtyMainPayload {
  repoPath: string
  files: string[]
}

export interface GitDiscardDirtyMainResult {
  error: string | null
}

// ---------------------------------------------------------------------------
// ChangesReadyModal commit-message tooling
// ---------------------------------------------------------------------------

/**
 * git:commit-all — stage every change in the pane's worktree and commit with
 * the supplied message. Empty trees succeed silently (the existing
 * gitCommitAll swallows "nothing to commit").
 */
export interface GitCommitAllPayload {
  paneId: string
  message: string
}

export interface GitCommitAllResult {
  error: string | null
}

/**
 * git:pane-commit-log — list of commits between upstream (or base) and HEAD
 * for the given pane. Used by ChangesReadyModal's commit list. Capped at
 * MAX_COMMITS in the handler to keep rendering bounded.
 *
 * `pushed` is true when the commit is reachable from `origin/<branch>` —
 * editing it would require a force-push and is therefore disallowed by the
 * reword handler.
 */
export interface GitPaneCommitLogPayload {
  paneId: string
}

export interface CommitInfo {
  sha: string
  shortSha: string
  subject: string
  body: string
  pushed: boolean
}

export interface GitPaneCommitLogResult {
  error: string | null
  commits: CommitInfo[]
}

/**
 * git:reword-commit — rewrite a single commit's message. Refuses if:
 *   - the commit is already reachable from the branch's upstream (would
 *     require force-push)
 *   - the worktree is dirty (rebase/amend would conflict with pending changes)
 * For the tip commit uses `git commit --amend -m`; for older commits uses a
 * non-interactive rebase via GIT_SEQUENCE_EDITOR + GIT_EDITOR.
 */
export interface GitRewordCommitPayload {
  paneId: string
  sha: string
  message: string
}

export interface GitRewordCommitResult {
  error: string | null
}

/**
 * git:list-branches — list local branches in the pane's worktree, sorted by
 * recent commit activity (most-recent first). Feeds the merge-target picker
 * on ChangesReadyModal. `current` is included so the picker can render the
 * worktree's own branch with an "(on this)" marker rather than offering it
 * as a merge target. The picker filters `current` out of the selectable list.
 */
export interface GitListBranchesPayload {
  paneId: string
}

export interface GitListBranchesResult {
  error: string | null
  branches: string[]
  current: string | null
}

// ---------------------------------------------------------------------------
// Completion Actions v2 — Turn payload types
// ---------------------------------------------------------------------------

/** main → renderer broadcast: a new wip-commit landed for a pane. */
export interface TurnRecordedPayload {
  paneId: string
  turn: Turn
}

/** main → renderer broadcast: full turn projection refresh for a pane. */
export interface TurnsUpdatedPayload {
  paneId: string
  turns: Turn[]
  pendingAction: TurnPendingAction | null
  /** Per-session auto-commit toggle. */
  autoCommitEnabled: boolean
}

/** main → renderer broadcast: pendingAction transition for a pane. */
export interface TurnPendingActionPayload {
  paneId: string
  pendingAction: TurnPendingAction | null
}

/** renderer → main invoke: fetch the current turn projection for a pane. */
export interface TurnsGetPayload {
  paneId: string
}

/**
 * Diagnostic context the renderer surfaces in the empty-state UI when no
 * turns are present. Helps users understand WHY auto-commit isn't producing
 * turns — the most common reasons are: pane isn't a worktree, currently on
 * the base branch (worktree branch == main), or branch detection failed.
 */
export interface TurnsBranchDiagnostic {
  isWorktree: boolean
  currentBranch: string | null
  baseBranch: string | null
  /** Reason the last `turn-recorder.handleStop` skipped, if any. Populated
   *  by main and read by the modal's empty state. */
  lastSkipReason?: string | null
}

export interface TurnsGetResult {
  error: string | null
  turns: Turn[]
  pendingAction: TurnPendingAction | null
  autoCommitEnabled: boolean
  diagnostic?: TurnsBranchDiagnostic
}

/** renderer → main invoke: squash + publish via the chosen path. */
export interface TurnPublishSquashPayload {
  paneId: string
  /** Turn IDs in display order; must be contiguous on the worktree branch. */
  turnIds: string[]
  /** Final commit message for the squashed publish-commit. */
  message: string
  /** Which path to run after the squash. */
  path: 'push-branch' | 'direct-merge' | 'pr' | 'draft-pr'
}

/** renderer → main invoke: publish each selected turn as its own publish-commit. */
export interface TurnPublishIndividualPayload {
  paneId: string
  turnIds: string[]
  path: 'push-branch' | 'direct-merge' | 'pr' | 'draft-pr'
}

/** Selection of hunks for a split — file path + indexes within `git diff`. */
export interface HunkSelection {
  file: string
  /** 0-indexed hunk indexes that go to the LEFT (first) commit. The
   *  REST of the file's hunks go to the RIGHT (second) commit. */
  leftHunkIndexes: number[]
}

/**
 * One file's worth of diff broken into hunks for the HunkPickerModal.
 * Each `Hunk.diff` is the raw unified-diff text for that hunk only —
 * the modal shows it; the engine concatenates `fileHeader` + selected
 * hunk diffs back into a valid patch for `git apply --cached`.
 */
export interface TurnDiffFile {
  /** Repo-relative path of the file (`b/<path>` minus the `b/` prefix). */
  path: string
  /** The four header lines for the file: `diff --git`, `index`, `---`,
   *  `+++`. Reconstructed when applying a sub-patch. */
  fileHeader: string
  hunks: Hunk[]
}

export interface Hunk {
  /** 0-indexed position within `TurnDiffFile.hunks`. */
  index: number
  /** The `@@ -X,Y +A,B @@` header line. */
  header: string
  /** The hunk body — every line after the header up to (not including)
   *  the next `@@` line or the next `diff --git`. Includes context,
   *  `-` removed, and `+` added lines. */
  body: string
  /** Quick-glance counts for the modal's "+5 -2" caption. */
  additions: number
  deletions: number
}

export interface TurnGetDiffPayload {
  paneId: string
  turnId: string
}

export interface TurnGetDiffResult {
  error: string | null
  files: TurnDiffFile[]
}

export interface TurnSplitPayload {
  paneId: string
  turnId: string
  hunkSelections: HunkSelection[]
  leftMessage: string
  rightMessage: string
}

export interface TurnDiscardPayload {
  paneId: string
  turnId: string
  /** Set true to confirm cascading discard of dependent turns. */
  cascadeConfirmed: boolean
}

export interface TurnAutoCommitTogglePayload {
  paneId: string
  enabled: boolean
}

/** Generic IPC result envelope for the turn actions. */
export interface TurnActionResult {
  error: string | null
  /** Optional warnings that aren't blocking errors. */
  warnings?: string[]
  /** When discard requires cascade, the dependent turn IDs are returned
   *  so the renderer can re-prompt with `cascadeConfirmed=true`. */
  dependentTurnIds?: string[]
}

// ---------------------------------------------------------------------------
// Publish-path config payloads
// ---------------------------------------------------------------------------

export interface RepoPublishPathGetPayload {
  repoPath: string
}

export interface RepoPublishPathGetResult {
  error: string | null
  /** Resolved value (workspace default if no per-repo override). */
  value: PublishPath
  /** True if a per-repo override is set. */
  hasOverride: boolean
}

export interface RepoPublishPathSetPayload {
  workspaceId: string
  repoPath: string
  /** Pass null to clear the per-repo override and inherit the workspace default. */
  value: PublishPath | null
}

export interface WorkspaceDefaultPathGetPayload {
  workspaceId: string
}

export interface WorkspaceDefaultPathGetResult {
  error: string | null
  value: PublishPath
}

export interface WorkspaceDefaultPathSetPayload {
  workspaceId: string
  value: PublishPath
}

// ---------------------------------------------------------------------------
// Repo-level aggregation (M5 RepoChangesModal)
// ---------------------------------------------------------------------------

export interface RepoTurnsGetPayload {
  /** Identifies the repo by the absolute path the kanban surfaces use
   *  (`PaneState.repoPath`). The aggregation collects every pane in the
   *  workspace that resolves to this repo. */
  repoPath: string
  workspaceId: string
}

/** One pane's slice of the per-repo aggregation. The renderer renders one
 *  section per entry, mostly the same UX as the per-terminal TurnsModal. */
export interface RepoPaneTurns {
  paneId: string
  paneName: string
  worktreeName: string
  /** Branch the pane is on. May equal baseBranch for main-mode panes. */
  currentBranch: string | null
  baseBranch: string | null
  isWorktree: boolean
  autoCommitEnabled: boolean
  pendingAction: TurnPendingAction | null
  turns: Turn[]
  /** Diagnostic when `turns` is empty (helps the user understand why). */
  diagnostic?: TurnsBranchDiagnostic
}

export interface RepoTurnsGetResult {
  error: string | null
  /** Resolved repo label for header display. */
  repoLabel: string
  /** Per-pane sections, ordered by pane creation time (stable for
   *  keyboard nav). Empty array is OK and means "no panes in this repo
   *  have any turns or active state to surface." */
  panes: RepoPaneTurns[]
  /** Resolved publish-path for the repo (workspace default if no
   *  per-repo override). Drives the bulk-actions enablement. */
  publishPath: PublishPath
}

// ---------------------------------------------------------------------------
// Bulk action payloads
// ---------------------------------------------------------------------------

export type BulkActionKind =
  | 'push-branch'
  | 'merge'           // direct-merge via side-clone
  | 'open-pr'         // gh pr create
  | 'open-draft-pr'
  | 'discard-all'

export interface BulkRunPayload {
  repoPath: string
  workspaceId: string
  paneIds: string[]
  action: BulkActionKind
}

/** Per-pane outcome of one step in a bulk run. */
export interface BulkActionResult {
  paneId: string
  ok: boolean
  /** Error category for routing in the multi-conflict modal. */
  errorKind?: 'conflict' | 'gh-rate-limit' | 'gh-auth' | 'push-rejected' | 'unknown'
  errorMessage?: string
  /** Populated on success when the action produced a URL (PR opened). */
  resultUrl?: string
}

export interface BulkProgressPayload {
  runId: string
  paneId: string
  result: BulkActionResult
  completed: number
  total: number
}

export interface BulkCompletedPayload {
  runId: string
  results: BulkActionResult[]
}

export interface BulkCancelPayload {
  runId: string
}

export interface BulkRunResult {
  error: string | null
  /** UUID for the run; used to correlate progress / cancel events. */
  runId?: string
}

/** Per-row choice in the multi-conflict modal. */
export type ConflictResolution =
  | { kind: 'manual' }            // user resolves locally; no IPC action
  | { kind: 'punt-to-claude' }   // resume the agent with a "you have a conflict" prompt
  | { kind: 'discard' }            // drop the conflicting work entirely

export interface MergeConflictResolvePayload {
  paneId: string
  resolution: ConflictResolution
}

export interface MergeConflictResolveResult {
  error: string | null
}
