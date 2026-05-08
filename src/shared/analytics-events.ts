// ---------------------------------------------------------------------------
// Analytics event schema (B-077)
//
// PRIVACY GUARANTEE: No event type in this file may contain PII.
// Specifically prohibited: file paths, file contents, API keys,
// repo/worktree names, user input text, session IDs, user-supplied names.
//
// All events are anonymous and identified only by a random installation ID.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Common base fields — present on every event
// ---------------------------------------------------------------------------

export interface AnalyticsEventBase {
  /** Discriminant: unique event name */
  event_name: string
  /** ISO 8601 UTC timestamp */
  timestamp: string
  /** Anonymous installation UUID (not linked to any user identity) */
  installation_id: string
  /** Semantic app version, e.g. "0.1.0" */
  app_version: string
  /** OS platform: "darwin" | "win32" | "linux" */
  platform: string
}

// ---------------------------------------------------------------------------
// Usage events — user interactions
// ---------------------------------------------------------------------------

/** A new pane was spawned */
export interface PaneSpawnedEvent extends AnalyticsEventBase {
  event_name: 'pane_spawned'
  /** "claude" | "custom" — spawn mode selected, no path info */
  spawn_mode: string
  /** Total number of panes in the window after spawn */
  pane_count: number
}

/** A pane was closed */
export interface PaneClosedEvent extends AnalyticsEventBase {
  event_name: 'pane_closed'
  /** How the pane was closed: "manual" | "menu" | "keyboard" */
  close_trigger: string
  /** Bucketed session duration, e.g. "<1m" | "1-5m" | "5-30m" | "30m-2h" | ">2h" */
  duration_bucket: string
  /** Terminal status at the moment of close, e.g. "idle" | "working" | "done" | "failed" */
  final_status: string
  /** Total panes remaining in the window after close */
  pane_count: number
}

/** A pane was moved between windows */
export interface PaneMovedEvent extends AnalyticsEventBase {
  event_name: 'pane_moved'
  /** Pane count in the source window after the move */
  source_pane_count: number
  /** Pane count in the target window after the move */
  target_pane_count: number
}

/** User selected a spawn mode from the picker */
export interface SpawnModeSelectedEvent extends AnalyticsEventBase {
  event_name: 'spawn_mode_selected'
  /** "claude" | "custom" */
  mode: string
}

/** A new window was created */
export interface WindowCreatedEvent extends AnalyticsEventBase {
  event_name: 'window_created'
  /** Total number of windows open after creation */
  window_count: number
  /** How the window was created: "startup" | "menu" | "activate" | "resume-last" | "batch-spawn" */
  trigger: string
}

/** A window was closed */
export interface WindowClosedEvent extends AnalyticsEventBase {
  event_name: 'window_closed'
  /** Number of panes that were active at close time */
  active_pane_count: number
  /** Whether the window had any active sessions at close time */
  had_active_sessions: boolean
  /** Total number of windows open after this one closed */
  window_count: number
}

/** User triggered a keyboard shortcut */
export interface KeyboardShortcutUsedEvent extends AnalyticsEventBase {
  event_name: 'keyboard_shortcut_used'
  /** Symbolic action name, e.g. "new_pane", "close_pane" — no key sequences */
  action: string
}

/** User submitted feedback */
export interface FeedbackSubmittedEvent extends AnalyticsEventBase {
  event_name: 'feedback_submitted'
  /** Bucketed character count: "0-50" | "51-200" | "201-500" | "500+" */
  length_bucket: string
  /** Symbolic feedback category, e.g. "bug" | "idea" | "other" — no free text */
  feedback_type: string
}

/** A pane was collapsed */
export interface PaneCollapsedEvent extends AnalyticsEventBase {
  event_name: 'pane_collapsed'
}

/** A pane was expanded */
export interface PaneExpandedEvent extends AnalyticsEventBase {
  event_name: 'pane_expanded'
}

// ---------------------------------------------------------------------------
// Session aggregate events — fired on pane close (B-081)
// ---------------------------------------------------------------------------

