/**
 * Shared TypeScript types used by both the main process and renderer process.
 * These definitions match the PRD data models exactly (PRD v1.2, Data Models section).
 *
 * NOTE: Map<> types (ToolUsageSummary, AppState.panes) do not serialize over
 * IPC JSON natively. IPC payloads use plain objects; Map<> is the in-memory
 * representation. Conversion points are handled in the IPC layer.
 */

// ---------------------------------------------------------------------------
// WorkspaceType — the constraint model for a workspace
// ---------------------------------------------------------------------------

export type WorkspaceType = 'general' | 'repo' | 'worktree-branch'

// ---------------------------------------------------------------------------
// WorkspaceStatus — lifecycle status of a workspace
// ---------------------------------------------------------------------------

export type WorkspaceStatus = 'active' | 'dormant' | 'archived'

// ---------------------------------------------------------------------------
// WorkspaceConstraint — type-specific constraint data for a workspace
// ---------------------------------------------------------------------------

export interface WorkspaceConstraint {
  /** For 'repo' and 'worktree-branch' types: the repo root path */
  repoPath?: string
  /** For 'worktree-branch' type: the specific branch name */
  branchName?: string
  /** For 'worktree-branch' type: the resolved worktree path */
  worktreePath?: string
}

// ---------------------------------------------------------------------------
// GitStatus — git working pane status for a pane's worktree
// ---------------------------------------------------------------------------

export interface GitStatus {
  /** true if there are staged, unstaged, or untracked changes */
  hasUncommittedChanges: boolean
  /** Count of modified/added/deleted files (staged + unstaged + untracked) */
  changedFileCount: number
  /** Up to `MAX_CHANGED_FILES_IN_STATUS` repo-relative paths of the user-changed
   *  files, sorted lexicographically. Filtered the same way as `changedFileCount`
   *  (Claudinha infrastructure paths excluded). The renderer uses this to show
   *  the user *which* files were touched, not just a count. Capped to keep the
   *  IPC payload bounded; the full count remains in `changedFileCount`. */
  changedFiles: string[]
  /** Number of commits ahead of main/master */
  commitsAhead: number
  /** Number of commits the local base branch (main/master) has ahead of
   *  origin/<base>. Drives the "↑N to push" pill on changes-ready tiles
   *  after a local merge. Null when no remote tracking ref exists. */
  baseBranchAheadOfRemote: number | null
  /** Current branch name */
  branchName: string | null
}

// ---------------------------------------------------------------------------
// PaneCloseAction — unified close actions used by PaneCloseConfirmModal and
// the workspace-close sequence. No auto-commit is implied by any of these —
// uncommitted work stays with the worktree (keep-close) or is destroyed
// (prune-close, which surfaces a warning when uncommitted files exist).
// merge-close routes through the existing merge machinery, which commits
// internally as part of merging.
// ---------------------------------------------------------------------------

export type PaneCloseAction =
  | 'keep-close'        // worktree pane: close, keep worktree dir (+ any dirty state) on disk
  | 'prune-close'       // worktree pane: close, git worktree remove (destroys uncommitted work)
  | 'merge-close'       // worktree pane: merge into base branch, then close on success
  | 'close-non-worktree' // non-worktree pane: plain pane close (no git ops available)

// ---------------------------------------------------------------------------
// TerminalSnapshot — captures terminal state when a workspace is deactivated or a terminal closes
// ---------------------------------------------------------------------------

export interface TerminalSnapshot {
  /** Original pane ID */
  paneId: string
  /** Claude Code session_id (for resume) */
  sessionId: string | null
  /** Absolute filesystem path */
  worktreePath: string
  /** Display name of the repository */
  repoName: string
  /** Display name of the worktree */
  worktreeName: string
  /** AI-generated session title */
  sessionTitle: string | null
  /** true = terminal was running when workspace closed; false = already completed/closed by user */
  wasActiveAtClose: boolean
  /** Epoch ms when snapshot was taken */
  snapshotAt: number
  /** Git status at snapshot time */
  gitStatus?: GitStatus | null
  /**
   * Terminal completion action recorded at close time (Phase 4). Helps the
   * dormant terminals panel surface merged/PR'd terminals distinctly from terminals
   * the user closed manually.
   */
  completionAction?: 'merged' | 'pr-created' | 'manual-close'
  /** URL of the PR created for this terminal (when completionAction === 'pr-created') */
  prUrl?: string
  /** User-set rename captured at close so dormant cards keep the kanban-set name */
  userName?: string | null
  /** First user message extracted from the JSONL transcript at close time */
  initialPrompt?: string | null
}

