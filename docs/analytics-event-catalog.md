# Analytics Event Catalog

All events are anonymous (identified only by a random `installation_id` UUID) and contain no PII. See `src/shared/analytics-events.ts` for full TypeScript definitions.

## Common Fields (all events)

| Field | Type | Description |
|---|---|---|
| `event_name` | string | Discriminant — unique event identifier |
| `timestamp` | string | ISO 8601 UTC timestamp |
| `installation_id` | string | Anonymous UUID generated at first launch; stable across sessions |
| `app_version` | string | Semantic version, e.g. `"0.1.0"` |
| `platform` | string | OS: `"darwin"` \| `"win32"` \| `"linux"` |

---

## Usage Events

### `pane_spawned`
Fired when a new terminal pane is created.

| Field | Type | Values |
|---|---|---|
| `spawn_mode` | string | `"new-worktree"` \| `"existing-worktree"` \| `"manual-path"` \| `"resume-session"` |
| `pane_count` | number | Total panes after spawn |

**When:** After `pane:spawn` IPC is processed and PTY is created.

---

### `pane_closed`
Fired when a pane is explicitly closed by the user.

| Field | Type | Values |
|---|---|---|
| `close_trigger` | string | `"manual"` \| `"menu"` \| `"keyboard"` |
| `duration_bucket` | string | `"<1m"` \| `"1-5m"` \| `"5-30m"` \| `"30m-2h"` \| `">2h"` |
| `final_status` | string | Terminal status at close (PaneStatus enum) |
| `pane_count` | number | Panes remaining in the window after close |

**When:** On `pane:close` IPC.

---

### `pane_moved`
Fired when a pane is moved between windows.

| Field | Type | Values |
|---|---|---|
| `source_pane_count` | number | Panes left in source window after move |
| `target_pane_count` | number | Panes in target window after move |

**When:** On `pane:move` IPC after successful move.

---

### `spawn_mode_selected`
Fired once per successful spawn. The `mode` field mirrors the PANE_SPAWN payload.

| Field | Type | Values |
|---|---|---|
| `mode` | string | `"new-worktree"` \| `"existing-worktree"` \| `"manual-path"` \| `"resume-session"` |

**When:** Main-process PANE_SPAWN handler, after PTY creation succeeds.

---

### `window_created`
Fired when a new browser window is opened.

| Field | Type | Values |
|---|---|---|
| `window_count` | number | Total windows open after creation |
| `trigger` | string | `"startup"` \| `"menu"` \| `"activate"` \| `"resume-last"` \| `"batch-spawn"` |

**When:** On `window:new` IPC or app startup.

---

### `window_closed`
Fired when a window is closed.

| Field | Type | Values |
|---|---|---|
| `active_pane_count` | number | Number of active (non-done) panes at close time |
| `had_active_sessions` | boolean | Whether any pane was still running |
| `window_count` | number | Total windows remaining open |

**When:** `windowManager.onWindowClose()` callback.

---

### `keyboard_shortcut_used`
Fired when a whitelisted Cmd/Ctrl+Shift+… shortcut triggers. The renderer sends the symbolic action name via `IPC.ANALYTICS_TRACK_SHORTCUT`; main validates against an allowlist before emitting.

| Field | Type | Example values |
|---|---|---|
| `action` | string | `"new_pane"`, `"close_pane"`, `"new_window"`, `"focus_next"`, `"focus_prev"`, `"focus_by_number"`, `"move_pane"`, `"show_manager"`, `"feedback"`, `"global_effort"`, `"open_merge_menu"`, `"open_pr_menu"`, `"toggle_view_mode"` |

---

### `feedback_submitted`
Fired when the user submits feedback via the FeedbackModal.

| Field | Type | Values |
|---|---|---|
| `length_bucket` | string | `"0-50"` \| `"51-200"` \| `"201-500"` \| `"500+"` |
| `feedback_type` | string | Feedback category enum (no free text) |