/** Aggregate session metrics — no PII, all values bucketed or rounded */
export interface SessionCompletedEvent extends AnalyticsEventBase {
  event_name: 'session_completed'
  /** Session duration in seconds, rounded to nearest 10 */
  duration_seconds_rounded: number
  /** Total tokens bucketed: "0-1k" | "1k-10k" | "10k-50k" | "50k-100k" | "100k+" */
  token_bucket: string
  /** Cost bucket in USD: "<0.01" | "0.01-0.10" | "0.10-1.00" | "1.00-5.00" | "5.00+" */
  cost_bucket: string
  /** Number of distinct tools used */
  tool_count: number
  /** Exit reason: "done" | "terminated" | "crashed" | "unknown" */
  exit_reason: string
  /** Bucketed duration: "<1m" | "1-5m" | "5-30m" | "30m-2h" | ">2h" */
  duration_bucket: string
  /** Terminal status at session close, e.g. "done" | "failed" | "idle" */
  final_status: string
  /** Spawn mode recorded at spawn: "claude" | "custom" | "unknown" */
  spawn_mode: string
  /** Total tool invocations across all tools (sum, not distinct count) */
  tool_invocations: number
  /** Source of status inference: "hook" | "pty-fallback" */
  status_source: string
  /** Whether the session used API billing (vs subscription) */
  is_api_billing: boolean
  /** Rounded context-window fill percentage at close, or null if unknown */
  context_percent: number | null
}

// ---------------------------------------------------------------------------
// Performance events
// ---------------------------------------------------------------------------

/** Time from app start to first window ready */
export interface AppLaunchedEvent extends AnalyticsEventBase {
  event_name: 'app_launched'
  /** Time to first window in milliseconds */
  time_to_first_window_ms: number
}

/** PTY process spawn latency */
export interface PtySpawnedEvent extends AnalyticsEventBase {
  event_name: 'pty_spawned'
  /** Spawn latency in milliseconds */
  spawn_latency_ms: number
}

/** Periodic memory usage snapshot */
export interface MemorySnapshotEvent extends AnalyticsEventBase {
  event_name: 'memory_snapshot'
  /** Heap used in MB, rounded to nearest MB */
  heap_used_mb: number
  /** External memory in MB, rounded to nearest MB */
  external_mb: number
  /** Number of open panes at snapshot time */
  pane_count: number
}

// ---------------------------------------------------------------------------
// Error events
// ---------------------------------------------------------------------------

/** Unhandled exception or rejection in main process */
export interface UnhandledErrorEvent extends AnalyticsEventBase {
  event_name: 'unhandled_error'
  /** Error class name only — no message (may contain PII) */
  error_type: string
  /** "main" | "renderer" */
  process: string
}

/** PTY process crashed unexpectedly */
export interface PtyCrashedEvent extends AnalyticsEventBase {
  event_name: 'pty_crashed'
  /** Exit code, if available */
  exit_code: number | null
  /** Bucketed pane age at crash: "<1m" | "1-10m" | "10m+" */
  pane_age_bucket: string
}

/** Claude Code hook event processing failure */
export interface HookFailureEvent extends AnalyticsEventBase {
  event_name: 'hook_failure'
  /** Hook event type that failed, e.g. "PreToolUse" */
  hook_event_type: string
}

/** Status fallback timer activated (hook event not received) */
export interface FallbackActivatedEvent extends AnalyticsEventBase {
  event_name: 'fallback_activated'
}

/** Error merging Claude settings files */
export interface SettingsMergeErrorEvent extends AnalyticsEventBase {
  event_name: 'settings_merge_error'
  /** Error class name only */
  error_type: string
}

// ---------------------------------------------------------------------------
// System events — fired once per app launch
// ---------------------------------------------------------------------------

/** App session started — basic environment context */
export interface AppSessionStartedEvent extends AnalyticsEventBase {
  event_name: 'app_session_started'
  /** Electron version */
  electron_version: string
  /** Node.js version */
  node_version: string
  /** Chrome version (Electron's renderer engine) */
  chrome_version: string
}

// ---------------------------------------------------------------------------
// Workspace lifecycle events
// ---------------------------------------------------------------------------