// ---------------------------------------------------------------------------
// Workspace — a window-level grouping of terminals with optional type constraints
// ---------------------------------------------------------------------------

export interface Workspace {
  /** Unique workspace identifier (uuid) */
  id: string
  /** Display name (editable; defaults to `Workspace ${workspaceNumber}`) */
  name: string
  /**
   * Persistent ordinal assigned at creation. Monotonically increasing across
   * the application's lifetime; never reused. Used to compute the default
   * name and to provide stable ordering in the transplant picker.
   */
  workspaceNumber: number
  /** Workspace type determining spawn constraints */
  type: WorkspaceType
  /** Type-specific constraint data */
  constraint: WorkspaceConstraint
  /** Lifecycle status */
  status: WorkspaceStatus
  /** BrowserWindow ID when active, null when dormant */
  windowId: string | null
  /** Pane IDs of currently running terminals */
  activePaneIds: string[]
  /** Snapshots of all dormant terminals from this workspace's lifetime */
  pausedTerminals: TerminalSnapshot[]
  /** Epoch ms when workspace was created */
  createdAt: number
  /** Epoch ms when workspace was last active */
  lastActiveAt: number
  /**
   * @deprecated Replaced by the v2 turn-as-commit model. Kept on the type
   * as optional so legacy persisted JSONs don't fail to deserialize before
   * the M0 migration strips them. Do not read from this field in new code.
   */
  completionPolicy?: CompletionPolicy | null
  /**
   * Default publish path for repos opened in this workspace. The user
   * picks this at workspace creation (per U5: required field, defaults
   * visible). Each repo can override via per-repo Publish-path config.
   * Optional during M0 transition; M4 tightens to required.
   */
  defaultPublishPath?: PublishPath
  /**
   * Per-repo Publish-path overrides. Map repoPath → PublishPath. Absent
   * means inherit `defaultPublishPath`.
   */
  publishPathOverrides?: Record<string, PublishPath>
  /**
   * Top-level view mode the workspace window uses to render its terminals.
   * `'wall'` tiles every active pane via PaneGrid; `'kanban'` renders a status
   * board at the top with a single active terminal below. Optional for
   * forward-compat — workspaces saved before this field was added default to
   * `'wall'` when read back.
   */
  viewMode?: 'wall' | 'kanban'
  /**
   * In Kanban view, which pane is currently rendered in the active-terminal
   * region. `null` means no selection yet (first pane is auto-selected on
   * mount). Ignored in Wall mode. Optional for forward-compat.
   */
  activePaneId?: string | null
}

// ---------------------------------------------------------------------------
// RendererWorkspace — serializable workspace data for the renderer process
// ---------------------------------------------------------------------------

export interface RendererWorkspace {
  id: string
  name: string
  workspaceNumber: number
  type: WorkspaceType
  constraint: WorkspaceConstraint
  status: WorkspaceStatus
  activePaneCount: number
  /**
   * Per-pane snapshot of every currently-running terminal in this workspace.
   * Empty for dormant/archived workspaces. Mirrors the dormant TerminalSnapshot's
   * render contract so the management view renders both states symmetrically.
   */
  activePanes: ActivePaneSummary[]
  pausedTerminals: TerminalSnapshot[]
  /** Epoch ms of the most recent activity in this workspace — used for sort + "Xm ago" display */
  lastActiveAt: number
  /**
   * @deprecated v2 turn-as-commit replaces this. Kept on the type for
   * backward-compat with persisted JSONs until the M0 migration runs.
   */
  completionPolicy?: CompletionPolicy | null
  /** Default publish path for the workspace (set at launch per U5). */
  defaultPublishPath?: PublishPath
  /** Per-repo Publish-path overrides; absent → inherit defaultPublishPath. */
  publishPathOverrides?: Record<string, PublishPath>
  /** Current view mode (wall | kanban). Absent in legacy payloads; defaults to 'wall'. */
  viewMode?: 'wall' | 'kanban'
}

/**
 * Per-pane snapshot the management window needs to render an active workspace's
 * terminal cards. Captures only what the card surface needs: identity, name
 * inputs (forwarded into resolvePaneDisplayName), live status + tool, and the
 * starting prompt.
 */