**When:** `feedback:send` IPC handler.

---

### `pane_collapsed`
Reserved — instrumentation function exists; no UI entry point yet.

---

### `pane_expanded`
Reserved — instrumentation function exists; no UI entry point yet.

---

## Session Aggregate Events

### `session_completed`
Fired on pane close with aggregate session metrics. All values are bucketed or rounded — no raw numbers.

| Field | Type | Values |
|---|---|---|
| `duration_seconds_rounded` | number | Duration in seconds, rounded to nearest 10 |
| `token_bucket` | string | `"<1k"` \| `"1k-10k"` \| `"10k-50k"` \| `"50k-200k"` \| `">200k"` \| `"unknown"` |
| `cost_bucket` | string | `"<$0.01"` \| `"$0.01-$0.10"` \| `"$0.10-$1.00"` \| `"$1.00+"` \| `"n/a"` \| `"unknown"` |
| `tool_count` | number | Number of distinct tools used |
| `exit_reason` | string | `"done"` \| `"terminated"` \| `"crashed"` \| `"unknown"` |
| `duration_bucket` | string | `"<1m"` \| `"1-5m"` \| `"5-30m"` \| `"30m-2h"` \| `">2h"` |
| `final_status` | string | Terminal status at session close |
| `spawn_mode` | string | Recorded at pane spawn time |
| `tool_invocations` | number | Total tool invocations across all tools |
| `status_source` | string | `"hook"` \| `"pty-fallback"` |
| `is_api_billing` | boolean | Whether billing is API-direct (vs. subscription) |
| `context_percent` | number \| null | Rounded integer context-window %, or null |

**When:** After pane close, before deregistration.

---

## Performance Events

### `app_launched`
Fired once on startup, measuring cold-start latency.

| Field | Type | Values |
|---|---|---|
| `time_to_first_window_ms` | number | Time from module load to first window paint, rounded to nearest 100ms |

---

### `pty_spawned`
Fired when a PTY process produces its first output.

| Field | Type | Values |
|---|---|---|
| `spawn_latency_ms` | number | Time from spawn IPC to first PTY data, rounded to nearest 50ms |

---

### `memory_snapshot`
Periodic snapshot of memory usage (every 5 minutes).

| Field | Type | Values |
|---|---|---|
| `heap_used_mb` | number | V8 heap used in MB, rounded to nearest 10MB |
| `external_mb` | number | External (native) memory in MB, rounded to nearest 10MB |
| `pane_count` | number | Number of open panes at snapshot time |

---

## Error Events

All error events are rate-limited to **10 per error type per minute** to prevent flooding on repeated failures.

### `unhandled_error`
Fired for uncaught exceptions and unhandled Promise rejections.

| Field | Type | Values |
|---|---|---|
| `error_type` | string | Error class name only (e.g. `"TypeError"`) — no message |
| `process` | string | `"main"` \| `"renderer"` |

---

### `pty_crashed`
Fired when a PTY process exits with a non-zero code or unexpectedly.

| Field | Type | Values |
|---|---|---|
| `exit_code` | number \| null | Exit code, or null if unavailable |
| `pane_age_bucket` | string | `"<1m"` \| `"1-10m"` \| `"10m+"` |

---

### `hook_failure`
Fired when processing a Claude Code hook event fails (e.g. malformed JSON from the relay).

| Field | Type | Values |
|---|---|---|
| `hook_event_type` | string | Hook event type (e.g. `"PreToolUse"`) or a symbolic sentinel (`"parse-error"`) |

---

### `fallback_activated`
Fired when the PTY-fallback status detector activates (hooks not received within 30s). No extra fields.

---

### `settings_merge_error`
Fired when an error occurs merging Claude settings files (malformed JSON on read, or write failure).

| Field | Type | Values |
|---|---|---|
| `error_type` | string | Error class name only (no message) |

---

## System Events

### `app_session_started`
Fired once per app launch with environment context.

