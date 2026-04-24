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
| `spawn_mode` | string | `"claude"` \| `"custom"` |
| `pane_count` | number | Total panes after spawn |

**When:** After `pane:spawn` IPC is processed and PTY is created.

---

### `pane_closed`
Fired when a pane is explicitly closed by the user.

| Field | Type | Values |
|---|---|---|
| `close_trigger` | string | `"manual"` \| `"menu"` \| `"keyboard"` |
| `duration_bucket` | string | `"<1m"` \| `"1-5m"` \| `"5-30m"` \| `"30m-2h"` \| `">2h"` |
| `final_status` | string | Terminal status at close, e.g. `"idle"` \| `"working"` \| `"done"` \| `"failed"` |
| `pane_count` | number | Total panes remaining in the window after close |

**When:** On `pane:close` IPC.

---

### `pane_moved`
Fired when a pane is moved between windows.

| Field | Type | Values |
|---|---|---|
| `source_pane_count` | number | Panes remaining in the source window after the move |
| `target_pane_count` | number | Panes in the target window after the move |

**When:** On `pane:move` IPC after successful move.

---

### `spawn_mode_selected`
Fired when the user selects a spawn mode in the SpawnDialog.

| Field | Type | Values |
|---|---|---|
| `mode` | string | `"claude"` \| `"custom"` |

**When:** On spawn mode selection in the UI (SpawnDialog submit).

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
| `had_active_sessions` | boolean | Whether the window had any active sessions at close time |
| `window_count` | number | Total windows open after this one closed |

**When:** `windowManager.onWindowClose()` callback.

---

### `keyboard_shortcut_used`
Fired when a keyboard shortcut is triggered.

| Field | Type | Example values |
|---|---|---|
| `action` | string | `"new_pane"`, `"close_pane"`, `"new_window"`, `"focus_next"`, `"focus_prev"`, `"focus_by_number"`, `"move_pane"`, `"feedback"` |

**When:** Keyboard shortcut handler in WindowShell.

---

### `feedback_submitted`
Fired when the user submits feedback via the FeedbackModal.

| Field | Type | Values |
|---|---|---|
| `length_bucket` | string | `"0-50"` \| `"51-200"` \| `"201-500"` \| `"500+"` |
| `feedback_type` | string | Symbolic category, e.g. `"bug"` \| `"idea"` \| `"other"` — no free text |

**When:** `feedback:send` IPC handler.

---

### `pane_collapsed`
Fired when a pane is collapsed.

*(No extra fields.)*

---

### `pane_expanded`
Fired when a pane is expanded from collapsed state.

*(No extra fields.)*

---

## Session Aggregate Events

### `session_completed`
Fired on pane close with aggregate session metrics. All values are bucketed or rounded — no raw numbers.

| Field | Type | Values |
|---|---|---|
| `duration_seconds_rounded` | number | Duration in seconds, rounded to nearest 10 |
| `token_bucket` | string | `"0-1k"` \| `"1k-10k"` \| `"10k-50k"` \| `"50k-100k"` \| `"100k+"` |
| `cost_bucket` | string | `"<0.01"` \| `"0.01-0.10"` \| `"0.10-1.00"` \| `"1.00-5.00"` \| `"5.00+"` \| `"n/a"` |
| `tool_count` | number | Number of distinct tools used |
| `exit_reason` | string | `"done"` \| `"terminated"` \| `"crashed"` \| `"unknown"` |
| `duration_bucket` | string | `"<1m"` \| `"1-5m"` \| `"5-30m"` \| `"30m-2h"` \| `">2h"` |
| `final_status` | string | Terminal status at close, e.g. `"done"` \| `"failed"` \| `"idle"` |
| `spawn_mode` | string | `"claude"` \| `"custom"` \| `"unknown"` |
| `tool_invocations` | number | Total tool invocations (sum, not distinct count) |
| `status_source` | string | `"hook"` \| `"pty-fallback"` |
| `is_api_billing` | boolean | Whether the session was on API billing vs subscription |
| `context_percent` | number \| null | Rounded context-window fill % at close, or null if unknown |

**When:** After pane close, before deregistration.

---

## Performance Events

### `app_launched`
Fired once on startup, measuring cold-start latency.

| Field | Type | Values |
|---|---|---|
| `time_to_first_window_ms` | number | Time from module load to first window paint, rounded to nearest 100ms |

**When:** `BrowserWindow.did-finish-load` event on first window.

---

### `pty_spawned`
Fired when a PTY process produces its first output (measuring spawn latency).

| Field | Type | Values |
|---|---|---|
| `spawn_latency_ms` | number | Time from spawn IPC to first PTY data, rounded to nearest 50ms |

**When:** First `onData` callback after `pane:spawn`.

---

### `memory_snapshot`
Periodic snapshot of memory usage (every 5 minutes).

| Field | Type | Values |
|---|---|---|
| `heap_used_mb` | number | V8 heap used in MB, rounded to nearest MB |
| `external_mb` | number | External (native) memory in MB, rounded to nearest MB |
| `pane_count` | number | Number of open panes at snapshot time |

**When:** 5-minute interval timer started on app ready.

---

## Error Events

All error events are rate-limited to **10 per error type per minute** to prevent flooding on repeated failures.

### `unhandled_error`
Fired for uncaught exceptions and unhandled Promise rejections.

| Field | Type | Values |
|---|---|---|
| `error_type` | string | Error class name only (e.g. `"TypeError"`) — no message |
| `process` | string | `"main"` \| `"renderer"` |

**Note:** Error messages are NOT included — they may contain PII (file paths, user input). Only the class name is sent.

---

### `pty_crashed`
Fired when a PTY process exits with a non-zero code or unexpectedly.

| Field | Type | Values |
|---|---|---|
| `exit_code` | number \| null | Exit code, or null if unavailable |
| `pane_age_bucket` | string | `"<1m"` \| `"1-10m"` \| `"10m+"` |

---

### `hook_failure`
Fired when processing a Claude Code hook event fails.

| Field | Type | Values |
|---|---|---|
| `hook_event_type` | string | Hook event type (e.g. `"PreToolUse"`, `"PostToolUse"`) |

---

### `fallback_activated`
Fired when the PTY-fallback status detector activates (hooks not received within 30s).

*(No extra fields.)*

---

### `settings_merge_error`
Fired when an error occurs merging Claude settings files.

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

**When:** App ready, before window creation.

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
- **Values are bucketed.** All numeric user-behavior values (tokens, cost, duration, message length) are replaced with discrete bucket strings before transport.
- **Anonymous UUID only.** `installation_id` is a random UUID generated at first install. It is not linked to any user account, email, or device identifier.
- **Consent is required.** All instrumentation is gated on `isAnalyticsEnabled()`. Consent can be changed at any time from Help → Analytics.