export interface ActivePaneSummary {
  paneId: string
  repoName: string
  worktreeName: string
  userName: string | null
  sessionTitle: string | null
  status: PaneStatus
  activeToolName: string | null
  initialPrompt: string | null
  /** Last activity time (epoch ms). Tracks PaneState.statusChangedAt so the
   *  Launcher sidebar's expanded card can show "active 3m ago" / "idle 12m"
   *  next to each agent row. */
  lastActiveAt: number
}

// ---------------------------------------------------------------------------
// PaneStatus
// ---------------------------------------------------------------------------

/**
 * PaneStatus — the lifecycle bucket a pane sits in on the Kanban board.
 *
 * `'changes-ready'` replaces the old `'done'` status: a pane lands here when
 * its agent has stopped and the worktree has uncommitted edits or commits
 * ahead of base. A stop with a clean tree routes to `'needs-input'` instead.
 *
 * `'planning'` and `'plan-ready'` are first-class statuses — `'planning'`
 * while Claude is in plan mode but hasn't yet called `ExitPlanMode`,
 * `'plan-ready'` once it has and the user is being asked to approve.
 *
 * Errors are no longer a status of their own. Crashed PTYs are signalled via
 * `PaneState.terminated`; transient action errors live on
 * `completionActionStatus.state === 'error'`. Both are rendered as a red
 * border on whichever column the pane currently sits in.
 */
export type PaneStatus =
  | 'awaiting-prompt'
  | 'planning'
  | 'plan-ready'
  | 'needs-input'
  | 'working'
  | 'changes-ready'

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Claude model alias passed to `claude --model`. The CLI accepts the simple
 * tier names and resolves them to the latest version of each tier — so
 * `'opus'` always maps to the current Opus, `'sonnet'` to the current Sonnet,
 * etc. We deliberately use aliases rather than full IDs (`claude-opus-4-6`)
 * so this code doesn't need updating each time a new minor version ships.
 */
export type Model = 'haiku' | 'sonnet' | 'opus'

// ---------------------------------------------------------------------------
// ToolUsageSummary
// ---------------------------------------------------------------------------

/**
 * Tool usage tracked as a map of tool name → call count.
 * Only tools that have been used at least once are present.
 * Keys are canonical Claude Code tool names (e.g. "Read", "Edit", "Bash",
 * "Glob", "Grep", "Write", "MultiEdit", "WebFetch", "Task", or MCP tool names).
 */
export type ToolUsageSummary = Map<string, number>

// ---------------------------------------------------------------------------
// PaneMetrics
// ---------------------------------------------------------------------------

export interface PaneMetrics {
  // From JSONL transcript parsing
  totalTokens: number | null // sum of input + output tokens across all turns
  contextPercent: number | null // estimated context window usage %
  toolsUsed: ToolUsageSummary | null // tool call counts

  // From Claude Code statusline JSON
  totalCostUsd: number | null // total session cost (display only if isApiBilling)
  durationMs: number | null // total session duration
  modelDisplayName: string | null // e.g. "Sonnet 4.6"
  linesAdded: number | null // total lines added
  linesRemoved: number | null // total lines removed

  // From JSONL transcript (PE-04)
  /** AI-generated session title — Claude's `ai-title` JSONL entry (prose, e.g. "Add a story"). */
  sessionTitle: string | null
  /** Per-session agent name — Claude's `agent-name` JSONL entry (kebab-case, e.g. "add-people-stories-folder"). */
  agentName: string | null
  /** First user message extracted from the JSONL transcript (used as the dormant card subtitle) */
  initialPrompt: string | null
  /** Most recent message (user or assistant) extracted from the JSONL transcript — used as the rail card subtitle. */
  lastMessage: string | null
}

// ---------------------------------------------------------------------------
// Completion Actions v2 — turn-as-commit model (Option B)
// ---------------------------------------------------------------------------
//
// Each agent turn auto-commits as a `wip(turn-N)` commit on the worktree
// branch. The user surfaces, picks turns, and publishes them via
// squash / individual / split. State is *derived from git*, not persisted
// separately — the source of truth is `git log <base>..<worktree-branch>`
// plus a sidecar for discarded-turn telemetry.
//
// Lifecycle (see docs/implementation-plan-completion-actions.md §4):
//
//   open ──► pushed ──► pr-open ──► merged ──► shipped
//      └─► superseded     (split absorbed this commit)
//      └─► discarded      (user dropped this commit)