| Field | Type | Example |
|---|---|---|
| `electron_version` | string | `"33.2.1"` |
| `node_version` | string | `"20.18.0"` |
| `chrome_version` | string | `"130.0.0.0"` |

**When:** App ready, before first window creation.

---

## Workspace Lifecycle Events

### `workspace_created`
Fired when a workspace is created (any type).

| Field | Type | Values |
|---|---|---|
| `workspace_type` | string | `"general"` \| `"repo"` \| `"worktree-branch"` |
| `workspace_count` | number | Total non-archived workspaces after creation |

**When:** `WORKSPACE_CREATE` IPC handler.

---

### `workspace_archived`
Fired when a dormant workspace is moved to archived.

| Field | Type | Values |
|---|---|---|
| `workspace_type` | string | Type of the archived workspace |
| `archived_count` | number | Total archived workspaces after this one was archived |

---

### `workspace_unarchived`
Fired when an archived workspace is restored to dormant.

| Field | Type | Values |
|---|---|---|
| `workspace_type` | string | Type of the restored workspace |

---

### `workspace_deleted_archived`
Fired when an archived workspace is permanently deleted.

| Field | Type | Values |
|---|---|---|
| `workspace_type` | string | Type of the deleted workspace |

---

## Completion Events

### `merge_completed`
Fired when a merge attempt reaches a terminal outcome.

| Field | Type | Values |
|---|---|---|
| `outcome` | string | `"succeeded"` \| `"failed"` \| `"paused_conflict"` \| `"aborted"` |
| `strategy` | string | `"rebase-ff"` \| `"squash"` \| `"merge-commit"` |

**When:** Terminal branches in `CompletionExecutor.processQueuedMerge`.

---

### `pr_opened`
Fired when a PR has been opened via the completion flow.

| Field | Type | Values |
|---|---|---|
| `draft` | boolean | True for draft PRs |

**When:** `CompletionExecutor.executePr` success path.

---

## Plan Approval Sequencer Events

### `plan_sequence_started`
Fired when the user kicks off a plan-approval sequence for a repo. No extra fields.

---

### `plan_sequence_completed`
Fired when the sequencer drains, is cancelled, or a watchdog fires.

| Field | Type | Values |
|---|---|---|
| `outcome` | string | `"succeeded"` \| `"cancelled"` \| `"watchdog_timeout"` |
| `approved_count_bucket` | string | `"0"` \| `"1"` \| `"2-5"` \| `"6+"` |

---

## Consent Lifecycle

### `analytics_consent_set`
Fired when the user grants or denies analytics consent. The bus gate (`isAnalyticsEnabled`) drops denial events before transport, so the distribution observed only reflects users who landed on "granted".

| Field | Type | Values |
|---|---|---|
| `consent` | string | `"granted"` \| `"denied"` |
| `mode` | string | `"firstrun"` \| `"settings"` |

**When:** Inside `setConsent` in `src/main/analytics/analytics-config.ts`, after the new state is persisted.

---

## Development: Dry-Run Mode

Launch the app with `--analytics-dry-run` to log all events to stdout via `ConsoleProvider` instead of sending to PostHog:

```
npx electron . --analytics-dry-run
```

This is useful for verifying event instrumentation during development without sending real data.

## Privacy Guarantees

- **No PII is collected.** Event schemas are reviewed to exclude: file paths, file contents, API keys, repo names, worktree names, session IDs, user-supplied text.
- **Error messages are scrubbed.** `scrubMessage()` strips file paths and API key patterns before any error context is recorded.
- **Values are bucketed.** All numeric user-behavior values (tokens, cost, duration, message length, approved counts) are replaced with discrete bucket strings before transport.
- **Anonymous UUID only.** `installation_id` is a random UUID generated at first install. It is not linked to any user account, email, or device identifier.
- **Consent is required.** All instrumentation is gated on `isAnalyticsEnabled()`. Consent can be changed at any time from Help → Analytics or Configuration → Privacy.