/** A workspace was created (any type) */
export interface WorkspaceCreatedEvent extends AnalyticsEventBase {
  event_name: 'workspace_created'
  /** WorkspaceType enum: "general" | "repo" | "worktree-branch" */
  workspace_type: string
  /** Total non-archived workspaces after creation */
  workspace_count: number
}

/** A workspace was archived (soft-delete) */
export interface WorkspaceArchivedEvent extends AnalyticsEventBase {
  event_name: 'workspace_archived'
  workspace_type: string
  /** Total archived workspaces after archive */
  archived_count: number
}

/** A previously archived workspace was restored */
export interface WorkspaceUnarchivedEvent extends AnalyticsEventBase {
  event_name: 'workspace_unarchived'
  workspace_type: string
}

/** An archived workspace was permanently deleted */
export interface WorkspaceDeletedArchivedEvent extends AnalyticsEventBase {
  event_name: 'workspace_deleted_archived'
  workspace_type: string
}

// ---------------------------------------------------------------------------
// Completion events (merge queue + PR outcomes)
// ---------------------------------------------------------------------------

/** A completion attempt finished with a terminal outcome */
export interface MergeCompletedEvent extends AnalyticsEventBase {
  event_name: 'merge_completed'
  /** "succeeded" | "failed" | "paused_conflict" | "aborted" */
  outcome: string
  /** MergeStrategy enum: "rebase-ff" | "squash" | "merge-commit" */
  strategy: string
}

/** A PR was opened as part of completion */
export interface PrOpenedEvent extends AnalyticsEventBase {
  event_name: 'pr_opened'
  /** True for draft PRs */
  draft: boolean
}

// ---------------------------------------------------------------------------
// Plan approval sequencer events
// ---------------------------------------------------------------------------

/** The plan-approval sequencer started processing a repo's queue */
export interface PlanSequenceStartedEvent extends AnalyticsEventBase {
  event_name: 'plan_sequence_started'
}

/** The plan-approval sequencer finished (or was stopped) */
export interface PlanSequenceCompletedEvent extends AnalyticsEventBase {
  event_name: 'plan_sequence_completed'
  /** "succeeded" | "cancelled" | "watchdog_timeout" */
  outcome: string
  /** Bucketed approved count: "0" | "1" | "2-5" | "6+" */
  approved_count_bucket: string
}

// ---------------------------------------------------------------------------
// Consent lifecycle
// ---------------------------------------------------------------------------

/** User made (or updated) an analytics consent choice */
export interface AnalyticsConsentSetEvent extends AnalyticsEventBase {
  event_name: 'analytics_consent_set'
  /** "granted" | "denied" */
  consent: string
  /** Where the choice was made: "firstrun" | "settings" */
  mode: string
}

// ---------------------------------------------------------------------------
// Completion-actions v2 (turn-as-commit) events
// ---------------------------------------------------------------------------

/** A user published one or more turns via squash + path. */
export interface TurnPublishedEvent extends AnalyticsEventBase {
  event_name: 'turn_published'
  /** "push-branch" | "direct-merge" | "pr" | "draft-pr" */
  path: string
  /** Bucketed turn count: "1" | "2-5" | "6+" */
  turn_count_bucket: string
  /** "succeeded" | "failed" */
  outcome: string
  /** Origin of the publish: "per-terminal" | "bulk" */
  source: string
}

/** A turn was split into two via the hunk picker. */
export interface TurnSplitEvent extends AnalyticsEventBase {
  event_name: 'turn_split'
  /** "succeeded" | "failed" */
  outcome: string
  /** Bucketed file count of the original turn: "1" | "2-5" | "6+" */
  files_changed_bucket: string
}

/** A turn was discarded (and any cascade dependents dropped). */
export interface TurnDiscardedEvent extends AnalyticsEventBase {
  event_name: 'turn_discarded'
  /** "tip" | "cascade" — whether dependents were also dropped. */
  variant: string
  /** "succeeded" | "failed" */
  outcome: string
}