export type TurnState =
  | 'open'         // wip-commit on worktree branch, no publish action yet
  | 'pushed'       // worktree branch pushed to origin (PR-able)
  | 'pr-open'      // PR exists for the publish commit derived from this turn
  | 'merged'       // publish commit is on base branch locally
  | 'shipped'      // base branch is on origin (terminal "done" state)
  | 'superseded'   // a later split/squash absorbed this turn-commit
  | 'discarded'    // explicitly dropped by the user

/**
 * In-flight async action against a turn (or set of turns). Renderer reads
 * this to disable surfaces while the action runs; main clears it on
 * completion. Mutually exclusive — at most one pending action per pane.
 */
export type TurnPendingAction =
  | { kind: 'publishing-squash'; selectedTurnIds: string[] }
  | { kind: 'publishing-individual'; selectedTurnIds: string[] }
  | { kind: 'splitting'; turnId: string }
  | { kind: 'discarding'; turnId: string }
  | { kind: 'merging'; selectedTurnIds: string[] }
  | { kind: 'opening-pr'; selectedTurnIds: string[] }

export interface Turn {
  /** Stable UUID generated when the wip-commit is created. */
  id: string
  paneId: string
  /**
   * Sequential display number; renumbers on discard so the UI shows a
   * tidy 1..N sequence. The stable identity is `id`, not `index`.
   */
  index: number
  /** wip-commit sha on the worktree branch. */
  commitSha: string
  parentCommitSha: string
  /** Haiku one-liner describing the turn's diff. */
  summary: string
  filesChanged: number
  additions: number
  deletions: number
  /** Epoch ms of the wip-commit's author timestamp. */
  createdAt: number
  state: TurnState
  /** Sha of the publish-commit derived from this turn (after squash/individual). */
  publishCommitSha: string | null
  /** GitHub PR URL (after PR creation). */
  prUrl: string | null
}

/**
 * Publish-path configuration. The user picks a workspace-wide default at
 * launch (per U5: required field, defaults visible). Each repo can
 * override the default.
 *
 *   `direct-merge` — merge into base via side-clone, push base to origin
 *   `pr`           — push branch + `gh pr create`
 *   `both`         — surface both affordances; user picks per-action
 */
export type PublishPath = 'direct-merge' | 'pr' | 'both'

export interface PublishPathConfig {
  scope: 'workspace' | 'repo'
  value: PublishPath
}

/**
 * Per-pane sidecar — records turns the user explicitly discarded so the
 * UI can warn ("you discarded N turns; reflog has them") and telemetry
 * can attribute the action. Persisted at
 * `<worktreePath>/.claudinha-turns.json`.
 */
export interface DiscardedTurnsSidecar {
  version: 1
  /** UUID → minimal record. Keyed by Turn.id. */
  discarded: Record<string, {
    /** Sha at the time of discard (the blob is gone from log but reflog has it). */
    commitSha: string
    /** Epoch ms when discarded. */
    discardedAt: number
    /** Original sequential number when discarded — for the audit trail. */
    originalIndex: number
    /** Turns that absorbed this one via split (if any). */
    supersededBy?: string[]
  }>
}

// ---------------------------------------------------------------------------
// Completion Actions v1 — LEGACY merge/PR flow (DEPRECATED, slated for removal)
// ---------------------------------------------------------------------------
//
// Kept as compile-time shims while the v2 turn-based model rolls out and
// existing references are migrated. Do not extend; do not introduce new
// usage. Scheduled for deletion at the end of M0 once every reference has
// been migrated.

export type CompletionActionState =
  | 'ready'
  | 'queued'
  | 'rebasing'
  | 'merging'
  | 'conflict'
  | 'pushing'
  | 'merged'
  | 'pr-created'
  | 'error'
  | 'dirty-main'

/**
 * Extra context carried on a `dirty-main` status so the renderer can show
 * which files are blocking the merge and offer a Reveal-in-Finder button.
 */
export interface DirtyMainContext {
  /** Absolute path to the main repo root whose working pane is dirty. */
  path: string
  /**
   * First N changed file paths reported by `git status --porcelain`
   * (relative to `path`), excluding Claudinha's own `.claude/` entries.
   * Capped for payload size; `totalCount` is the unfiltered total.
   */
  files: string[]
  totalCount: number
}

export type MergeStrategy = 'rebase-ff' | 'squash' | 'merge-commit'

export type CompletionAction = 'ask' | 'auto-merge' | 'auto-pr' | 'auto-draft-pr'

export interface CompletionPolicy {
  action: CompletionAction
  mergeStrategy: MergeStrategy
  pruneOnMerge: boolean
}

/**
 * The app-wide default completion policy. Also exported so the renderer
 * can fall back to it before the real global policy has arrived via IPC.
 * `pruneOnMerge` is off by default so the initial launch is conservative;
 * users can opt into pruning via the policy popover.
 */
export const DEFAULT_COMPLETION_POLICY: CompletionPolicy = {
  action: 'ask',
  mergeStrategy: 'rebase-ff',
  pruneOnMerge: false
}

// ---------------------------------------------------------------------------
// AppConfig — user-facing preferences surfaced through the Configuration view
// ---------------------------------------------------------------------------

/**
 * Persistent app-wide preferences. One schema covers every setting exposed
 * through `ConfigurationView`. Partial patches via `APP_CONFIG_SET` merge on
 * top of the current config, so each UI control only sends the field it owns.
 *
 * Defaults intentionally preserve existing behavior: sounds on at the same
 * 0.4 volume that was previously hard-coded in sound.ts, auto-restore off so
 * launches stay predictable until the user opts in, and `defaultModel: null`
 * means "don't pre-select anything" (LaunchForm/SpawnDialog behave exactly as
 * they do today when null).
 */
export interface AppConfig {
  // Startup
  autoRestoreLastSession: boolean

  // Notifications / sounds
  soundsEnabled: boolean
  /** 0..1 — volume applied to every status sound */
  soundVolume: number
  soundOnNeedsInput: boolean
  soundOnDone: boolean

  // Defaults for newly spawned terminals
  /** null = no global default; LaunchForm/SpawnDialog use their own local default */
  defaultModel: Model | null

  // Pane display
  /** When true, each pane's header shows a row listing per-tool usage counts. */
  showToolCountsBar: boolean

  // Inspector drawer
  /** Persisted drawer state (open/pinned/width) shared across workspace windows. */
  inspector: InspectorConfig

  // Workspace view mode (Kanban v1)
  /**
   * Initial view mode preselected on the LaunchForm tile when the user creates
   * a new workspace. Per-workspace `Workspace.viewMode` is what actually drives
   * rendering; this is only the LaunchForm seed default.
   */
  defaultViewMode: 'wall' | 'kanban'

  // Kanban board
  /** Persisted board height in Kanban view, shared across workspace windows. */
  kanban: KanbanConfig

  // Repo rail (Kanban view)
  /** Persisted rail width + Group By choice, shared across workspace windows. */
  rail: RailConfig

  /**
   * UI theme. 'system' follows OS prefers-color-scheme (the legacy default,
   * preserved for users who never click the title-bar toggle). 'dark' / 'light'
   * are explicit user overrides set by the title-bar sun/moon button.
   */
  theme: 'dark' | 'light' | 'system'

  /**
   * UI language. 'en' (English) is the historical default; 'pt-BR' switches the
   * entire renderer (and OS menu) to Brazilian Portuguese. On true first launch
   * this is seeded from app.getLocale() so pt-BR systems start localized; once
   * stored, the user's choice is honored from then on.
   */
  language: 'en' | 'pt-BR'

  /**
   * Remembered "push to GitHub" checkbox state per repo (keyed by the inspector
   * groupKey). A user who always pushes only toggles the checkbox once; every
   * subsequent save for that repo picks up their preference.
   *
   * Kept in AppConfig rather than a separate store because v1 has exactly one
   * per-repo preference. If more accumulate post-v1, migrate to a dedicated
   * repo-preferences store.
   */
  claudeMdPushDefaults?: Record<string, boolean>
}

/**
 * Persisted drawer state for the Inspector. Shared across workspace windows so
 * opening a second workspace picks up the user's preferred width + pinning.
 *
 * - `open`: whether the drawer is visible. Toggled via the header button.
 * - `pinned`: when true, the drawer is inline and panes retile to share width.
 *   When false, the drawer overlays the pane grid without reflowing panes.
 * - `widthPx`: clamped 200..500 at the IPC boundary.
 */
export interface InspectorConfig {
  open: boolean
  pinned: boolean
  widthPx: number
}

export const DEFAULT_GROVE_KEEPER_CONFIG: InspectorConfig = {
  open: false,
  pinned: false,
  widthPx: 350
}