/** A bulk run finished, with aggregate outcome. */
export interface BulkRunCompletedEvent extends AnalyticsEventBase {
  event_name: 'bulk_run_completed'
  /** "merge" | "open-pr" | "open-draft-pr" | "push-branch" | "discard-all" */
  action: string
  /** Bucketed pane count: "1" | "2-5" | "6+" */
  pane_count_bucket: string
  /** Successful panes count, bucketed. */
  success_count_bucket: string
  /** Failed panes count, bucketed. */
  failure_count_bucket: string
  /** True if cancelled mid-run. */
  cancelled: boolean
}

// ---------------------------------------------------------------------------
// Discriminated union of all event types
// ---------------------------------------------------------------------------

export type AnalyticsEvent =
  | PaneSpawnedEvent
  | PaneClosedEvent
  | PaneMovedEvent
  | SpawnModeSelectedEvent
  | WindowCreatedEvent
  | WindowClosedEvent
  | KeyboardShortcutUsedEvent
  | FeedbackSubmittedEvent
  | PaneCollapsedEvent
  | PaneExpandedEvent
  | SessionCompletedEvent
  | AppLaunchedEvent
  | PtySpawnedEvent
  | MemorySnapshotEvent
  | UnhandledErrorEvent
  | PtyCrashedEvent
  | HookFailureEvent
  | FallbackActivatedEvent
  | SettingsMergeErrorEvent
  | AppSessionStartedEvent
  | WorkspaceCreatedEvent
  | WorkspaceArchivedEvent
  | WorkspaceUnarchivedEvent
  | WorkspaceDeletedArchivedEvent
  | MergeCompletedEvent
  | PrOpenedEvent
  | PlanSequenceStartedEvent
  | PlanSequenceCompletedEvent
  | AnalyticsConsentSetEvent
  | TurnPublishedEvent
  | TurnSplitEvent
  | TurnDiscardedEvent
  | BulkRunCompletedEvent

// ---------------------------------------------------------------------------
// Event creation helper — enforces common fields on every event
// ---------------------------------------------------------------------------

export interface EventContext {
  installation_id: string
  app_version: string
  platform: string
}

// Narrowing helper: picks the single AnalyticsEvent member whose event_name
// matches N. Lets makeEvent's `fields` parameter reflect the specific payload
// for the event being created instead of the intersection of all events.
type AnalyticsEventByName<N extends AnalyticsEvent['event_name']> = Extract<
  AnalyticsEvent,
  { event_name: N }
>

export function makeEvent<N extends AnalyticsEvent['event_name']>(
  ctx: EventContext,
  fields: Omit<AnalyticsEventByName<N>, keyof AnalyticsEventBase | 'event_name'> & {
    event_name: N
  }
): AnalyticsEventByName<N> {
  return {
    timestamp: new Date().toISOString(),
    installation_id: ctx.installation_id,
    app_version: ctx.app_version,
    platform: ctx.platform,
    ...fields
  } as AnalyticsEventByName<N>
}

// ---------------------------------------------------------------------------
// Bucketing helpers (no PII, deterministic)
// ---------------------------------------------------------------------------

export function bucketTokens(tokens: number): string {
  if (tokens < 1000) return '0-1k'
  if (tokens < 10000) return '1k-10k'
  if (tokens < 50000) return '10k-50k'
  if (tokens < 100000) return '50k-100k'
  return '100k+'
}

export function bucketCostUsd(usd: number): string {
  if (usd < 0.01) return '<0.01'
  if (usd < 0.10) return '0.01-0.10'
  if (usd < 1.00) return '0.10-1.00'
  if (usd < 5.00) return '1.00-5.00'
  return '5.00+'
}

export function bucketFeedbackLength(chars: number): string {
  if (chars <= 50) return '0-50'
  if (chars <= 200) return '51-200'
  if (chars <= 500) return '201-500'
  return '500+'
}

export function roundToNearest(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest
}

/** Bucket a pane's age (ms since spawn) into the three bands documented in the catalog. */
export function bucketPaneAge(ageMs: number): string {
  const minutes = ageMs / 60_000
  if (minutes < 1) return '<1m'
  if (minutes < 10) return '1-10m'
  return '10m+'
}

/** Bucket an approved-count (plan approval sequencer) into a small set of bands. */
export function bucketApprovedCount(count: number): string {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  if (count <= 5) return '2-5'
  return '6+'
}