/**
 * Kanban board height constants.
 *
 * One "card unit" is the approximate rendered height of a single agent card
 * plus its between-card gap. Real cards range 30–40px depending on how many
 * optional rows (activity, diff footer) they show — 32 is tight enough that
 * "N cards" means "≥ N visible" in every column state. Used to express the
 * board's min / default sizes in the terms the user specified them
 * ("two cards minimum", "fits four cards by default").
 *
 * The chrome allowance covers the column header + the column's inner p-2.
 *
 * Terminal reservation reserves ~6 rows below the board so dragging the board
 * tall never buries the active terminal. The row estimate is conservative for
 * fontSize:13 Menlo so the user always sees ≥ 6 rendered rows.
 */
export const KANBAN_CARD_UNIT_PX = 32
export const KANBAN_CHROME_PX = 32
export const KANBAN_MIN_HEIGHT_PX = KANBAN_CHROME_PX + 2 * KANBAN_CARD_UNIT_PX     //  96
export const KANBAN_DEFAULT_HEIGHT_PX = KANBAN_CHROME_PX + 4 * KANBAN_CARD_UNIT_PX  // 160
export const TERMINAL_MIN_ROWS = 6
export const TERMINAL_ROW_PX = 22
export const TERMINAL_RESERVED_PX = TERMINAL_MIN_ROWS * TERMINAL_ROW_PX            // 132

/**
 * Persisted Kanban board height. Shared across workspace windows so opening a
 * second workspace picks up the user's preferred vertical split. The absolute
 * min is enforced at the IPC boundary; the absolute max is window-dependent
 * and is clamped live in the renderer during the drag.
 */
export interface KanbanConfig {
  heightPx: number
}

export const DEFAULT_KANBAN_CONFIG: KanbanConfig = {
  heightPx: KANBAN_DEFAULT_HEIGHT_PX
}

/**
 * Repo rail width + grouping. The rail lives left of the kanban board and
 * pane grid. Width is clamped at the IPC boundary by RAIL_MIN/MAX; the live
 * max is also clamped in the renderer so the pane grid keeps a usable
 * minimum (PANE_GRID_RESERVED_PX).
 */
export const RAIL_MIN_WIDTH_PX = 220
export const RAIL_MAX_WIDTH_PX = 600
export const RAIL_DEFAULT_WIDTH_PX = 280
export const PANE_GRID_RESERVED_PX = 320

export type RailGroupBy = 'repo' | 'status'

export interface RailConfig {
  widthPx: number
  groupBy: RailGroupBy
}

export const DEFAULT_RAIL_CONFIG: RailConfig = {
  widthPx: RAIL_DEFAULT_WIDTH_PX,
  groupBy: 'repo'
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  autoRestoreLastSession: false,
  soundsEnabled: true,
  soundVolume: 0.4,
  soundOnNeedsInput: true,
  soundOnDone: true,
  defaultModel: null,
  showToolCountsBar: true,
  inspector: DEFAULT_GROVE_KEEPER_CONFIG,
  defaultViewMode: 'kanban',
  kanban: DEFAULT_KANBAN_CONFIG,
  rail: DEFAULT_RAIL_CONFIG,
  theme: 'system',
  language: 'en',
  claudeMdPushDefaults: {}
}

export interface CompletionActionStatus {
  state: CompletionActionState
  /** Error message when state is 'error' */
  errorMessage?: string
  /** Queue position (1-indexed) when state is 'queued' */
  queuePosition?: number
  /** PR URL when state is 'pr-created' */
  prUrl?: string
  /** True when Claude is resuming to resolve conflicts */
  isResolvingConflict?: boolean
  /** Populated when state is 'dirty-main' so the UI can show files + reveal the path. */
  dirtyMain?: DirtyMainContext
}

// ---------------------------------------------------------------------------
// PaneState
// ---------------------------------------------------------------------------

export interface PaneState {
  id: string // unique pane identifier (uuid)
  windowId: string // which BrowserWindow this pane belongs to
  workspaceId: string // which workspace this pane belongs to
  ptyId: string // reference to node-pty process
  sessionId: string | null // Claude Code session_id (from hooks)
  transcriptPath: string | null // path to JSONL transcript (from hooks)
  contextWindowSize: number | null // context window size reported by statusline
  repoName: string // display name of the repository
  worktreeName: string // display name of the worktree
  worktreePath: string // absolute filesystem path
  status: PaneStatus // current detected status
  activeToolName: string | null // tool currently being used (when status is 'working')
  statusChangedAt: number // timestamp of last status change
  statusSource: 'hook' | 'pty-fallback' // how status was detected
  isFocused: boolean // whether this pane has focus
  hasUnseenStatusChange: boolean // true if status changed while unfocused
  isApiBilling: boolean // true if ANTHROPIC_API_KEY detected in env
  effort: EffortLevel // reasoning effort level (low/medium/high/max)
  /**
   * Claude model alias the pane is currently running. Set at spawn time from
   * the `--model` CLI flag and updated live via `/model <name>` slash command
   * (mirrors how `effort` is updated). Read by PANE_RESPAWN to pick the
   * --model flag for the new PTY so the user's choice survives a respawn.
   */
  model: Model
  metrics: PaneMetrics // usage tracking
  createdAt: number // timestamp
  /** True if the PTY exited unexpectedly; pane stays visible for respawn (B-052) */
  terminated?: boolean
  /** Git status of the worktree (polled periodically) */
  gitStatus: GitStatus | null
  /** True if pane was spawned as a worktree (new-worktree mode) */
  isWorktree: boolean
  /** Completion action status (merge/PR flow) — null when not applicable */
  completionActionStatus: CompletionActionStatus | null
  /** True when Claude is resuming to resolve merge conflicts */
  isResolvingConflict?: boolean
  /**
   * Optional user-supplied display name that overrides the auto fallback chain
   * in card / row labels. `null` = no override (falls back to agentName →
   * sessionTitle → worktreeName). Updated via PANE_SET_USER_NAME.
   */
  userName?: string | null
  /**
   * Claude Code permission mode as detected from PTY output (the `plan mode
   * on (shift+tab to cycle)` footer). Absent / `'normal'` = default. Drives
   * the Kanban card's mode badge and overrides the Stop hook so a plan that
   * ends with "Want me to proceed?" transitions to needs-input instead of
   * done.
   */
  permissionMode?: 'normal' | 'plan'
  /**
   * Per-session toggle for auto-commit on Stop. Default true. When false,
   * `turn-recorder` skips creating a wip-commit on the next Stop hook even
   * if the working tree is dirty. Optional during M0 transition.
   */
  autoCommitEnabled?: boolean
  /**
   * Synthesised projection of turns for this pane. Source of truth is git
   * itself (`git log <base>..<worktree-branch>` plus UUID trailers); this
   * field is a cache the renderer reads. M1 starts populating it.
   */
  turns?: Turn[]
  /**
   * Mutually-exclusive in-flight action. Set by main when starting an
   * action; cleared on completion or failure. Renderer disables surfaces
   * while pending. Null when idle.
   */
  pendingAction?: TurnPendingAction | null
}

// ---------------------------------------------------------------------------
// WindowState
// ---------------------------------------------------------------------------

export interface WindowState {
  id: string // BrowserWindow id
  paneIds: string[] // ordered list of pane IDs in this window
  focusedPaneId: string | null // which pane has focus
}

// ---------------------------------------------------------------------------
// AppState
// ---------------------------------------------------------------------------

export interface AppState {
  windows: WindowState[]
  panes: Map<string, PaneState>
}

// ---------------------------------------------------------------------------
// Hook event types (used by HookListener and hook → status mapping)
// ---------------------------------------------------------------------------

export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'
  | 'StopFailure'
  | 'PostCompact'

export interface HookPayload {
  hookEventName: HookEventName
  /** Injected by claudinha-hook-relay from CLAUDINHA_PANE_ID env var */
  paneId: string
  /** Available from SessionStart onward */
  session_id?: string
  /** Set on PreToolUse and PostToolUse */
  tool_name?: string
  /** Set on Stop — path to the JSONL transcript file */
  transcript_path?: string
  /** Remaining fields passed through from Claude Code hook stdin */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// PermissionOverrides — user-customized permission rules
// ---------------------------------------------------------------------------

export interface PermissionOverrides {
  allow: string[]           // user-added entries
  deny: string[]            // user-added entries
  removedAllow: string[]    // defaults the user explicitly removed
  removedDeny: string[]     // defaults the user explicitly removed
}

// ---------------------------------------------------------------------------
// SessionHistoryEntry (PE-06 — session resume support)
// ---------------------------------------------------------------------------

export interface SessionHistoryEntry {
  sessionId: string
  worktreePath: string
  repoName: string
  worktreeName: string
  sessionTitle: string | null
  completedAt: number // epoch ms
}

// ---------------------------------------------------------------------------
// Inspector — workspace-level summary, test hints, and on-demand LLM report
// ---------------------------------------------------------------------------

/**
 * One pane in a workspace as surfaced by the Inspector. Derived from a live
 * `PaneState` plus its cached diff stats vs the merge base (main/master).
 * `isReadyToMerge` is the eligibility signal the drawer uses for the
 * "Merge all ready work" button and for the ready badge in the list.
 *
 * The Keeper deliberately does NOT distinguish committed from uncommitted
 * work — Claudinha's merge flow auto-commits any working-pane edits before
 * merging, so both states are "changes ready to land." Diff stats come from
 * `git diff --numstat <base>` which unifies both.
 */
export interface ReadyPaneEntry {
  paneId: string
  paneName: string
  repoPath: string
  repoName: string
  branchName: string | null
  /** Files that differ vs the merge base (committed + working-pane). */
  filesTouched: number
  /** Total lines added in the diff vs base. Binary files contribute 0. */
  linesAdded: number
  /** Total lines removed in the diff vs base. Binary files contribute 0. */
  linesRemoved: number
  paneStatus: PaneStatus
  isReadyToMerge: boolean
  completionState: CompletionActionState | null
  /**
   * True when this pane is sitting on Claude Code's plan-approval picker —
   * `activeToolName === 'ExitPlanMode'` paired with `status === 'needs-input'`.
   * Drives the per-repo "Approve plans in sequence" button.
   */
  isAwaitingPlanApproval: boolean
  /**
   * Timestamp of the pane's most recent status change (falling back to its
   * creation time before any transition has been observed). Drives the
   * per-row "last activity" age display in the Kanban repo rail.
   */
  lastActivityAt: number
}

/**
 * Per-repo rollup for workspaces that span multiple repos (per-pane mode). For
 * single-repo workspaces the array has length 1.
 */
export interface RepoRollup {
  repoPath: string
  repoLabel: string
  paneCount: number
  totalFilesTouched: number
  totalLinesAdded: number
  totalLinesRemoved: number
  readyCount: number
  /**
   * Number of panes in this repo currently sitting on Claude Code's
   * plan-approval picker. Drives the visibility of the repo card's
   * "Approve plans in sequence" button (shown when ≥ 2).
   */
  awaitingPlanApprovalCount: number
  /**
   * True when the PlanApprovalSequencer service is actively processing a
   * queue for this repo. Drives the "Stop sequence" button label and
   * disables duplicate starts.
   */
  planSequencerRunning: boolean
  /**
   * Number of panes in this repo whose last merge attempt finished in the
   * `'error'` completion state. Drives the "Retry failed merges" button on
   * the repo card. Deliberately excludes `'conflict'` and `'dirty-main'` —
   * those have per-pane manual recovery flows (Resolve-with-Claude, reveal
   * main) and should not be auto-retried in bulk.
   */
  erroredCount: number
  /**
   * Commits the base branch is ahead of `origin/<base>`.
   *  - integer ≥ 0 when known
   *  - `null` when unknown (no remote configured, never polled, etc.)
   * Drives the Kanban repo rail's Push button enable predicate.
   */
  baseAheadOfOrigin?: number | null
}

/**
 * Heuristic test suggestion. Always-on, cheap; richer natural-language
 * guidance comes from the LLM report path instead.
 */
export interface TestHint {
  kind: 'changed-test-file' | 'adjacent-test-file' | 'package-script'
  label: string
  command?: string
  repoPath: string
  sourcePaneId?: string
}

/**
 * Cross-pane summary for a single workspace. Broadcast on every git-status poll
 * where at least one underlying field has changed, and returned from the
 * `INSPECTOR_GET_SUMMARY` pull handler when the drawer opens.
 */
export interface WorkspaceSummary {
  workspaceId: string
  generatedAt: number
  totalPanes: number
  totalFilesTouched: number
  totalLinesAdded: number
  totalLinesRemoved: number
  readyCount: number
  repos: RepoRollup[]
  panes: ReadyPaneEntry[]
  testHints: TestHint[]
}

/**
 * Natural-language summary + test plan produced by asking Claude (via
 * `claude -p`) for the current state of a workspace. Requested on demand; not
 * auto-refreshed. `error` is populated when the subprocess failed — the
 * service never throws.
 */
export interface InspectorReport {
  workspaceId: string
  generatedAt: number
  markdown: string
  error?: string
}

// ---------------------------------------------------------------------------
// Analytics consent — shared between main (persistence) and renderer (UI)
// ---------------------------------------------------------------------------

/**
 * User's analytics opt-in state. `"pending"` means no choice has been made
 * yet (first-launch default); instrumentation only fires when this is
 * `"granted"`.
 */
export type ConsentState = 'granted' | 'denied' | 'pending'
