# Lessons Learned

This file captures patterns, anti-patterns, and insights discovered during implementation and feedback cycles. Every agent MUST read this file before starting work and MUST append new lessons after processing feedback or making non-trivial changes.

---

## How to Use This File

**Before work:** Read all lessons below. Let them inform your implementation choices. If a lesson is relevant to the current task, follow it.

**After work:** If feedback or a bug revealed a flawed assumption or reasoning gap, append a new entry. The most important thing to capture is *why the agent made the wrong choice* — the root cause — not just what was wrong. Then provide a concrete decision rule or self-check question that a future agent can apply at decision time to avoid the same class of mistake. Do not log routine fixes where the root cause is trivially obvious.

---

## Lesson Format

```
## L-XXX: [Short title]

**Date:** YYYY-MM-DD
**Source:** [feedback item, implementation observation, or refactor discovery]
**Category:** [UX pattern | implementation pattern | architecture | testing | scope discipline]

**What happened:**
[Brief description of the situation — what the user saw and what they expected]

**Why the agent got it wrong:**
[Root cause analysis — what assumption, reasoning error, or default behavior led the agent to make the wrong choice in the first place. This is the most important section. Be honest and specific.]

**How to avoid this in the future:**
[Concrete decision rule or checkpoint that a future agent should apply BEFORE making a similar choice. Frame as a question to ask yourself or a principle to follow at decision time.]
```

---

## L-001: Focus must always follow new pane creation

**Date:** 2026-03-19
**Source:** F-001
**Category:** UX pattern

**What happened:**
When a new drone was spawned, focus only switched to it if no other pane was focused. The user expected focus to always move to the new pane.

**Why the agent got it wrong:**
The agent wrote the reducer as `focusedPaneId: state.focusedPaneId ?? paneId` — a "safe default" pattern that preserves existing state. The agent treated focus as application state to be conserved rather than thinking from the user's perspective: the user just clicked "launch new drone," so obviously they want to interact with it. The agent defaulted to a conservative state-management instinct instead of reasoning about user intent.

**How to avoid this in the future:**
When a user explicitly triggers an action that creates a new interactive element, ask: "What did the user intend to do next?" The answer is almost always "interact with the thing they just created." Focus, selection, and navigation should follow user-initiated creation actions unconditionally — not conditionally based on prior state.

---

## L-002: Borders and chrome must not cause layout shifts

**Date:** 2026-03-19
**Source:** F-001
**Category:** UX pattern

**What happened:**
Focused panes had thicker borders (17px vs 3px), causing content to resize when focus changed. The user expected stable layout regardless of focus state.

**Why the agent got it wrong:**
The agent used border-width as the visual differentiation mechanism for focus state without considering that borders are part of the CSS box model and directly affect element sizing. The agent was thinking about how to make focus *visually obvious* but didn't think through the *layout consequences* of the approach. It treated the visual indicator as a purely cosmetic decision when it was actually a layout decision.

**How to avoid this in the future:**
Before implementing any visual state change (focus, hover, selection, active), ask: "Does this change affect the element's size or the layout of surrounding elements?" If yes, choose a different approach. Safe options: box-shadow, outline, color/opacity changes, inset effects. Unsafe options: border-width, padding, margin changes. Layout stability must be a hard constraint, not an afterthought.

---

## L-003: Prefer toolbar bars over floating action buttons

**Date:** 2026-03-19
**Source:** F-002
**Category:** UX pattern

**What happened:**
A floating "+" button was placed in the bottom-right corner. The user wanted a toolbar bar with the action integrated alongside keyboard shortcut hints.

**Why the agent got it wrong:**
The agent defaulted to a common web/mobile UI pattern (floating action button) without considering the specific product context. This is a keyboard-heavy productivity/workspace app, not a mobile app or consumer web page. The agent applied a generic UI convention instead of reasoning about what UI pattern fits a workspace tool where keyboard shortcuts and information density matter. It also didn't consider that the action button needed to coexist with shortcut hints and status information.

**How to avoid this in the future:**
Before choosing a UI pattern for primary actions, ask: "What kind of product is this, and how do its users interact with it?" For productivity/workspace/developer tools, prefer integrated chrome (toolbars, status bars, command palettes) over floating elements. Floating elements are appropriate for touch-first or content-consumption UIs. Also ask: "Does this action need to live alongside related information (shortcuts, status)?" If yes, it belongs in a bar, not floating alone.

---

## L-004: Panes need visible separation

**Date:** 2026-03-19
**Source:** F-002
**Category:** UX pattern

**What happened:**
Panes were flush against each other with no spacing, making boundaries hard to distinguish.

**Why the agent got it wrong:**
The agent implemented the grid layout purely as a space-filling exercise — maximize content area by leaving no gaps. It didn't consider that when multiple interactive regions share a screen, the user needs to visually parse boundaries at a glance. The agent optimized for space efficiency over visual scannability. In a multi-pane workspace, clear boundaries are a functional requirement, not a cosmetic nicety.

**How to avoid this in the future:**
When laying out multiple independent interactive regions (panes, panels, cards, terminals), ask: "Can the user instantly tell where one region ends and another begins?" If the regions are flush, the answer is usually no. Default to including visible gaps (~1 line height) between independent interactive regions. Only go flush when the regions are intentionally unified (e.g., tab bar attached to its content area).

---

## L-005: Don't unmount components that own live stateful resources

**Date:** 2026-03-20
**Source:** feedback — collapse/expand destroyed terminal; move-to-window lost terminal content
**Category:** implementation pattern

**What happened:**
Two separate bugs had the same root cause: React conditionally rendered (`{condition && <Component />}`) components that owned xterm.js terminal instances. When the condition toggled, the component unmounted, destroying the terminal and losing all buffer content. On remount, a blank terminal was created. This affected both pane collapse/expand and pane move-to-window flows.

**Why the agent got it wrong:**
The agent used conditional rendering as a visual hide/show mechanism without considering that the component manages a long-lived, stateful external resource (xterm.js Terminal). In React, `{condition && <X />}` is an existence toggle, not a visibility toggle — it destroys and recreates the component and all its state. The agent treated "not visible" and "not mounted" as equivalent, when they have fundamentally different lifecycle implications for components backed by external state.

**How to avoid this in the future:**
Before conditionally rendering a component, ask: "Does this component own or manage external state that would be lost on unmount?" (Terminal instances, WebSocket connections, canvas contexts, media streams, timers with accumulated state.) If yes, never use conditional rendering to hide it. Instead, keep it always mounted and use CSS to hide it (`h-0 overflow-hidden`, `visibility: hidden`, etc.). Reserve conditional rendering for components with no persistent external state.

---

## L-006: Electron IPC has no delivery guarantee before React effects run

**Date:** 2026-03-20
**Source:** feedback — pane move to new window produced blank, non-interactive terminal
**Category:** architecture

**What happened:**
When moving a pane to a new BrowserWindow, the main process sent `PANE_MOVED_IN` after `did-finish-load`. But React's `useEffect` hooks (which register IPC listeners) may not have run by that point. The message was silently dropped, and the pane never appeared in the new window.

**Why the agent got it wrong:**
The agent assumed `did-finish-load` meant "renderer is fully ready to receive IPC messages." In reality, `did-finish-load` fires when the page's `load` event fires — after scripts execute but potentially before React's effects run. The agent conflated "page loaded" with "application ready" and didn't account for the asynchronous nature of React's effect registration.

**How to avoid this in the future:**
Never rely on Electron's `did-finish-load` or `dom-ready` as a proxy for "the renderer application is ready to process messages." Instead, have the renderer explicitly signal readiness via a dedicated IPC message (`RENDERER_READY`) sent from a `useEffect` placed after all listener registrations. For any cross-window data transfer, use the pattern: buffer data on the main process → wait for explicit renderer-ready signal → flush buffered data + send payload. This eliminates timing races between Electron lifecycle events and React's asynchronous effect scheduling.

---

## L-007: Adding code to a file requires verifying all imports are present

**Date:** 2026-03-20
**Source:** feedback — app window empty on launch due to missing import
**Category:** implementation pattern

**What happened:**
The RENDERER_READY signaling code was added to `usePaneState.ts` — a `useEffect` calling `ipcSend(IPC.RENDERER_READY)`. But the `ipcSend` function was never added to the file's import statement (only `useIpcListener` was imported from `./useIpc`). This caused a `ReferenceError` at runtime that crashed the entire React tree, leaving the window completely blank. TypeScript compilation succeeded because the build pipeline did not catch the missing import at build time.

**Why the agent got it wrong:**
The agent focused on the logic of the new feature (where to place the `useEffect`, ensuring it fires after IPC listeners are registered) and neglected the mechanical step of verifying that every symbol used in the new code was already imported. The file already imported `useIpcListener` from `./useIpc`, which may have created a false sense that the IPC module was "already imported." The agent treated the import line as complete without checking whether the specific function being called (`ipcSend`) was included.

**How to avoid this in the future:**
After adding new code to any file, scan the new code for every function, type, and constant it references. For each one, verify it appears in the file's import statements. Do not assume that because a module is already imported, all needed exports from that module are imported. A concrete self-check: "For every identifier I just typed that isn't defined in this file, can I find it in an import statement above?"

---

## L-008: Nested layout containers with index keys cause component remounts

**Date:** 2026-03-20
**Source:** feedback — terminal content disappears when panes are added/removed/resized
**Category:** architecture

**What happened:**
Terminal content in panes kept disappearing when the grid layout changed. The primary root cause was PaneGrid using nested flex rows with `key={rowIndex}`. When panes were added/removed, the grid recalculated rows, and panes moved between row divs. React treats a keyed element moving to a different parent as unmount + remount — destroying the xterm.js Terminal and all its buffer content. A secondary cause was `fitAddon.fit()` calling `_renderService.clear()` before `resize()`, which blanked canvas layers when multiple terminals resized simultaneously. A third cause was XTermView's lifecycle effect depending on `initialSerializedBuffer`, which could trigger terminal recreation if the prop's reference identity changed.

**Why the agent got it wrong:**
The agent used nested flex containers (rows) for layout because it's a natural CSS pattern for grid-like layouts. It used `key={rowIndex}` on row divs without considering that React's reconciliation is tree-structural: a keyed child moving to a different parent unmounts, even if the child's own key is stable. The agent thought stable `key={paneId}` on Pane wrappers was sufficient, not realizing that parent identity matters just as much. It also used `fitAddon.fit()` without reading the source to see that it performs a destructive canvas clear before resize.

**How to avoid this in the future:**
Four rules: (1) When components manage expensive external resources (terminals, canvases, WebSocket connections), ensure they NEVER move between parent elements in the React tree. Use flat container structures (CSS Grid) instead of nested containers (flex rows). Self-check: "If I add/remove a sibling, does any existing component change its parent element?" (2) Before using a library method in a hot path, read its source — don't assume it's atomic or non-destructive. (3) UseEffect dependency arrays for resource-lifecycle effects should be minimal — only include values that genuinely require recreating the resource. Use refs for values that should be read once on mount. (4) NEVER add post-resize timers that call destructive rendering methods (fit, clear, clearTextureAtlas, refresh) on canvas-backed components. ResizeObserver fires on ANY layout shift — not just the ones you intend — so a timer will repeatedly disrupt actively rendering canvases. If the initial resize doesn't produce correct rendering, rely on natural recovery (new data writes, window focus) instead of forced redraws.

---

## L-009: External hook events are not 1:1 with semantic status

**Date:** 2026-03-20
**Source:** feedback — pane showed "Needs Input" after Claude gave a statement with no question
**Category:** implementation pattern

**What happened:**
Claude responded with "Working! Let me know what you'd like to do — I'm ready to help." (a statement, not a question) but the pane status showed "Needs Input." The root cause was that the Claude Code `Notification` hook event was unconditionally mapped to `needs-input` in `HOOK_STATUS_MAP`. In practice, the `Notification` hook fires both for permission prompts (where the user genuinely needs to respond) AND for task-completion alerts (where Claude is just pinging an unfocused terminal). Because the Apiary embeds terminals inside Electron, Claude Code's terminal is often "unfocused" from the OS perspective, so completion notifications fire regularly and incorrectly override the correct `done` status.

**Why the agent got it wrong:**
The agent assumed a 1:1 mapping between hook event names and semantic status categories. It treated `Notification` as always meaning "Claude needs user input" without considering that the same event type can fire in multiple contexts with different semantic meanings. The agent mapped the event name to its most obvious interpretation instead of examining when and why the event actually fires in practice — especially in the non-standard environment of an embedded PTY inside Electron.

**How to avoid this in the future:**
Before mapping an external event (hook, webhook, callback) directly to a status classification, ask: "Does this event fire in exactly one semantic context, or can it fire in multiple contexts that mean different things?" If the event is ambiguous, do not map it unconditionally. Instead, use the event as a trigger and inspect additional signals (PTY output, current state, environment context) to determine the correct classification. A concrete self-check: "If I trace every scenario where this event fires, does my mapping produce the correct status in ALL of them?"

---

## L-010: Verify external data schemas against actual runtime output, not documentation

**Date:** 2026-03-20
**Source:** feedback — PE-01 rate limit bar never appeared despite full pipeline being wired up
**Category:** implementation pattern

**What happened:**
The rate limit display (PE-01) was fully implemented end-to-end — IPC channels, preload allowlist, MetricsCollector parsing, RateLimitBar component, WindowShell integration — but it never rendered. The statusline JSON from Claude Code v2.1.80 uses `five_hour`/`seven_day` as keys with Unix timestamp numbers for `resets_at`, but the code was written against a speculative schema that used `5_hour`/`7_day` with ISO 8601 strings. The key mismatch caused `extractRateLimitWindow` to receive `undefined` every time, so no data was ever broadcast.

**Why the agent got it wrong:**
The agent wrote the parsing code based on the PE-01 enhancement spec's example JSON, which was itself speculative (written before the feature shipped upstream). The agent never checked the actual runtime output of Claude Code's statusline JSON to confirm the schema. It trusted documentation over reality. The mismatch was invisible because the code path silently returned `null` on missing keys — no errors, no warnings, just silent no-op.

**How to avoid this in the future:**
When writing code that parses external data (API responses, file formats, CLI output, hook payloads), always verify the schema against actual runtime data before or immediately after implementation. Concrete self-check: "Have I seen a real example of this data, or am I coding against a spec/assumption?" If coding against a spec, add a startup-time or first-use log that dumps the raw data so mismatches are immediately visible. For silent-failure code paths (where missing fields → null → no-op), be especially vigilant — these bugs produce no errors and are only caught by noticing the feature doesn't work.

---

## L-011: Lifecycle cleanup must not run before user confirmation

**Date:** 2026-03-20
**Source:** feedback — closing window killed all sessions before user could cancel
**Category:** architecture

**What happened:**
The `before-quit` handler unconditionally called `ptyPool.killAll()`, which killed all PTY processes the moment the app began its quit sequence. Electron's lifecycle fires `before-quit` BEFORE `close` events on windows. So when the user pressed Cmd+Q (or used Dock/menu quit), PTYs were killed immediately, then the close interceptor showed a confirmation modal — but all sessions were already dead. Clicking Cancel was useless. Additionally, the confirmation flow's `win.destroy()` call never cleaned up PTYs for the closing window, leaking orphan processes.

**Why the agent got it wrong:**
The agent placed destructive cleanup (`ptyPool.killAll()`) in the earliest possible shutdown hook (`before-quit`) as a "safety-first" pattern — ensuring no orphan processes survive. This is correct for unconditional shutdown, but the app has a conditional shutdown path: the close interceptor can CANCEL the quit by preventing window close events. The agent didn't trace the full Electron lifecycle sequence (`before-quit` → `close` on each window → `will-quit` → `quit`) to realize that destructive cleanup in `before-quit` runs before the user gets a chance to cancel via the close interceptor. It also didn't add per-window PTY cleanup to the confirmation handler, creating the orphan leak.

**How to avoid this in the future:**
When placing destructive cleanup in a lifecycle hook, ask: "Can this lifecycle sequence be cancelled at a later stage?" If yes, the destructive cleanup must be deferred to after the cancellation point, not placed before it. Concretely: in Electron, if any window's `close` event can be prevented (e.g., for confirmation), destructive cleanup must NOT go in `before-quit`. Place it either (a) in the confirmation handler (per-resource cleanup when user confirms) or (b) in `will-quit` (safety net, fires only after all windows are confirmed closed). Self-check: "If the user cancels at step N, will cleanup at step N-1 have already destroyed something irreversibly?"

---

## L-012: Always import a library's required CSS — workarounds cannot substitute for it

**Date:** 2026-03-23
**Source:** feedback — terminal content pushed down and out of sight when output exceeds pane height
**Category:** implementation pattern

**What happened:**
Terminal content became invisible once Claude Code's output exceeded the pane's visible height. Content was "pushed down" and eventually disappeared entirely. Multiple fix attempts over many sessions (manual resize calculations, data buffering, scroll-to-bottom enforcement, safety timers) all failed. The XTermView component grew to 372 lines of workaround code, none of which solved the problem.

**Why the agent got it wrong:**
xterm.js ships a required CSS file (`@xterm/xterm/css/xterm.css`) that was never imported. This file provides `.xterm-viewport { overflow-y: scroll; position: absolute; right: 0; left: 0; top: 0; bottom: 0; }` — the styles that make the viewport element scroll instead of grow. Without this CSS, the viewport was a plain block div that expanded as content grew, pushing content beyond the container's `overflow: hidden` boundary where it was clipped invisibly. The agent recognized a related symptom early on (Tailwind Preflight making the helper textarea visible) and added a targeted CSS override for that single element, but never investigated whether the ENTIRE xterm.css stylesheet was needed. Each subsequent fix attempt treated the symptom (content displacement) rather than questioning the fundamental assumption that xterm.js was set up correctly. The agent kept adding JavaScript workarounds for what was a CSS problem.

**How to avoid this in the future:**
When integrating any UI library, the FIRST step must be: "Does this library ship a CSS file? Is it imported?" Check the library's README, package contents, and import instructions. If the library's internal DOM elements (inspectable via DevTools) are missing expected styles like positioning, overflow, or display, the stylesheet is likely missing. Concrete self-check before writing ANY workaround code for a UI library: "Am I importing all required assets (CSS, fonts, images) that this library needs?" If a workaround is needed for one element of a library (e.g., the textarea fix), ask: "Is this a sign that the library's entire stylesheet is missing, not just styles for this one element?"

---

## L-013: Dual-mode detection systems need coverage for the gap between modes

**Date:** 2026-03-23
**Source:** feedback — pane stayed on "Awaiting orders" while Claude was visibly thinking
**Category:** architecture

**What happened:**
After submitting a prompt, the pane status stayed "Awaiting orders" while Claude Code showed "Considering... (thought for 1s)" in the terminal. The status only changed to "Working" when Claude called its first tool.

**Why the agent got it wrong:**
The StatusDetector has two modes: hook-based (primary) and PTY fallback (activates after 30s). The agent designed these as mutually exclusive — when hooks are primary, PTY analysis is completely disabled (`if (!entry.isActive) return`). But there's a gap: hook events only fire on specific triggers (SessionStart, PreToolUse, PostToolUse, Stop), and Claude's "thinking" phase between prompt submission and first tool call produces zero hook events. The PTY output clearly shows activity ("Considering...") but the detector ignores it because it's waiting for hooks. The agent assumed "hooks are working" meant "hooks cover all status transitions," when in reality hooks only cover tool-related transitions.

**How to avoid this in the future:**
When building dual-mode or primary/fallback detection systems, ask: "Are there observable state transitions that NEITHER mode detects?" Map out every user-visible state transition and verify that at least one detection mode covers it. Don't assume primary mode is comprehensive just because it's reliable for the cases it handles. Specifically: if the primary mode is event-driven, identify what happens between events — that's the gap where neither mode is active. A targeted bridge (like detecting `awaiting-prompt → working` from PTY output even in hook mode) can fill the gap without compromising the primary mode's authority.

---

## L-014: A "renderer ready" signal only covers listeners that exist on the component mounted at signal time

**Date:** 2026-04-08
**Source:** feedback — Manager window opened with no dormant hives visible despite hives existing on disk
**Category:** architecture

**What happened:**
After the CommandPalette was replaced with a left-nav inside `ManagerWindow`, the manager's hive list was empty on launch even though dormant hives existed on disk. The `MANAGER_STATE_UPDATE` IPC message that the main process sends in response to `RENDERER_READY` was being delivered, but no listener was registered for it at that moment. `App.tsx` sends `RENDERER_READY` after registering its `WINDOW_INIT` listener — but only `App` is mounted at that point. The main process responds by sending **both** `WINDOW_INIT` and `MANAGER_STATE_UPDATE` in the same tick. `WINDOW_INIT` lands in `App`'s listener and triggers a state change, after which `App` re-renders and finally mounts `ManagerWindow`. By the time `useManagerState`'s `MANAGER_STATE_UPDATE` listener registers in its `useEffect`, the broadcast has already been delivered and dropped on the floor. The state stayed empty until some later event happened to trigger another `pushManagerUpdate`.

**Why the agent got it wrong:**
L-006's "send `RENDERER_READY`, then main flushes buffered messages" pattern was already applied for the `WINDOW_INIT` round-trip — the agent assumed it solved IPC delivery for the entire window lifecycle. It didn't notice that `RENDERER_READY` is sent by the **root component** (`App.tsx`), not by every component that needs IPC. Any IPC message piggy-backed on `RENDERER_READY` is only safely deliverable to listeners owned by components that are **already mounted** when the ready signal fires. `MANAGER_STATE_UPDATE` was being sent to a listener that lives one render cycle in the future. The agent treated `RENDERER_READY` as a global "the renderer is ready" broadcast when it's really just "the root component is ready" — a much narrower guarantee.

**How to avoid this in the future:**
Before relying on a `RENDERER_READY`-style buffered handshake to deliver an IPC message, ask: "Is the listener for this message owned by the component that sends `RENDERER_READY`, or by a child that mounts later?" If a child, the message will be dropped — the handshake doesn't cover it. Two safe options: (1) **embed the data in the parent's payload** (e.g., put manager state inside `WINDOW_INIT` and let the child read it from props/context); or (2) **make the child fetch its own state on mount** via an `ipcInvoke` request/response (with a `seededRef` guard so the response can't overwrite a fresher broadcast that arrives during the round-trip). Concrete self-check: "Which component owns the listener, and is that component mounted at the moment `RENDERER_READY` is sent?"

---

## L-015: `flex: none` collapses height but not width — `flex-basis: auto` claims content width

**Date:** 2026-04-08
**Source:** feedback — Permissions view squished into a narrow strip on the right of the manager window
**Category:** UX pattern

**What happened:**
After adding a left-nav to `ManagerWindow`, the hives view was kept mounted across nav switches (per L-005, to preserve `HiveCard` expanded state and scroll position) by toggling its style between visible and hidden. The hidden state was `{ height: 0, overflow: 'hidden', flex: 'none' }`. Visually the hives content disappeared, but when the user switched to Permissions, the `PermissionsManagerView` rendered as a narrow column on the far right of the window with most of the row blank. Same issue would have hit `ArchivesView`. The hidden hives div was still claiming roughly the LaunchForm's width on the flex row, leaving only the leftover sliver for the `flex-1` Permissions view.

**Why the agent got it wrong:**
The agent reached for `height: 0` + `overflow: hidden` as a "hide-but-stay-mounted" pattern, mentally equating it with `display: none` minus the unmount risk. It didn't separately think about the **horizontal** axis of a flex row. `flex: none` is shorthand for `flex: 0 0 auto`, and `flex-basis: auto` means "use the element's intrinsic content width." The element collapsed vertically (because `height: 0` is explicit and there were no children forcing height) but its horizontal basis was still computed from the wide LaunchForm inside, so it kept hogging row space. The agent's mental model treated `overflow: hidden` as "this element takes no space" when it actually means "children that overflow my box are clipped" — the box itself is still sized normally by the layout algorithm.

**How to avoid this in the future:**
When hiding a flex child to preserve mount state, ask: "Have I collapsed the element on the axis the parent flex is laying out along, or only on the cross axis?" In a `flex-row`, `height: 0` is the cross axis — useless for reclaiming row space. You must ALSO set `width: 0` and force basis to zero (`flex: '0 0 0px'`) to actually remove the element from the row's main-axis allocation. General rule: a hidden-but-mounted element on a flex row needs `{ width: 0, height: 0, overflow: 'hidden', flex: '0 0 0px' }`; on a flex column, swap which dimension matters. Self-check before declaring a hide-style done: "If I open DevTools on the hidden element, what are its computed `width` and `height`? If either matches its content's natural size, the element is still claiming layout space." Alternative when L-005 doesn't apply (no external resources to preserve): just use conditional rendering or `display: none`, which avoid this trap entirely.

---

## L-016: When upstream tools have a strict-and-explosive validator, validate at OUR boundary too

**Date:** 2026-04-08
**Source:** feedback — invalid permission rule "add" silently disabled the entire settings file and surfaced as a blocking Claude Code in-terminal error dialog
**Category:** architecture

**What happened:**
A user typed `add` (lowercase) in the Permissions Manager. The Apiary saved it as-is to the electron-store and propagated it to every drone's `~/.claude/settings.json`. On the next drone spawn, Claude Code's startup parser rejected the rule with `Tool names must start with uppercase. Use "Add"` and **discarded the entire settings file** — every other valid permission was silently dropped. The user got an in-terminal blocking dialog (`1. Exit and fix manually  2. Continue without these settings`) inside the drone pane and had no way to fix it from the Apiary UI. The Apiary had **zero validation** between the input field and the disk write: not in `handleNewCommit` (renderer), not in the `PERMISSIONS_SET_SCOPE` IPC handler (main), not in `permissions-manager.writeSettings` (file write).

**Why the agent got it wrong:**
The agent that built the permissions feature treated rule strings as opaque payloads and trusted the upstream consumer (Claude Code) to validate them. That's a reasonable instinct when (a) the upstream's validation is forgiving — it just ignores bad entries — and (b) the user can see the upstream's error and correct it in place. **Neither was true here.** Claude Code's failure mode is "drop the whole file on any single bad entry," which means one typo can silently disable every other rule the user carefully configured. And the user can't see or correct the error inside the Apiary — they get a modal dialog inside a Claude Code drone terminal pane, which feels like an Apiary bug. The agent never considered the *blast radius* of an upstream validation failure: a strict, all-or-nothing validator at the consumer turns "let it through and let them sort it out" into a silent regression that breaks unrelated functionality.

**How to avoid this in the future:**
When forwarding user input to a downstream tool, ask two questions: (1) **What's the failure mode of the downstream's validator?** Forgiving (skip the bad entry, keep the rest) or explosive (reject the whole file/payload/request)? (2) **Can the user see the downstream's error and connect it back to the input that caused it?** If the answer to (1) is "explosive" OR the answer to (2) is "no," you must validate at YOUR boundary — both at the input field (so the user gets immediate feedback) AND at the write-to-downstream boundary (defense in depth, also self-heals stale invalid data left over from before validation existed). The shared validator should be a pure function in `src/shared/` so both renderer and main can use it. Concrete self-check before shipping a feature that writes user input to an external tool's config: "If the user typo's a single field, what's the worst thing that happens? If the answer is 'a different feature silently breaks,' I need a validator at my own boundary, not a trust-and-pass-through."

---

## L-017: Guard "restore" actions against producing empty windows before creating them

**Date:** 2026-04-09
**Source:** feedback — app launched straight into an empty hive window; manager window was behind it
**Category:** implementation pattern

**What happened:**
On first launch after a testing session, the app opened an empty hive window (no panes) in front of the manager window. The auto-restore-last-session feature checked `dormant.length > 0` and called `hiveManager.activateHive(target.id)` — which creates the Electron window immediately — then filtered `dronesToResume` down to only drones with `sessionId`. When no drones passed that filter (e.g., all drones were launched but never reached a Claude session before the window was closed), the window opened with nothing in it.

**Why the agent got it wrong:**
The agent structured the restore flow as: (1) find a dormant hive, (2) activate it (creates window), (3) filter the drones to resume. Step 2 creates the window unconditionally based on the hive existing, without considering whether step 3 would produce anything to put in it. The agent treated "there is a dormant hive" as sufficient justification to open a window, when the real user-visible condition is "there is something to resume inside that hive." The `sessionId` filter was a detail of the resume-drones logic, not seen as a gate on window creation itself.

**How to avoid this in the future:**
Before triggering any side effect with visible UI cost (opening a window, navigating, displaying a modal), ask: "Will this action produce a meaningful result for the user, or could it produce an empty/useless state?" For resume-last flows specifically: check that `dormantDrones.some((d) => d.wasActiveAtClose && d.sessionId)` BEFORE calling `activateHive`. The same filtering logic that will be applied to the resumed drones should also gate whether activation happens at all. Self-check: "If I apply all the downstream filters to the data right now, would the result be empty? If yes, the action should be skipped or the user should be given a different affordance."

---

## L-018: CSS class rules cannot override inline `style` props — use `!important`

**Date:** 2026-04-09
**Source:** feedback — Configuration screen showed no focus indicator despite correct CSS selector
**Category:** implementation pattern

**What happened:**
The Configuration view's row labels were supposed to turn amber when keyboard focus landed on the row's InlineSelector (`.config-radiogroup`), signaled via `.config-row:focus-within .config-row-label { color: #F59E0B }`. The CSS selector was structurally correct — multiple prior agents confirmed this — but the label **never changed color**. The keyboard interaction (arrow keys changing selection) worked fine; only the visual indicator was missing.

**Why the agent got it wrong:**
The `Row` component renders the label as `<div className="config-row-label" style={{ color: FG_PRIMARY }}>`. The inline `style` prop sets `color: #D4D4D4` directly on the element. In CSS, inline styles have specificity `(1,0,0,0)` — higher than any class or pseudo-class selector. Prior agents inspected the CSS selector, confirmed it was correct, and concluded the fix was already in place. None checked whether the target element had a competing inline style. The bug was invisible from reading only the CSS file; it required cross-referencing the React component to see the inline `style` prop.

**How to avoid this in the future:**
When a CSS rule "should work" but has no visible effect, ask: "Does the target element have an inline `style` prop that sets the same property?" Read both the CSS file AND the JSX that renders the target element. If the element has `style={{ color: ... }}` (or any property the CSS rule also sets), the CSS rule will lose unconditionally — unless `!important` is added to the CSS rule. This pattern is already established in globals.css for button hover/focus states. Concrete self-check: "For the CSS property I'm trying to change, does any ancestor or the target itself have that property as an inline `style` in the JSX? If yes, my CSS rule cannot win without `!important`."

---

## L-019: A "global pass" audit must be screen-driven, not file-driven

**Date:** 2026-04-10
**Source:** feedback — LaunchForm field selections missing hover state after a "global hover pass"
**Category:** scope discipline

**What happened:**
The user asked for a global pass over the whole interface to make hover states consistent. The audit was delegated to an Explore agent that scanned component files by name and searched for `onMouseEnter`/`hover:` patterns. LaunchForm was identified but the agent hedged with "would need review for complete hover coverage" and moved on. That hedge was accepted as close enough to "probably fine" and LaunchForm was omitted from the fix list. The LaunchForm's field selections (inline option selectors in the new-hive form) had no hover state and were missed entirely.

**Why the agent got it wrong:**
The agent equated "I read this file and checked for known patterns" with "I verified all interactive elements in all states." These are not the same thing. A file-driven audit finds what you search for; it misses things that don't match the patterns you're looking for, components that are only rendered in certain UI states, and sub-components that weren't traced through. The "would need review" hedge was a signal that the work wasn't done — but it was treated as a low-confidence pass rather than an explicit gap. The agent also never built a UI map (screens × states) before auditing, so there was no way to know when the audit was complete.

**How to avoid this in the future:**
For any task described as "global," "whole interface," or "everywhere": start by enumerating every distinct screen and UI state before looking at any code. A UI map might be: Manager window (hive list, new-hive form, archives, configuration, permissions), Hive window (pane header, popover menus, completion bar, dormant panel), Dialogs (spawn dialog, etc.). Then audit each entry in the map, not each file. "Would need review" is never acceptable as a final audit status — it means the work is not done. Concrete self-check before declaring a global pass complete: "Can I name every screen and state in this app? Have I verified each one specifically?"

---

## L-020: Skinning is not redesign — structural reimagination must come before pixels

**Date:** 2026-04-16
**Source:** Redesign-planning session — user reported first rebrand pass felt flat
**Category:** scope discipline

**What happened:**
The user asked for a "rebrand / redesign" after functional slices shipped. The first pass executed against `docs/design.md` (a palette + token spec): new background values, new accent value, new typography rules, new input styling. Every component got re-skinned. The test suite stayed green and the token substitution was mechanically correct. But when the user opened the app, **the layout and information architecture were identical**. The management window still used the same 3-zone left-nav + two-column Hives view. Pane chrome still had the same composite header structure. Dialogs still read like the previous product. The user's reaction was that nothing fundamental had changed — just a coat of paint. This precipitated a second planning pass (the one that produced this lesson), which treated the redesign as a structural + visual change from the start.

**Why the agent got it wrong:**
The agent treated "redesign" as "apply the new visual tokens to the existing structure" — a token-substitution task. Two reinforcing factors led to this framing. (1) `docs/design.md` was written as a palette/typography/rules spec with a component audit checklist, not as a layout reimagination. It implicitly said "change these visual properties; leave structure alone." The agent optimized for the checklist. (2) Prior lessons-learned reinforced invariance bias: L-002 (no layout shifts on focus), L-005 (don't unmount components with external state), L-008 (flat grid, don't move panes between parents), L-011 (don't cleanup before user confirm) all said *structural stability is a virtue*. The agent generalized this to "structure is sacred," not realizing those lessons protect *runtime* behavior, not *IA commitments*. Layout / IA / pattern choices were treated as load-bearing when in fact they were open questions. The agent never paused to ask "is the management-window layout itself the right one?" or "does the pane header's composition match a modern product UI?" — it just re-skinned what was there.

**How to avoid this in the future:**
Before starting any redesign pass, the first artifact to produce is a **layout-level reimagination** of the primary surfaces, independent of palette or typography work. Write 2–3 genuinely distinct structural directions per primary surface (e.g., for the management window: "single searchable list", "dashboard-style grid with inline creation", "command-palette-first minimal chrome"). Pick one with explicit rationale. **If the redesign plan does not name what the new layout is before any pixel work, the agent will default to the existing layout.**

Concrete self-check before starting any redesign pass: *"Am I proposing layout changes, or only surface changes? If I closed my eyes and a user saw the redesigned app, would they be able to tell it's the same product with a different palette — or would the layout itself feel different?"* If the honest answer is "same layout, different palette," this is a re-skin, not a redesign. Stop and produce the layout directions first.

Secondary check: the invariance-bias trap from L-002 / L-005 / L-008 / L-011 is about *runtime behavior and data lifecycle*, not *IA*. A pane's React parent element must not change (L-008), but the pane's visual composition, the surrounding toolbar, and the entire window layout are fair game. These two categories — "runtime-structural" and "IA-structural" — must not be conflated. Runtime-structural is sacred. IA-structural is redesign territory.

---

## L-022: Tailwind color token keys must not include the utility's property prefix

**Date:** 2026-04-21
**Source:** Visual redesign feedback — three rounds of "the backgrounds all look identical" despite aggressive token-value changes
**Category:** implementation pattern

**What happened:**
`tailwind.config.ts` defined surface color tokens with keys like `'bg-canvas'`, `'bg-surface'`, `'bg-raised'`, `'bg-overlay'`, `'bg-sunken'`, each pointing at a CSS custom property. Components throughout the renderer wrote `className="bg-canvas"`, `className="bg-surface"`, `className="hover:bg-raised"`, etc. None of those classes were generated by Tailwind — the only `.bg-*` utilities in the compiled bundle were `.bg-accent`, `.bg-border-subtle`, `.bg-danger-fg`, `.bg-terminal-bg`, `.bg-transparent`, and `.bg-zinc-600`. Every surface class in the codebase was a silent no-op, and every element "using" a surface token rendered the underlying canvas color (set on `html/body/#root` in `@layer base`). Two rounds of increasing the contrast between token VALUES produced zero visible effect because the differentiating classes never existed to apply those values. A handful of `bg-[var(--color-bg-sunken)]` arbitrary-value workarounds elsewhere in the code should have been a flag that the primary tokens were broken, but each prior pass missed it.

**Why the agent got it wrong:**
Tailwind generates background utilities as `.bg-<color-key>`. For `colors: { canvas: ... }`, that emits `.bg-canvas` — correct. For `colors: { 'bg-canvas': ... }`, it emits `.bg-bg-canvas` — and if no source code references `bg-bg-canvas`, nothing is emitted at all. The original migration author named tokens `bg-*` to *signal intent* ("these are background-purpose tokens"), not realizing that Tailwind applies the `bg-` property prefix itself when emitting the class. The name read as self-documenting to a human but was a silent naming collision to the compiler. Compounding the problem: when later feedback said "the colors aren't changing," each follow-up pass pushed harder on the same lever (wider token values in `globals.css`, more contrast) without questioning whether the classes those tokens flowed into even existed. "My change should have worked" is not evidence that the change is reaching the browser — at no point did any agent inspect the compiled CSS to verify the utility actually existed.

**How to avoid this in the future:**
Two checks, one design-time and one debug-time.

*Design-time* — before naming any Tailwind color token, ask: "What utility class name will Tailwind emit from this?" The formula is always `<property-prefix>-<token-key>`, where `<property-prefix>` is `bg-` for `backgroundColor`, `text-` for `color`, `border-` for `borderColor`, `ring-` / `divide-` for theirs. The token key must NOT start with any of those prefixes, or you create a double-prefix collision (`.bg-bg-canvas`). Use semantic names for the purpose (`canvas`, `surface`, `raised`, `accent`) — Tailwind prefixes handle the context.

*Debug-time* — when a CSS-class-based style change has no visible effect and a second attempt also fails, STOP pushing on the input (token values, color math, contrast) and verify the output. Run `grep -oE "\.bg-[a-z0-9-]*" <built-css> | sort -u` (or the equivalent DevTools inspection) to confirm the utility class you're relying on actually exists in the compiled bundle. Self-check: "Have I seen the class I'm depending on appear in the compiled CSS, or am I assuming Tailwind generated it?" A no-op utility produces no error — only the absence of visual change — so the only reliable confirmation is the compiled output.

---

## L-021: Migration aliases must be explicitly retired — they do not self-delete

**Date:** 2026-04-21
**Source:** Phase VIII redesign cleanup
**Category:** scope discipline

**What happened:**
After an eight-phase redesign, `constants.ts`, `tailwind.config.ts`, and component files still contained a mix of retired token aliases, legacy color names, and inline hex constants. Some aliases (`BORDER_FLASH_INTERVAL_MS`, `BORDER_FOCUSED_HEIGHT_PX_FALLBACK`) had zero callsites. Others (`accent-honey`, `FG_MUTED`, `HONEY`) still had callsites pointing at outdated values. None had been cleaned up — each phase had left them in place "until later."

**Why the agent got it wrong:**
Each implementation phase correctly added the new names alongside the old ones (additive migration is safe). But no phase had been explicitly assigned the task of *removing* the old names. The aliases were tagged with comments like "kept for backward compat during migration" without specifying when migration would be considered complete. Because each phase focused only on its own additions, the retirement step fell through the cracks. The agent treated additive migration as a complete migration.

**How to avoid this in the future:**
When adding a migration alias with a comment like "kept for backward compat" or "will remove after callsites migrate," that comment is a promise that needs a delivery date. Either (a) include the alias retirement in the same phase that migrates all callsites, or (b) explicitly schedule it as a Phase N+1 task. Do not leave it as ambient tech debt with no owner. Self-check at the end of any phase that adds aliases: "Are there any now-unused aliases I introduced in an earlier phase that I can clean up in this commit?"

---

## L-023: A "do this for all" action must match the union of its per-item counterparts

**Date:** 2026-04-21
**Source:** feedback — "Tend grove" on a dormant grove opened an empty window and didn't even show dormant trees
**Category:** UX pattern

**What happened:**
A dormant grove's detail view offers two Tend affordances: a per-tree "Tend" button on each dormant row, and a grove-level "Tend grove" button in the header. Clicking the per-row "Tend" worked (the specific tree resumed). Clicking grove-level "Tend grove" opened an empty window that showed neither resumed trees nor the dormant list — a dead end. Root cause in `hive-manager.activateHive`: the two paths diverged on the filter applied to `dormantDrones`. With an explicit `droneFilter` (per-row click) the filter was `paneId ∈ filter`. With no filter (grove-level click) it was `wasActiveAtClose === true`. Trees closed individually (completion/merge/manual close) have `wasActiveAtClose: false` and were silently excluded from the grove-level path, even though the same tree was resumable via the per-row button. Compounded by the grove window's empty state hiding the `DormantDronesPanel` entirely when no panes resumed, leaving no recovery affordance.

**Why the agent got it wrong:**
Two reasoning slips. (1) The `wasActiveAtClose` filter was designed for an auto-restore semantic ("when reopening, resume what was running") and then reused as the default for a manual user action ("Tend this grove"). The agent conflated two different intents: system-initiated restore (should be conservative, only resume things that were in progress) and user-initiated activation (the user just asked; honor the request in full). A filter appropriate for one is the wrong default for the other. (2) The agent didn't cross-check the two Tend code paths against each other. "Tend one" and "Tend all" are the same user intent at different granularities — if clicking Tend on every row one-by-one would resume N trees, clicking "Tend grove" must resume the same N. The agent implemented each path independently without asking whether the implied user model ("Tend all = Tend each") held end-to-end.

**How to avoid this in the future:**
When a UI offers both a per-item action and a "do this for all" counterpart, verify at implementation time that the set of items affected by the group action equals the union of what the per-item action would affect across every item. Concrete self-check: *"If the user clicked the per-item action on every row individually, would the result equal the result of clicking the group action once? If not, the group action is either under-applying (silently skipping items the user expects covered) or over-applying (hitting items the per-item affordance wouldn't)."*

Secondary lesson: filter predicates carry an implicit intent. Before reusing a filter as a default in a second call site, ask what semantic it encodes. `wasActiveAtClose` encodes "was in progress when the hive closed" — a resume-what-was-running semantic. That semantic fits auto-restore-on-launch but not user-initiated reactivation, where "I want my grove back" means all of it. A filter appropriate for system-conservative paths should NOT be the default for user-explicit paths.

Related: L-017 captured the same family of bug (empty windows produced by filters in the resume path) for auto-restore specifically; this lesson generalizes it to any parity relationship between per-item and group affordances.

---

## L-024: Permanent UI fixtures must show placeholders, not disappear, when data is pending

**Date:** 2026-04-21
**Source:** feedback — recurring: "the rate limits bar simply doesn't load when a grove window opens"
**Category:** UX pattern

**What happened:**
The RateLimitBar was designed as a permanent bottom bar for non-API-billing groves — structurally part of the window, like a status bar. But it was gated twice on data arrival: WindowShell only rendered its container when `rateLimits` was non-null, and the bar itself returned `null` when both its windows were missing. Rate-limit data only flows from Claude Code's statusline after a model turn completes, so every fresh grove window — and every grove window opened before the account had exchanged a turn that session — simply had no bar. Users saw an empty gap where a permanent element was supposed to live and read it as broken. The user reported this as "a recurring issue," meaning prior fix attempts had addressed data-flow symptoms without questioning the "hide until data exists" framing.

**Why the agent got it wrong:**
When a component receives data that "might not be available yet," the React default is `if (!data) return null`. That default is correct for *conditional content* (a warning banner, an expanded detail card, a tooltip) — things that should only appear when there's something to say. It is wrong for *structural fixtures* — bars, rails, headers, footers, status strips — whose presence is part of the window's contract with the user. A rate-limit bar that disappears is indistinguishable from a rate-limit bar that's broken. The agent conflated "pending data" with "no content," didn't ask whether the element was supposed to be permanent or conditional, and took the lazy path of hiding rather than designing a placeholder state.

**How to avoid this in the future:**
Before writing `if (!data) return null` in any layout-adjacent component, ask: *"Is this element part of the window's permanent chrome, or is it conditional content that only makes sense when data is present?"* If it's permanent chrome, render a placeholder that occupies the same footprint (same width, same height, same border) with a dim state — em-dash, skeleton, "—", or similar. The user must be able to tell the difference between "data is pending" and "this feature is broken" at a glance. The test for a structural fixture: if the product spec says "every window should have X," then X must render from the first frame, not from the first data tick.

Concrete self-check during component design: *"If the backing data source silently stopped emitting, would the user notice the component's absence and interpret it as a bug?"* If yes, it's a structural fixture and needs a placeholder state; don't let it return `null`. Only components whose absence is indistinguishable from normal use (no warning exists → no warning shown) are allowed to disappear entirely.

Related: L-002 (borders must not cause layout shifts) — the placeholder must share dimensions with the real gauge so incoming data doesn't reflow the bar. Same family: invariance-from-the-first-frame for structural UI.


---

## L-025: Wrapping a component that owns its own DOM focus creates two sources of truth

**Date:** 2026-04-21
**Source:** feedback — clicks on a pane did not move the focus ring, though keyboard input still reached that pane
**Category:** implementation pattern

**What happened:**
In a multi-pane grove the user clicked pane 2. The gold focus border did not move; a second click did nothing; a third click finally worked. Meanwhile the user typed, submitted, and Claude actually replied in pane 2 — meaning xterm.js had received DOM focus on click 1 and was routing keystrokes correctly. Two sources of truth were disagreeing: xterm`"'`s real DOM focus (textarea) said pane 2; React`"'`s `focusedPaneId` still said pane 1. `Pane.tsx` drove `focusedPaneId` from an `onClick` on a wrapper `<div>`, and that synthetic click was unreliable when the real click landed inside xterm`"'`s internal DOM (canvas, viewport, helper textarea) — xterm`"'`s own mousedown handling focuses the textarea immediately but the click did not always reach React`"'`s handler. The fix: subscribe to `term.textarea` `"'`focus`"'` events and mirror them into `setFocusedPane(paneId)`, making xterm`"'`s DOM focus the single source of truth for which pane is active.

**Why the agent got it wrong:**
When a third-party component (xterm.js, Monaco, CodeMirror, a video player, a custom web component) manages its own focus internally, the agent`"'`s default React instinct is to model \"which child is active\" as parent state driven by `onClick` handlers. That instinct treats focus as ordinary application state. But the wrapped component already has an authoritative focus signal — the browser`"'`s DOM focus on the element it controls — and any parallel state the parent maintains is a mirror that can drift. The agent modeled a mirror as though it were the primary, and relied on click-bubbling through the child`"'`s internal DOM to keep the mirror in sync. Whenever the child intercepts, reorders, or swallows the event, the two diverge.

**How to avoid this in the future:**
When wrapping a component that (a) exposes a `.focus()` method, (b) contains an internal focusable element, or (c) has its own mousedown/click handling, do not make parent state the primary source of truth for \"is this child focused.\" Subscribe to the child`"'`s native `focus` event (usually on its internal input/textarea/contenteditable) and mirror from DOM focus into React state. Concrete self-check before writing `onClick={() => setFocused(id)}` on a wrapper: *\"Does the wrapped component own a DOM element that receives keyboard focus independent of my handler? If yes, the `focus` event on that element — not my click handler — is the source of truth, and my parent state should mirror it.\"* Do not also mirror `blur`: losing window focus should not clear the \"active pane\" indicator.

---

## L-026: Batch-spawning N children that each own a listener requires a per-child ready handshake

**Date:** 2026-04-21
**Source:** feedback — the first tree in a freshly planted 4-tree grove rendered with only the mascot and cwd path; the "Claude Code v2.1.116" header, model/effort line, and input prompt were missing
**Category:** architecture

**What happened:**
`HIVE_CREATE_WITH_DRONES` spawns all PTYs in a synchronous for-loop after receiving the window's `RENDERER_READY`. Each PTY's `onData` callback forwards output via `webContents.send(PANE_DATA, …)` immediately. But each pane's `pane:data` listener lives inside `XTermView`, which only mounts after React processes the `PANE_SPAWNED` state updates and re-renders. The first PTY in the loop has the longest head start between spawn and listener-attached; Claude's banner for that pane was emitted and dispatched to `ipcRenderer` while no handler was registered, and Electron silently dropped it. Panes 2–4 spawned milliseconds later and their banners arrived after the listeners were live, so only pane 1 appeared broken. Fix: add a main-side per-pane `PaneSpawnBuffer` that gates `PANE_DATA` forwarding until each `XTermView` sends its own `PANE_READY` signal from the initial-fit `useEffect`, then flushes as a single concatenated chunk.

**Why the agent got it wrong:**
L-006 and L-014 already captured that `RENDERER_READY` is a *root-component* signal, not a global \"the app can receive IPC\" signal. The agent correctly applied that pattern at the window level. But when a single parent IPC event (`PANE_SPAWNED`) causes N sibling children to mount, each owning its own listener, the agent reused the same window-level handshake implicitly — assuming that \"the window is ready\" meant all its panes' listeners would be attached by the time data flowed. It didn't. The race compounds with batch size: the earlier a child mounts in the loop, the more data is emitted before its listener exists. The agent's mental model was \"one handshake per window\" when the problem required \"one handshake per dynamically-mounted listener-owning component.\" Compounded by the fact that this bug is *positional* — it only hits the first child in the batch — which reads like a layout/sizing issue (\"something wrong with pane 1 specifically\") and misdirects diagnosis toward PTY cols/rows, CSS, or React key stability.

**How to avoid this in the future:**
When a parent IPC event causes the main process to start producing per-child data streams *and* the children that own the listeners for those streams mount asynchronously (via React state → re-render → useEffect), a parent-level `RENDERER_READY` is insufficient. Each child needs its own ready handshake, and the main process must buffer per-child output from spawn-time until that child signals ready. Concrete self-check before sending child-scoped IPC: *\"Does the listener for this message live in a component that mounts synchronously with the sender, or in a component that will mount one or more render cycles later as a result of this same IPC?\"* If the latter, the data needs per-child gating on the main side — the same shape as `PaneTransitionBuffer`/`PaneSpawnBuffer`: `open(id, onTimeout)` on spawn → `capture(id, data)` in the producer callback → `flush(id)` on the child's ready signal → safety timeout so a renderer crash cannot pin memory.

Secondary self-check when diagnosing a \"it only breaks for the first one\" symptom: suspect a race whose window widens with each item in a batched loop before suspecting per-item configuration. \"First item is broken, rest are fine\" and \"last item is broken, rest are fine\" are the two classic shapes of mount/flush races in a for-loop producer. The first-item shape points at listeners attaching *after* data has been sent; the last-item shape points at flushes happening *before* the last data has been written.

Related: L-006 (don't trust `did-finish-load`), L-014 (`RENDERER_READY` only covers root-component listeners). L-026 extends the same family from the window level and the single-child-lazy-mount case to the per-child dynamic-batch case.

---

## L-027: A relationship encoded in two places must be updated in both on every mutation

**Date:** 2026-04-22
**Source:** feedback — after moving a tree to a new grove, the management pane showed the source grove still at 5 trees and the new grove at 0
**Category:** architecture

**What happened:**
Transplanting a tree to another grove moved the pane's `windowId` in the session registry (so PTY output routed correctly and the right window rendered it), but did nothing to the hive records. The source hive's `activeDroneIds` still listed the moved pane, and the target hive never added it. `buildManagerState` reads tree counts directly off `hive.activeDroneIds.length`, so the manager showed correct grove names but stale counts (5 + 0 instead of 4 + 1). The same stale-membership problem also meant that closing the moved pane later would have removed it from the wrong hive's dormant list, because `pane.hiveId` was never updated either.

**Why the agent got it wrong:**
Pane membership is encoded in two places that must stay in sync: **session-registry** (each `PaneState` has `hiveId` and `windowId`) and **hive-manager** (each `Hive` has `activeDroneIds: string[]`). The move handler was written against the *visible* half of the relationship — the `windowId` field — because that's what determines where PTY data flows and which React tree renders the pane. The hive side is invisible at move time: nothing in the source or target *window* depends on `activeDroneIds`. It's only the manager window, which may not even be open during a move, that reads the counter. The bug was asymptomatic during single-window workflows and only surfaced when a user happened to have the manager open while transplanting.

The agent's implicit mental model was "moving a pane = moving a window", which is true for the runtime-routing half of the system and false for the bookkeeping half. The two halves were authored at different times for different purposes, so no single place in the code says "these must move together."

**How to avoid this in the future:**
When the same logical relationship is stored in two places (forward + reverse index, parent pointer + child list, membership field + membership array), every mutation site must update both — and the search for mutation sites must include *all* verbs that could change the relationship, not just the obvious one. For memberships specifically: "insert" and "remove" are easy to spot, but "move" is an insert-and-remove pair that often gets written against only one index.

Concrete self-check before merging any "move X from A to B" code: *"How many places in the codebase encode X's current container? Have I updated each of them, and is each mutation paired — removed-from-A with added-to-B, not just one side?"* List them explicitly before writing the code. In this project: `PaneState.windowId`, `PaneState.hiveId`, `Hive.activeDroneIds` all encode container membership; all three need a write on every move.

Secondary check: if the bug's visibility depends on whether an *observer surface* (like the manager window) is open, that's a signal you've forgotten to notify the observer. Any mutation that affects aggregate state the manager displays should end with `pushManagerUpdate()`. The safest pattern is to co-locate the notification with the state change in a helper (e.g., `moveDroneBetweenHives` + a follow-up `pushManagerUpdate` at the call site) rather than sprinkling notify calls across every IPC handler.

---

## L-028: Transplant is a resize-and-focus-steal collision — two xterm.js assumptions break at once

**Date:** 2026-04-22
**Source:** feedback — after moving a tree to a new grove, the source window's 4 remaining terminals went blank and the target window's single terminal rendered content crammed into the left ~35% of the pane
**Category:** implementation pattern

**What happened:**
Two separate xterm.js rendering bugs both triggered by a single transplant:

1. **Source window blank canvases.** `PANE_CLOSED` removed the 5th pane from the React grid, which caused CSS Grid to reflow the 4 survivors into 2×2 cells. Each surviving pane's `ResizeObserver` fired → `fitAddon.fit()` → xterm internally called `_renderService.clear()` and queued a re-render via `requestAnimationFrame`. Meanwhile the new grove window had just called `win.focus()`, backgrounding the source window. Electron throttles rAF on backgrounded webcontents, so the queued re-render never ran. When the user switched back, the existing `visibilitychange` handler ran `clearTextureAtlas()` — which clears xterm's WebGL glyph cache but does *not* re-queue a draw pass — so the canvases stayed black.

2. **Target window misaligned content.** The transplant captured a snapshot with `SerializeAddon.serialize()` on the source and replayed it with `term.write()` on the target. `SerializeAddon` emits an ANSI sequence that reproduces the terminal's rendered state with **hard line-wraps baked in at the source's column count**. Writing that snapshot into a much wider terminal does NOT reflow — xterm honors the embedded wraps — so the content stayed at ~1/5 width inside a full-width pane.

**Why the agent got it wrong:**
Two distinct unfounded assumptions, both flowing from "fit() works" and "serialize+restore works" being taken at face value without reading what those APIs actually do in edge cases.

1. For the blank-canvas case: the assumption was "`fitAddon.fit()` resizes the terminal and the content stays visible." In a foreground window, this is effectively true because the clear-then-redraw cycle completes within one frame. The failure only shows when a resize happens *at the same moment a window is being backgrounded* — which is exactly the transplant flow, because the new window steals focus immediately after the source's grid reflows. The agent (including prior sessions captured in L-008) knew that `fit()` was destructive but didn't generalize to "any rAF-deferred draw can be throttled if focus moves before it fires."

2. For the misaligned content case: the assumption was that a "serialized buffer" is a logical representation of content that reflows when written into a differently-sized terminal. `SerializeAddon`'s output is actually a sequence of ANSI escapes that *reproduces exactly what was on screen*, pixel/column position included. It is a visual snapshot, not a semantic one. An agent who hasn't read SerializeAddon's source assumes the name means something more abstract than it does. The "buffer" mental model from plain text/PTY byte streams doesn't apply.

**How to avoid this in the future:**
Two concrete self-checks, one per bug:

*For rAF-deferred rendering work:* before relying on a scheduled redraw to complete, ask: *"Between when this rAF is scheduled and when it would fire, could the window be backgrounded, hidden, minimized, or closed?"* If yes, the draw may never run. Either (a) force the work synchronously within the same frame the trigger fires, using `terminal.refresh()` or equivalent immediate-queue APIs, and/or (b) re-queue the work on `visibilitychange` when the window becomes visible again. `clearTextureAtlas()` is not a substitute for `refresh()` — the former clears the glyph cache, the latter actually queues a draw pass.

*For "serialize and restore" library APIs:* before using any `serialize()` / `toBuffer()` / `snapshot()` API to move state between two instances, read the docstring or source to determine whether the output is a **logical** representation (reflows / adapts to the new context) or a **visual/frozen** representation (baked-in at the source's rendering context). For xterm.js specifically: `SerializeAddon` is frozen — it captures hard wraps and cursor positions at source column count. If the target has a different size, don't replay the snapshot; let the underlying process redraw via a resize signal (for a TUI, the `SIGWINCH` triggered by `ptyPool.resize()` is sufficient). Self-check: *"Does the target context exactly match the source context this snapshot was captured in? If any dimension/config differs, is this snapshot API designed to reflow, or will it display incorrectly?"*

Related: L-008 (fitAddon.fit is destructive — this lesson generalizes the "when the deferred redraw doesn't fire" case from multi-pane resize to background-window throttling). L-012 (read the library's required assets and APIs before writing workarounds).


## L-029: Serializing your own writes is not enough when shared resources are contended by readers too

**Date:** 2026-04-22
**Source:** feedback — "Merge all (this grove)" with two dirty panes in the same repo; the first pane merged successfully, the second failed with `fatal: Unable to create '.../.git/worktrees/orchard-89c2-4/index.lock': File exists. Another git process seems to be running in this repository`
**Category:** implementation pattern

**What happened:**
The merge-all path hands each eligible pane to `CompletionExecutor.executeMerge`, which feeds entries into `MergeQueue` — a per-repo FIFO that guarantees only one merge per `repoRoot` is in flight at a time. That design assumption was: "serialize merges → no git contention." But the contended resource is the *worktree*'s `index.lock`, and that lock is also held — briefly — by read-only operations elsewhere in Orchard:

- `git-status-poller` runs `git status --porcelain` every 30 s on every pane and, via `hook-listener`, immediately on every Stop/done hook. `git status` refreshes the stat cache and holds `index.lock` during that refresh.
- If the poller's 5 s `GIT_TIMEOUT` kills a running git process mid-flight, the lock file can be left behind entirely.

Result: when the second pane's auto-commit fired inside the merge-all queue, it raced the poller on the same worktree and failed. The serialization guard was against the *wrong class of competitor*.

**Why the agent got it wrong:**
The MergeQueue was written with a plausibly-complete mental model: "two merges into the same repo will collide, so we serialize them." The model accounted for *writers racing writers*. It didn't account for the fact that in this system, the same main process is constantly running *readers* against the same worktrees (the poller) — and that some of those readers briefly take the index lock too. The hidden assumption was "read-only git commands don't contend with writes." That is false for any command that can refresh the stat cache.

More generally: when you write a serialization primitive against a shared resource, it's easy to only consider the specific operations in scope for that primitive. Other processes — schedulers, pollers, hooks, external tooling — may also touch the same resource without ever going through your queue. The queue makes *your* side orderly but does nothing about theirs. Stale state left behind by a killed or crashed process is a second, related hole: a timeout-based cleanup deletes the process but not the lock file it wrote.

**How to avoid this in the future:**
When adding a queue or mutex to serialize operations against a shared resource, enumerate *every* place in the codebase that touches the same resource, not just the ones your queue covers. For git specifically, that means: any code path that shells out to `git` in a given worktree is a potential index.lock holder, including read-mostly commands like `status`, `fetch`, `fsck`, and `gc`. Look up the actual locking behavior of each git subcommand you rely on rather than assuming "read commands are safe."

Two concrete patterns to apply when full serialization isn't feasible:

1. **Retry transient lock contention at the command site, not the queue.** If the contender is outside your queue's control (poller, hook, external tool), retries with short backoff (e.g., 100/300/900 ms) absorb the race cleanly. Wrap every write-side git call through one retry helper rather than sprinkling try/retry per call site.

2. **Differentiate transient contention from stale locks.** A lock older than ~30 s with no live holder is almost always orphaned from a killed or crashed process. Don't auto-delete — another legit process *could* be holding it — but surface a targeted, actionable error pointing at the lock path, instead of the raw git stderr.

Self-check before merging any code that runs a mutating command against a shared repo/worktree/database: *"What other processes in this app — timers, hooks, pollers, status watchers — also touch this resource? Do they go through my serialization primitive, and if not, am I retrying on the specific transient-contention errors those processes cause?"*

Related: L-002 (the merge queue itself — its correctness for writer-vs-writer doesn't guarantee safety against readers).

---

## L-030: `requestAnimationFrame` coalesces to 60Hz — it does not debounce external consumers

**Date:** 2026-04-22
**Source:** feedback — resizing the window produced duplicated tool-use blocks, overlapping text on the same row, and stranded `[39m` SGR fragments in visible Claude Code panes
**Category:** implementation pattern

**What happened:**
`XTermView`'s `ResizeObserver` wrapped its resize work in `requestAnimationFrame` with the intent of "debouncing" the firehose of observations during an active drag. Inside the rAF callback it ran `fitAddon.fit()` (reflows xterm's buffer to a new column count) and sent `PANE_RESIZE` (which reaches main-process `ptyPool.resize`, causing a **SIGWINCH** to Claude Code). During a continuous drag this still fires roughly every frame — ~60Hz. Claude Code's TUI is a cursor-addressed redrawer: on each SIGWINCH it emits "move cursor up N, clear to end, rewrite" sequences to redraw message history. At 60 redraws/sec against a column count that's already changed by the time the next frame arrives, Claude's cursor math lands on rows that have been reflowed to a different width — producing visible text overlap ("thimble of dew.r her" — two separate sentences colliding), whole tool-use blocks rendered twice, and `[39m` left on screen without its escape byte where a SGR sequence was interrupted mid-write by the next redraw.

**Why the agent got it wrong:**
`requestAnimationFrame` is often used as a one-liner "debounce" in resize handlers, and it **is** the right tool when the thing being protected is the renderer itself (e.g., "don't run this layout work more than once per paint"). The agent conflated that case with this one. Here the thing being protected is a **downstream external consumer** — Claude Code — whose cost per call is "redraw the entire visible chat history via cursor addressing," which takes well more than one frame to complete. Wrapping the work in rAF ensured we don't do the work twice per frame, but it did nothing to reduce the firehose from the external consumer's perspective. The mental model was "rAF = debounce" when the correct model is "rAF = coalesce-to-frame-rate." They are not the same thing.

Compounded by: `fitAddon.fit()` reflowing the xterm buffer on the *same* rapid cadence. Even without SIGWINCH, continuous reflow of a buffer that the TUI is concurrently writing to creates race windows where a write straddles a reflow boundary, which is exactly how an SGR byte sequence ends up split with its `\x1b` byte on one side and `[39m` stranded on the other.

**How to avoid this in the future:**
Before wrapping a high-frequency event handler in `requestAnimationFrame`, ask: *"Who pays the cost of the work inside the rAF? If that consumer is external to the renderer — a subprocess, a PTY, an IPC-bound worker, a network peer — rAF is the wrong primitive, because 60Hz is still a firehose from their perspective."* Use a trailing `setTimeout` debounce (100–200ms) for resize-to-external-process plumbing; use rAF only for renderer-internal layout work.

Concrete self-check when touching any resize/scroll/observer handler: enumerate every side effect inside the callback. For each side effect, classify it as (a) renderer-internal work bounded by paint cadence — rAF is fine — or (b) a dispatch to something *outside* the renderer (PTY, subprocess, IPC, network). Any (b) side effect forces a trailing debounce; rAF alone is insufficient.

Related: L-008 (`fitAddon.fit()` is destructive — its cost extends beyond the rAF tick because it schedules its own deferred redraw). L-028 (rAF-deferred work can be throttled when a window is backgrounded — a different failure mode of the same "rAF ≠ reliable pacing" family).

---

## L-031: Name and centralize "our own infrastructure" paths — a filter with one named exception is a pattern in disguise

**Date:** 2026-04-22
**Source:** feedback — "Merge all" on a fresh-init grove failed on every pane with `main has uncommitted changes (1 file)`; the 1 file was Orchard's own `.worktrees/` directory
**Category:** implementation pattern

**What happened:**
Orchard's dirty-main detection calls `isWorkingTreeClean(repoRoot)` → `countUserChangedFiles(porcelainOutput)`, which counts entries in `git status --porcelain` output while filtering out `.claude/` (the per-project settings Orchard writes at spawn time). On a brand-new directory the user spawned a grove over, Orchard does `git init` + `ensureRepoHasInitialCommit` + `git worktree add .worktrees/wt-XXX ...` — which creates a `.worktrees/` directory inside the main repo. Git sees `.worktrees/` as untracked content in the main working tree. The filter didn't know about it, so the dirty-main check counted it as 1 uncommitted file and the user got the same error on every pane's merge, with no actionable fix (the user can't just `git add .worktrees/` — it's Orchard's own scaffolding, not user work to commit).

**Why the agent got it wrong:**
The original author of `countUserChangedFiles` filtered `.claude/` *specifically*, as a named exception: two hardcoded checks for `!file.startsWith('.claude/') && file !== '.claude'`. That implementation encoded a concept — *"Orchard's own infrastructure in the main repo must not count as user work"* — without naming it. When a second instance of that concept was added months later (`.worktrees/` — linked worktree roots Orchard writes to the main repo), nobody updated the filter because there was no abstraction to cue them. The inline literal `.claude/` reads as a one-off workaround, not as a category with members. The trap: **a filter with one named exception looks like a special case, but if the reason it exists generalizes at all, it's a pattern with a membership list masquerading as a hardcoded check.** And patterns-without-names rot — each new member is added somewhere else, or not at all.

Compounding factor: `.worktrees/` presence in main is an *invisible* consequence of `git worktree add <repo>/.worktrees/<name>` rather than an explicit file write. The agent who added the worktree-creation code didn't search for where Orchard filters its own paths, because from their perspective they were calling a git command, not writing a file. "If I don't write a file, I don't have to think about the dirty-main filter" — false, because git treats the worktree directory as a thing in the main working tree regardless of how it got there.

**How to avoid this in the future:**
Two checks, one for filters and one for infrastructure writes.

*When you write a filter with a named exception, ask: "Could a future change add another member to this exception?"* If the answer is anything other than a firm no (e.g., the exception is tied to a fundamental language keyword or git-internal filename), the filter is really an exclusion list for a named category. Extract a small helper — `isOrchardInfrastructurePath(file)` — and route all callers through it. Put the members in one place so the next person adding a member gets it by updating one function, not by knowing about every call site. Concrete self-check: *"Is the reason this filter exists specific to this one path, or specific to a category this path belongs to?"*

*When you add code that creates files or directories in a user-visible location (repo root, home dir, project root), ask: "Will my write appear in anyone's `git status`, `ls`, watcher, or linter?"* If yes, identify the filters/excludes that already handle the existing set of app-owned paths and add yours. Concrete self-check before merging infrastructure-write code: *"Grep for every existing special-cased app path. For each place it's referenced, does my new path belong there too?"*

Related: L-016 (validate at our own boundary when a downstream's failure is explosive) — this lesson is adjacent but distinct: L-016 is about inputs we forward to downstreams; L-031 is about outputs we write that downstreams then read. Both come from the same underlying discipline of owning the full data path through our boundary.

---

## L-032: `git diff` does not see untracked files — one git command rarely represents "everything that would land"

**Date:** 2026-04-22
**Source:** feedback — Grove Keeper said "0 files with changes" on a freshly-created grove whose trees had just written new .md files; the per-pane "Done · 1 modified" header correctly showed the changes because it used a different git command
**Category:** implementation pattern

**What happened:**
The Grove Keeper's per-tree diff stats (`filesTouched`, `linesAdded`, `linesRemoved`) were built from `git diff --numstat <base>`, chosen because it unifies committed + working-tree-modified changes into a single numeric view. Correct claim for TRACKED files — wrong claim for "everything that would land if the user hit Merge." When Claude writes a brand-new file and doesn't run `git add`, the file is **untracked**. `git diff` ignores untracked files entirely — they live in `git status --porcelain` as `?? path` but never appear in any `git diff` output. Result: the Keeper reported 0 files changed on trees the user had just watched Claude write files in, while the per-pane completion header (which uses `git status --porcelain` via `countUserChangedFiles`) correctly showed "Done · 1 modified" with a working Merge button. Two Orchard UI surfaces disagreed about the same tree.

**Why the agent got it wrong:**
The agent treated `git diff` as a single comprehensive "what's different from main" command, reasoning: "diff = all differences, including uncommitted — one command covers everything." That's wrong in two ways that reinforced each other. (1) Git's mental model of a file splits into several distinct states — *tracked-committed, tracked-staged, tracked-unstaged-modified, untracked, ignored, deleted, renamed* — and no single bare command enumerates all of them. `git diff` enumerates a specific subset (tracked changes vs some ref). `git status` is the only command that unifies the lot, and it does so with a different output format that's not a diff. The agent carried a simpler mental model ("diff = all changes") that glossed this over. (2) The agent didn't cross-check against an existing authoritative source in the same codebase. `countUserChangedFiles` already existed, already worked through `git status --porcelain`, already powered the per-pane UI — it was the proven source of truth for "does this tree have user changes." Using a totally different command (`git diff --numstat`) for a parallel code path without verifying they produced matching counts on the same inputs was the core slip.

Secondary contributor: the test suite used numstat-shaped fixtures, so the "ready count is correct" tests passed uniformly. The tests encoded the agent's wrong mental model, which silenced the only feedback loop that would have caught it. A test like "tree with only untracked files counts as ready" would have failed immediately — but that test didn't exist because the agent wasn't thinking about that state as a distinct case.

**How to avoid this in the future:**
Two checks.

*When using a single git command to represent "the user's changes," enumerate the file states that command captures and the ones it misses.* For each file state git recognises — `tracked-modified`, `tracked-staged`, `untracked`, `deleted`, `renamed` — ask: *"If the user's tree were in exactly this state and nothing else, would my command report it?"* If the answer is "no" for a state the user can plausibly be in, the command is incomplete. For "everything that would land vs a base branch," you almost always need `git diff <base>` (tracked) + `git ls-files --others --exclude-standard` (untracked), unioned. Or use `git status --porcelain` if line counts don't matter. Never trust that one command covers all states without walking the list.

*When a parallel code path in the same project already reports a closely-related number, treat divergence as a bug by default.* Before shipping code that computes "what has changed," grep for every existing "has changes" / "file count" / "dirty" computation in the codebase. For each one, identify the git command it runs and the states it captures. If your new code uses a different command family, either route through the existing helper or add a test that asserts both paths agree on a shared input. Self-check: *"If my code says a tree has 0 changes and another part of the app's UI says it has 1, which one is right — and why didn't the existing helper get reused?"*

Related: L-010 (verify external data schemas against actual runtime output, not documentation) — same family of "assumption about an external tool's behavior turns out to be wrong"; L-010 is about data formats, L-032 is about command coverage.

---

## L-033: "Every mutation site manually pushes" is the convention most likely to be broken by the next mutation site

**Date:** 2026-04-23
**Source:** feedback — user launched a grove with two trees, added two more, Grove Keeper popover still read "2 panes"
**Category:** architecture pattern

**What happened:**
`Workspace.activePaneIds` is read twice: the owning grove window reads it via per-pane state it already holds, and the Keeper (Manager) window reads a serialized count (`activePaneCount`) that arrives only when someone calls `workspaceManager.pushManagerUpdate()`. Across `src/main/ipc-handlers.ts`, ~16 handlers that mutate workspace state call `pushManagerUpdate()` explicitly at the end. Two handlers were missed: `PANE_SPAWN` (inside a ~300-line handler that returns `{ error: null }` as its success path) and `closePaneInternal` in `pane-lifecycle.ts`. Because the grove window derives pane count from its own per-pane state, the window itself looked correct — only the Keeper's view of the grove was stale. The bug was invisible unless you happened to have the Keeper popover open for that grove while spawning or closing a pane in it. L-020 had captured exactly this class of defect for the *move* path; the agent fixed move, shipped, and didn't generalize.

**Why the agent got it wrong:**
The house style in `ipc-handlers.ts` is "every handler that mutates workspace state manually calls `pushManagerUpdate()` at the end." That's a convention, not an invariant the type system enforces. When an agent writes a new handler, they don't see the convention until they grep for it — and a 300-line handler like `PANE_SPAWN` is exactly the place where a trailing one-liner is easiest to forget. The deeper mistake was treating L-020 as "fix the move path" when the underlying shape of the lesson was "workspace membership has two readers, and every writer needs to notify the second one." The fix for L-020 was local; the lesson behind it was global. Local fixes to instances of a class of bug leave the other instances in place — and when the convention is "remember to call X," every new call site is a new chance to forget.

**How to avoid this in the future:**
*When you find a bug caused by a mutation missing a broadcast/notification/invalidation call, list every existing mutation of the same data and audit each for the same call before declaring the fix complete.* Grep for every caller of the mutation method (`addDroneToHive`, `removeDroneFromHive`, and the underlying array writes) and verify each call site's surrounding function eventually invokes the broadcast. If the audit finds more than one or two sites are fragile, the surgical fix is not enough — the mutation method itself should own the broadcast, so forgetting is impossible. Self-check before closing: *"How many places in the codebase mutate this data? Of those, how many can I statically prove call the broadcast? If the answer to the second is anything less than 'all of them' — or if the answer relies on human discipline at every call site — the root fix is to move the broadcast into the mutation method, not to add one more explicit call."*

Related: L-020 (pane membership is encoded in two places; moves must update both) — L-033 is the same failure mode extended to the add and close paths, plus the architectural observation about why the "manual push at every site" pattern will keep producing this class of bug.

---

## L-034: When a primitive's geometry IS the design, specify coordinates — don't trust implicit layout

**Date:** 2026-04-23
**Source:** feedback — in the Claudio-rebrand redesign, the `<Toggle>` primitive's thumb visibly overflowed the track top and bottom in the Configuration view; the white thumb circle painted taller than the blue pill behind it, making the control look broken
**Category:** implementation pattern

**What happened:**
The first Toggle implementation used the Tailwind-native composition pattern: a `<button>` track with `inline-flex items-center h-[18px] w-8`, a child `<span>` thumb with `inline-block h-[14px] w-[14px] transform translate-x-[2|16px]`. In theory, `items-center` on the 18px track would vertically center the 14px thumb with 2px of breathing room above and below; in practice, the thumb painted outside the track on both edges in Electron/Chromium. Root render cause: an inline-block child inherits the button's line-height, and `transform` creates a new stacking context that interacts with the baseline-vs-items-center arithmetic; the declared `h-[14px]` sets the layout box but does not suppress the line-height-derived paint extent. Fix: switched the track to inline-style `width: 32, height: 18` and absolutely positioned the thumb at `top: 2, left: 2|16, width: 14, height: 14`. The transition moved from `transform` to `left` + `background-color`.

**Why the agent got it wrong:**
Two reinforcing defaults. (1) The agent reached for the idiomatic Tailwind container-alignment trio (`inline-flex` + `items-center` + `transform`) because that is the normal way to center one element inside another in this codebase. That pattern is excellent for composed layouts where children are content-sized and the container is elastic. It is **the wrong tool for a primitive whose entire design specification is pixel-exact geometry** — "a 14px circle sitting 2px inside a 32×18 pill." When the design is coordinates, the implementation should be coordinates; using elastic layout tools to produce exact geometry invites edge cases where "usually centered" fails in the one renderer you actually ship to. (2) The test for Toggle asserted className presence (`expect(className).toContain('bg-overlay')`) and keyboard-event handling, not rendered geometry. jsdom does no layout, so no assertion the test could have made would have caught a 2px vertical overflow. The tests passed, the commit shipped, and the visual bug was invisible to every automated gate — including `npm test`, `npm run build`, and typecheck. The agent also violated the "You Are My Eyes" contract in that commit: no dev-server verification before declaring the primitive done.

**How to avoid this in the future:**
*When building a primitive whose design specification is pixel-exact geometry, write the geometry as coordinates — inline `style={{ width, height, top, left }}` with explicit numbers — and absolutely position any internal parts. Reserve `flex` + `items-center` for layouts where the children are content-sized and elasticity is a feature, not a bug.* Self-check before using flex centering on a control: *"If someone asked me to describe the size and position of every part of this control, could I answer in exact pixels without the words 'flex,' 'inline-block,' or 'items-center'? If yes, the implementation should do the same — write the pixels, not the implicit alignment."* Candidate controls for this rule: toggles, switches, custom checkboxes/radios, slider thumbs, status dots, progress fills, badge-with-dot, close-button X inside a circle.

Secondary, on the verification gap: *tests that assert only class names or event handlers cannot catch rendering bugs — jsdom does no layout.* For primitives where correctness depends on geometry (thumb fits inside track, badge fits inside row, ring does not clip), either (a) dev-server walkthrough before commit (the "You Are My Eyes" contract already requires this for UI changes and would have caught this), (b) assert `style.width` / `style.height` / `style.left` as properties when the primitive exposes them inline, or (c) add a Playwright/visual test harness. At minimum, commit messages for new UI primitives must explicitly state "did not visually verify" when that's the case, so the gap is recorded and not implied-away.

Related: this is the flip side of L-002 (borders/chrome must not cause layout shifts — "choose a different approach when the CSS property you reach for affects layout"). L-002 was "don't use a layout-affecting property for a visual signal"; L-034 is "don't use an elastic layout primitive to paint an exact-geometry design." Same underlying principle: the CSS tool you reach for encodes assumptions, and those assumptions should match the intent of the surface you're building.

---

## L-035: A window-scoped IPC needs a listener mounted in every window type's component tree — not just the one you happened to test

**Date:** 2026-04-23
**Source:** feedback — closing the manager window with active workspaces "did nothing" and then surfaced the native "Orchard is not responding" fallback after 3 seconds, instead of the intended in-app `CloseSessionsModal`
**Category:** architecture

**What happened:**
The close-confirmation flow in `src/main/index.ts` intercepts `BrowserWindow` close events, sends `IPC.CONFIRM_CLOSE_SESSIONS` to the closing window's renderer, and waits for `IPC.CONFIRM_CLOSE_SESSIONS_RESPONSE`. This was treated as a window-level concern and wired identically for both workspace windows and the manager window. But the renderer-side listener + `<CloseSessionsModal>` lived inside `WindowShell.tsx` — and `WindowShell` is mounted **only** for workspace windows (`App.tsx:79–97`). The manager window mounts `<ManagerWindow>` directly, which had no such listener. So every manager-close IPC since B-051 shipped had been dropped on the floor. Before the fallback-timeout change landed, this manifested as the manager window silently refusing to close; after the timeout landed, the native fallback fired after 3 s, which looked like the new code misbehaving but was actually the new code *correctly detecting* a pre-existing wiring gap. A prior session misdiagnosed the user's first "nothing happens" report as a focus problem and added `win.focus()` + `win.restore()` calls, which didn't help because the underlying listener had never existed on the manager.

**Why the agent got it wrong:**
Two reinforcing assumptions. (1) `IPC.CONFIRM_CLOSE_SESSIONS` is a **window-level** IPC by purpose — the main process sends it to any BrowserWindow that receives a close event. The agent assumed that because the main-side send was symmetric across window types, the renderer-side listener was too. It wasn't: the listener was anchored to the component tree of one specific window type (`WindowShell` ≙ workspace), not to the shared root (`App`). (2) When the user reported "nothing happens" on manager-close, the first agent's instinct was to explain the symptom via visibility (the modal is somewhere behind another window) rather than to verify the modal component was actually being rendered at all. Debugging started from the *main-process send* and assumed the renderer side was intact, instead of following the IPC through both the main *and* the renderer and asking "which component owns the listener in the window type that's failing?" This is a variant of L-014 — L-014 said *"`RENDERER_READY` is a root-component ready signal, not a global one; piggy-backed messages only reach listeners owned by already-mounted components."* L-014 covered the timing variant (listener mounts a tick too late). L-035 is the coverage variant (listener doesn't mount at all in one window type). Both failures come from generalizing "it works in the window type I tested" to "it's wired for every window type."

**How to avoid this in the future:**
*For any IPC the main process sends to a `BrowserWindow` on a shared channel, confirm the listener lives in a component that is mounted in **every** window type that can receive the message. The safest place is the single renderer root (`App.tsx`) — anywhere else, verify the mount conditions per window type.* Concrete self-check before wiring a new window-scoped IPC listener: *"If the main process calls `win.webContents.send(CHANNEL, ...)` on every kind of BrowserWindow the app creates, and I trace the listener's owning component, is it mounted in every one of those trees — or only in one branch of the `App.tsx` window-type switch?"* If the latter, either lift the listener to `App.tsx` (for listeners that don't depend on window-type state), or ensure the main process only sends the IPC to window types whose root owns the listener. Debugging self-check when an IPC round-trip appears broken: *"Have I confirmed both ends independently — that the main side sent, **and** that the renderer side has a live listener in the component tree of the specific window type involved?"* The modal not appearing is not a focus or z-index problem until you've proven a listener exists and set its state.

Related: L-014 is the timing variant of the same underlying mistake (treating "the renderer is ready" or "the app has this listener" as global when both are component-scoped). L-035 is the cross-window-type variant. Both reward the same debugging discipline: trace the IPC through both processes, and identify the specific component that owns the listener in the specific window type exhibiting the bug.

---

## L-036: A field named like a git concept on an external SDK's payload is not a git concept — it's the SDK's own accumulator

**Date:** 2026-04-23
**Source:** feedback — the Kanban card showed a `+A/−B` diff chip that didn't match the repo-rail row's `+A/−B` for the same tree; the card was sourced from Claude Code's statusline `cost.total_lines_added/removed`, the rail from `git diff --numstat <base>` + `git ls-files --others`
**Category:** external-data schemas

**What happened:**
`PaneMetrics.linesAdded` and `PaneMetrics.linesRemoved` were populated directly from Claude Code's statusline JSON (`cost.total_lines_added`, `cost.total_lines_removed`) in `metrics-collector.ts:244-245`. The field names *sound* like git-diff numbers — "lines added / removed" — so the agent who wired them to the `+A/−B` chip treated them as interchangeable with the git view. They aren't. Claude Code's counter is an SDK-internal accumulator incremented on each Write/Edit tool use; it doesn't decrement when the model reverts a change, doesn't see user edits, and doesn't know about committed-vs-uncommitted distinctions. Meanwhile `InspectorService.refreshPaneDiff` was already computing the correct "what would merge" numbers from git (tracked via `numstat` + untracked via `ls-files`, post-L-032) and feeding them to the repo rail. So two UI surfaces *showing the same concept* — this tree's contribution vs base — diverged: the card read from Claude's counter, the rail from git. The fix was to route both through the inspector's cache and drop the statusline line-count assignment entirely.

**Why the agent got it wrong:**
A schema-reading shortcut. `cost.total_lines_added` is what git would print for "lines added," and the rest of `cost.*` (duration, USD) was self-evidently an SDK accumulator, so the agent read the line-count fields as the SDK's *git-equivalent* rather than as further members of the accumulator family. The surface name matched the target concept, so the semantic mismatch was invisible. Reinforced by no parallel path being checked: the inspector already existed, already computed the git numbers, already powered the repo rail — a quick grep for "linesAdded" would have surfaced two different producers for the same field and the question "why do we have two of these?" would have forced the right question. (Same structural mistake as L-032 — two producers, different commands, nobody checked they agreed — with a different trigger: the error came from trusting an SDK field name rather than trusting a single-command view of git state.)

**How to avoid this in the future:**
*When an external SDK's payload has a field whose name matches a concept you also compute locally, don't assume they mean the same thing.* Write down in one sentence what the SDK says its field is (usually: an accumulator across the SDK's own operations), write down what the local concept is (usually: a view of current repo / system state), and ask whether those two definitions could diverge under a plausible sequence of events. For Claude Code specifically: `cost.*` is a session-scoped accumulator incremented by Claude's tool uses. It is **not** a git diff, never was, and cannot be substituted for one. Any UI surface labelled "diff" or "what would merge" must read from git, not from `cost.*`.

*Apply L-032's parallel-path check at import time too.* Before wiring an external field into a type that another local code path also produces, grep the codebase for every existing producer of the target field and identify its source command or computation. If the external field's source is fundamentally different (SDK counter vs git command, header from HTTP response vs a recomputation, timestamp from the sending side vs a receiving-side `Date.now()`), those are two *different* numbers that happen to share a name — route to one or the other by explicit choice, don't treat them as substitutable.

Related: L-010 (verify external data schemas against runtime output rather than documentation — same family, different angle: L-010 is about the *shape* being wrong, L-036 is about the shape being right but the *meaning* being different from what the name implies); L-032 (parallel-path divergence — same structural bug, this time triggered by an SDK name collision rather than by missing a git file state).

---

## L-037: `inset` box-shadow paints below children — if children are opaque, the ring is invisible

**Date:** 2026-04-23
**Source:** feedback — the big active-terminal pane in Kanban view showed no status border at all, even though the style was set
**Category:** implementation pattern

**What happened:**
The Kanban-view pane fills its container edge-to-edge (repo rail on the left, Kanban board above, window edge on the right), so the Wall-mode *outset* `box-shadow` ring clipped into neighbours and off the right edge of the window. The obvious fix seemed to be flipping the same shadow to `inset`: no layout impact, no overflow, ring still drawn at the edges. The tests passed — the inline style had `box-shadow: inset 0 0 0 2px …` as expected — but on screen there was no ring. xterm's terminal div and the PaneHeader, both opaque, were filling the wrapper from edge to edge, and the inset shadow was being painted **below** them. The visible ring the user wanted needs a layer children can't cover: a real CSS `border`, an `outline`, or a pseudo-element stacked above the content.

**Why the agent got it wrong:**
A mental model of `box-shadow` as "decoration layered on top of everything it's attached to." That is true for the *outset* case — the shadow paints outside the element, so nothing inside the element can occlude it. For the *inset* case it is not: inset shadows paint on the padding-box, *above the background but below the element's children*. When the children render edge-to-edge with their own opaque backgrounds (xterm's terminal canvas, the PaneHeader strip), they mask the ring completely. The agent conflated "inset" with "painted on top" and didn't think through the z-order of inset shadow vs children. The test was also structurally weak: asserting `wrapper.style.boxShadow` contains the word "inset" proved the inline style was wired, but jsdom doesn't paint, so no assertion in that test could catch the visual masking. The bug was only visible by eye, and the agent reported "verified by tests" without a dev-server walkthrough — a You-Are-My-Eyes violation that let the broken chrome ship to the user.

**How to avoid this in the future:**
*Before using `box-shadow: inset …` as a visible ring on a component that fills itself with opaque children (terminal panes, video players, canvas-backed surfaces, image placeholders), remember that the shadow paints beneath those children and will be masked.* Self-check at CSS-choice time: *"If I listed the CSS painting layers for this element — background, inset shadow, children, outset shadow, outline, pseudo-elements with z-index — would the layer I'm reaching for sit above the children that fill this element's box?"* If no, pick one that does: a real `border` (lives in the box model; children can't occupy the border area), `outline` (painted by the element above children, though it *extends outward* from the element unless `outline-offset` is negative), or an absolutely-positioned `::before` / `::after` with `inset: 0` + `border` + `pointer-events: none` (stacked above children by default, scoped to the element's box).

Concrete decision rule for "draw a visible N-pixel ring inside an element's box that has opaque children":
1. **First choice:** `border: Npx solid …` with `box-sizing: border-box`. In the box model, not mask-able, no layout shift when applied as a constant value for a view mode. The children's content area shrinks by `2N` total — this is a deliberate layout cost, not a focus-state jitter, so L-002 does not apply.
2. **If layout cost is unacceptable:** absolutely-positioned pseudo-element with `inset: 0; border: Npx solid …; pointer-events: none`. Above children, no layout impact, but requires a CSS class rule (can't be done through a single inline style).
3. **If the ring needs to be outside the box:** outset `box-shadow` or `outline` — but verify the surrounding layout has room so the ring doesn't clip into neighbours or off-window (the original bug being fixed here).
4. **Avoid `box-shadow: inset` for a visible ring in any surface where children render edge-to-edge with opaque backgrounds.** The only time inset shadow reliably reads as a ring is on surfaces whose children leave the padding area empty (padded cards, buttons with interior glyphs). A terminal-filled pane is not that.

Verification discipline: *tests that read inline `style.boxShadow` / `style.border` prove the style was set, not that the user can see it.* For ring-visibility changes, a dev-server walkthrough is mandatory before declaring done — jsdom does no layout and no painting, so no unit test will catch "the ring is there but children are covering it." This is the same verification gap called out in L-034 for exact-geometry primitives; the pattern repeats whenever correctness requires painted pixels, not asserted style strings.

Related: L-034 (elastic layout tools vs exact-geometry primitives — same family, the CSS tool you reach for encodes assumptions, and those assumptions should match the intent of the surface); L-002 (borders must not cause *focus-driven* layout shifts — deliberately scoped to state transitions, which is why adding a constant Kanban-mode border does not violate it); L-024 (structural UI must render its final geometry from the first frame — here, the ring belongs to the Kanban view's permanent chrome, so its visibility must be correct on the first paint, not dependent on future child state).

---

## L-038: A TUI re-renders glyph-by-glyph — a stripAnsi'd buffer cannot be regexed on whitespace gaps, and a stream detector must instrument before it iterates

**Date:** 2026-04-24
**Source:** feedback — the PLANNING chip stayed lit after the user accepted a plan, and the pane landed in Needs Input on completion (4-round saga)
**Category:** detection / parsing pattern + investigation discipline

**What happened:**
The plan-mode permission detector reads PTY bytes from Claude Code's TUI (rendered by ink), strips ANSI, and scans the rolling 16 KB buffer for a footer line like `⏸ plan mode on (shift+tab to cycle)`. The chip flipped on correctly when plan mode started, but stayed lit after the user accepted — and downstream, the Stop hook fired while `permissionMode === 'plan'` and forced the pane into Needs Input instead of Done. Three rounds of iteration each guessed a different cause: round 1 fixed a real adjacent bug (stripAnsi was eating ECMA-48-invalid `\x1b[a-z]` pairs and ate the `t` of `to`), round 2 anchored on a `⏸` icon that turned out to be permanent for plan mode (not a swapping active-mode marker), round 3 switched to an icon-agnostic `<word> on (shift+tab` pattern. None of those rounds reproduced from real captured bytes — they were all hypotheses about what the buffer probably looked like. Round 4 added a throttled `[plan-mode debug]` log that printed the actual stripped tail when the buffer mentioned "plan" but no canonical match fired. One run later, the bytes told the story: ink renders the input-box footer one glyph at a time with cursor-positioning ANSI escapes between glyphs, so after stripAnsi the buffer holds `⏸planmodeon (shift+tabtocycle)` — no whitespace between mode words. The regex `[\s ]+on[\s ]*\(shift` required whitespace before `on` and missed every spaceless re-paint. Detection only ever fired on the very first paint (spaces still intact) and on a much-later re-paint when ink occasionally re-issued a complete spaced line — and "much-later" was after the Stop hook had already mis-routed the pane.

**Why the agent got it wrong:**
Two compounding errors. First, a domain-naïve mental model of what stripAnsi-of-PTY-output produces. The agent assumed `\x1b[…]` escapes only carried color/attribute data and that the visible text would be assembled left-to-right by character, so `stripAnsi(buffer)` would look like the human-readable terminal contents. That is not true for any modern TUI built on ink, blessed, Textual, ratatui, or similar libraries: those frameworks position the cursor explicitly for every glyph (so they can do partial re-renders without redrawing the whole line), which means after stripAnsi the rendered text appears as concatenated glyphs with no inter-word whitespace. Anchoring a regex on `\s+` between words is wrong by construction for this class of stream. Second, a process error: the agent kept hypothesizing fixes without first capturing what the buffer actually looked like. Each round invented a plausible mechanism (the ANSI-letter strip, the `⏸` icon, the icon-agnostic word scan) and shipped it. Three rounds of guessing burned the user's trust. The diagnostic log added in round 3 was the right tool — but it should have been step ONE, not step THREE. By the time it ran, three wrong fixes had already been deployed.

**How to avoid this in the future:**
Two rules, applied in this order.

*Rule 1 — instrument before you iterate.* When a detector scans a stream and "sometimes misses the signal," the first commit must add a near-miss diagnostic that prints the actual bytes the detector sees. Even if your hypothesis seems obvious. The cost of instrumentation is one log line and one throttle map; the cost of shipping a wrong fix is a round-trip with the user and a loss of credibility. Self-check at design time: *"If this fix does not work, will the next failure produce data, or just another report of 'still broken'?"* If the answer is "just another report," add the log first.

*Rule 2 — do not anchor TUI/PTY-stream regexes on whitespace gaps.* When parsing the stripped form of any TUI output (ink, blessed, Textual, ratatui, etc.), assume that whitespace between rendered tokens may collapse to nothing. The ANSI escapes between glyphs may include cursor-positioning sequences that strip to empty strings, leaving adjacent glyphs concatenated. Pattern your regex on keyword anchors and structural punctuation, not on `\s+` between words. Concrete shape: instead of `<word>\s+on\s*\(...`, write `(plan|auto|...)[\s ]*(?:mode)?[\s ]*on[\s ]*\(...` — keyword whitelist + optional whitespace + a structural anchor (`(`, `:`, `[`, etc.). A corollary: synthetic test fixtures hand-crafted as `'plan mode on (shift+tab to cycle)'` will pass against any whitespace-anchored regex but tell you nothing about the spaceless ink form, so add at least one test whose input mirrors the actual stripAnsi'd bytes (`'planmodeon (shift+tabtocycle)'`).

Related: L-013 (dual-mode detection — same family of "primary mode looks reliable but misses the in-between case"; here the in-between case was every ink re-render that wasn't a fresh full paint); L-029 (when iterating on a detector that touches a noisy resource, capture the actual contention pattern before hypothesizing — the same instrument-first discipline applies whether the noise is filesystem locks or rendering escapes); L-016 (validate at our boundary — here, "validate that our stripAnsi'd buffer looks like what we think it does" is the boundary check we should have run before writing the regex).

---

## L-039: Vitest default resolution prefers `.js` over `.ts` — stale compile artifacts in `src/` silently shadow fresh TypeScript edits

**Date:** 2026-04-24
**Source:** implementation observation — new methods added to `hook-listener.ts` (`setInspectorService`) and new fields added to `inspector.ts` (`isAwaitingPlanApproval`, `awaitingPlanApprovalCount`) came back from the test harness as `TypeError: listener.setInspectorService is not a function` and `{ 'approving-1': undefined }` even though the source clearly defined them and `npx vitest run` on the existing test file had passed moments before.

**What happened:**
Vite's default `resolve.extensions` is `['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']` — `.js` beats `.ts`. This repo has dozens of untracked `.js` files sitting next to their `.ts` sources in `src/main/` and `src/preload/` (old `tsc` output from some historical invocation; not in `.gitignore`, not tracked by git, not cleaned up). Any time a test imports `'../src/main/hook-listener'` without an extension, vitest resolves the stale `.js`, not the edited `.ts`. Existing tests kept passing because the stale `.js` had enough of the right shape; the moment the agent added a new method or a new field, the test saw the pre-compile version of the module, called the missing method, and got `undefined is not a function`. The root symptom was a correct-looking edit that appeared to have no effect on the test.

**Why the agent got it wrong:**
Assumed — implicitly, without checking — that `.ts` wins over `.js` in module resolution when both exist. That assumption holds for `tsc --module nodenext` with TypeScript's own resolver and for ts-node, but it does *not* hold for Vite/vitest, which uses Vite's resolver with an extensions order that puts `.js` first. The stale `.js` files were invisible in normal navigation (the agent was reading and editing `.ts`), so there was no cue at the edit site that a parallel compiled copy existed. The failure mode looked like "my edit didn't take effect" — which routes diagnosis toward "did I save? is there a cache? did I edit the wrong file?" rather than toward "is vitest loading a different file than I think?" Debugging the symptom without checking the actual module specifier that resolved wasted a full round of test runs.

**How to avoid this in the future:**
Two rules.

*Rule 1 — when an edit "doesn't take effect" on a test, verify the file actually being loaded.* If a newly-added method yields `is not a function` or a newly-added field comes back `undefined`, the first diagnostic is not "is my edit saved?" but "what path did the runner resolve for this import?" Either add a temporary `console.error('loaded from', import.meta.url)` at the top of the module, or run `ls src/<dir>/*.js` next to the `.ts` you edited. Any untracked `.js` next to a `.ts` is a resolution hazard.

*Rule 2 — for Vite/vitest projects whose source tree may contain compile-output siblings, pin the resolver.* Set `resolve.extensions` in `vitest.config.ts` to put `.ts`/`.tsx` first: `['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.json']`. It costs nothing when no stale artifacts exist and saves the next agent a full diagnosis cycle when they do.

**Addendum (2026-04-24): electron-vite is NOT unaffected.** An earlier version of this lesson claimed the Electron build had its own resolver and dodged this hazard. It doesn't. `electron-vite` uses Vite under the hood, and Vite's default `resolve.extensions` order puts `.js` before `.ts` for the main-process bundle too. A subsequent session spent four iterations chasing a non-appearing `console.log` inside `src/main/index.ts` — the source had the code, every `npm run dev` reported "build the electron main process successfully", but the compiled `out/main/index.js` never contained the new code. Root cause: a stale `src/main/index.js` sitting next to `src/main/index.ts` was being picked up by esbuild in preference to the TypeScript source. Same hazard as vitest, different consumer.

*Rule 3 (supersedes Rule 2 for this repo) — delete stray `.js`/`.d.ts` next to the TypeScript sources, don't just reorder the resolver.* Pinning `resolve.extensions` in one config file doesn't help the other tools in the build chain. The durable fix is to remove the shadow files entirely. Run `find src -name "*.js" -o -name "*.d.ts" | xargs git check-ignore -v` — any hit that isn't tracked and isn't ignored is a resolution hazard waiting to strike. `src/renderer/env.d.ts` is the single legitimate tracked `.d.ts` in this repo; everything else under `src/` should be `.ts`/`.tsx`.

*Diagnostic reflex — when a newly-added `console.log` doesn't appear in the log, don't assume the logger is broken or the branch is unreachable; suspect the bundle.* Grep the compiled artifact for the literal string you expect to see. If it's absent, the source isn't what got bundled.

Self-check at the edit site: *"If there were a stale `.js` next to this `.ts`, would my test suite or my dev-server tell me — or would it silently run against the wrong file?"* If the answer is "silently run against the wrong file," verify the artifact before trusting any outcome.

---

## L-040: UI driven by event-sourced data must self-invalidate when the event stops arriving — an expiry timestamp without a client-side expiry check will render stale data forever

**Date:** 2026-04-24
**Source:** feedback — rate-limit bar read "5h: 85% resets in now" for several minutes after the 5h window had rolled over
**Category:** UX pattern

**What happened:**
The rate-limit bar (PE-01) showed a countdown computed client-side from the `resetsAt` timestamp in the last-received rate-limit payload. Once `resetsAt` was reached, `formatCountdown` gracefully returned `'now'` and the gauge kept rendering `85% resets in now` using the still-frozen `usedPercentage`. There was no client-side invalidation when `resetsAt` slid into the past. Rate-limit payloads only refresh when Claude Code's statusline pushes a new frame — which happens on a turn, not on a schedule — so a user who was idle across the boundary saw the gauge look broken indefinitely. The first turn after the reset self-healed the display, which is why the bug was slow to surface in testing: any agent actively typing would never see it.

**Why the agent got it wrong:**
The PE-01 implementer modeled the countdown as "render whatever the server last said" and handled the boundary case defensively (`Math.max(0, target - now)` clamps negatives, then prints `'now'`). That looks correct in isolation — at the instant of reset, "resets in now" is truthful. The implementer never asked the second question: *how is the next frame of data going to arrive, and what do we render while we wait for it?* The statusline is event-sourced (push on turn) rather than time-sourced (push on interval), so the answer to "what if the event doesn't come?" is "we render a lie." The default mental model was the polling case, where a stale frame is replaced within a known worst-case interval; in an event-driven pipeline there is no worst-case interval, so the stale window is unbounded.

**How to avoid this in the future:**
When a UI renders data that carries its own expiry (a `resetsAt`, `validUntil`, `nextPollAt`, TTL, or `exp` claim), ask one question before shipping: *"If the next refresh never arrives, what do I render a minute past expiry? Ten minutes? An hour?"* If the answer is "the pre-expiry values, confidently" — wrong. The expiry timestamp is a contract with the client: past it, the numbers next to it cannot be trusted, even if the server hasn't yet sent a replacement. Client-side, fall back to the same placeholder state you use before the first payload arrives — the structural fixture lesson (L-024) applies identically here. A short grace period past expiry keeps the legitimate "any moment now" flicker at the boundary clean; the guard only trips on data that is *clearly* past its own sell-by.

Related: L-024 (structural fixtures vs conditional content — the bar stays visible, only the gauge degrades to its placeholder); L-029 (stale lock files surviving a crashed writer — same shape of problem, different data: a piece of state with an implicit TTL that nobody on the consumer side invalidates, leaving followers stuck until someone else intervenes). The general pattern: *anything with an expiry timestamp needs a consumer that knows what to do past it.*

---

## L-041: When the same state is exposed via two IPC channels, both need to be wired to the source's transition events — or the views will visibly drift

**Date:** 2026-04-24
**Source:** feedback — six agents were actively working but the repo-pane dots read "1 working / 5 awaiting prompt"
**Category:** architecture

**What happened:**
Pane status is consumed in two places in the renderer: the per-pane header (driven by `IPC.PANE_STATUS`, emitted from the hook-listener on every transition) and the repo-pane's aggregated dots (driven by `IPC.INSPECTOR_SUMMARY`, emitted from the InspectorService). The inspector path was only rebroadcast on three triggers — the 30s git-status poll, an `ExitPlanMode` tool flip, and a user-initiated drawer pull — none of which fire on ordinary `awaiting-prompt → working → done` transitions. So the per-pane pill would flip to "working" within ~50ms while the repo pane sidebar stayed on "awaiting prompt" for up to 30 seconds. Both derived from the same authoritative field (`pane.status`) in the SessionRegistry; the only difference was which upstream event triggered a broadcast on each channel.

**Why the agent got it wrong:**
The InspectorService was originally designed to aggregate periodic git-poll data (diffs, line counts, ready-to-merge flags) that genuinely update on the poll cadence. When `paneStatus` was added to the summary payload, it was treated as just another field inside the rollup — not as a *real-time* signal that demanded its own broadcast trigger. The signature-based dedup (`summarySignature` includes `ps: t.paneStatus`) *looked* sufficient because it would correctly suppress no-op rebroadcasts, but the signature check only runs when `computeAndBroadcast` is invoked — it does not, and cannot, call itself. So the fix of "include paneStatus in the signature" solved a different problem (avoid redundant emits) than the one that needed solving (emit at all on a status transition). The agent reasoned from the summary payload's *content* (all relevant fields present, signature sensitive to each) without auditing each field's *trigger path* back to its source of truth.

**How to avoid this in the future:**
When adding a field to an aggregated/broadcast view, ask: *"What event in the underlying system changes this field, and does my broadcaster subscribe to that event?"* The shape of the payload is a red herring — what matters is whether the pipe that carries it is pumped on every meaningful change. If two views derive from the same source field but broadcast on different triggers, the visible staleness of the slower one is not a latency tuning problem — it is a wiring hole, and the slower view will diverge until the next unrelated trigger fires.

Concrete checklist for any "two UIs reading the same field via different channels" shape:
1. Find the authoritative mutator (here: `SessionRegistry.updatePaneStatus`).
2. List every broadcast channel that carries the field.
3. For each channel, trace the event that causes it to refire.
4. If any channel's refire set does not include the authoritative mutator, that channel will stall until an unrelated trigger fires. Wire a listener at the mutator to fill the gap.

Related: L-032 (repo rail's +A/−B chip unified its diff source with the per-pane card via MetricsCollector — same "two views, one field, harmonize the update path" pattern); L-040 (event-sourced UI without client-side expiry — also about a view stalling when an expected event doesn't arrive, though that was push-vs-pull, this one is multiple pushes with misaligned triggers).

---

## L-043: Tailwind 3's `/opacity` shorthand silently no-ops on CSS-var color tokens — verify the wash actually lands

**Date:** 2026-04-24
**Source:** feedback — agent rows in the Kanban repo card had `hover:bg-fg-primary/10` and `bg-fg-primary/15` for hover + active, but the user reported zero visible difference on either state (two rounds of fixes before realizing the utility itself was the no-op)
**Category:** styling

**What happened:**
The KanbanRepoSessionRow button had hover + active washes expressed as `hover:bg-fg-primary/10` / `bg-fg-primary/15` — standard-looking Tailwind. Both utilities compiled, the DOM received the classes, and tests passed. But nothing rendered. The `/N` opacity modifier only works in Tailwind 3 when the color token is configured as a function returning `rgb(var(--...) / ${opacityValue})` (or equivalently, when the CSS variable holds a space-separated RGB triple, not a hex literal). Our config has `'fg-primary': 'var(--color-fg-primary)'` where `--color-fg-primary: #F0EBE0` — a raw hex wrapped in `var()`. Tailwind can't derive an `rgb(... / alpha)` form from that and silently emits a rule without the alpha. The hover/active styling was entirely invisible. The fix was to introduce explicit CSS variables built with `color-mix()` (`--color-row-hover`, etc.) and reference them as Tailwind arbitrary values (`hover:bg-[var(--color-row-hover)]`), bypassing the opacity-shorthand machinery.

**Why the agent got it wrong:**
`bg-warning-fg/10` appears elsewhere in the codebase and the agent assumed it worked. It compiles without error, the class name lands on the element, and there is no runtime warning — so the feedback loop that would normally catch a broken utility (console errors, type errors, test failures) is silent. This is the same family as L-026 (tokens without utilities) but with a twist: here the utility is *generated*, it just doesn't produce a visually distinct result. The agent also skipped visual verification both rounds, trusting "the class is applied" as equivalent to "the effect is visible" — a direct violation of the "You Are My Eyes" contract. Compounding: when the first round looked dead, the agent's next move was to stack a second broken layer (active state with the same `/N` idiom) and report back — which doubled the invisible-no-op surface area.

**How to avoid this in the future:**
When writing a Tailwind opacity-shorthand class (`bg-X/N`, `text-X/N`, `border-X/N`) against a color token sourced from CSS vars, verify the token is either (a) configured as a function that splices `opacityValue` into an `rgb(... / ${alpha})` form, or (b) stored as a space-separated triple (`"240 235 224"` not `"#F0EBE0"`). If neither, the modifier is a no-op — use an explicit `color-mix()` wash via a CSS variable and reference it as an arbitrary value (`bg-[var(--color-X-wash)]`) instead. And at the "You Are My Eyes" layer: any change whose entire job is to put pixels on a screen (hover state, focus ring, selection highlight, shadow, tint) is not verified until the pixels have been seen. A passing test, a correct-looking classname, and a clean compile do not substitute for visual confirmation — mark those tasks "not verified" in the report rather than claiming "high confidence" on faith.

---

## L-042: When an on-disk layout invariant changes, every derive-from-path helper inherits the old assumption silently

**Date:** 2026-04-24
**Source:** feedback — the "+ Terminal" modal in Kanban pre-filled Repository path with `<repo>/.worktrees`, so new terminals got created at `<repo>/.worktrees/.worktrees/<name>` and the repo rail sprouted a bogus `.worktrees` card
**Category:** architecture

**What happened:**
Claudinha used to place linked worktrees as siblings of the repo root (`<parent>/<wt-name>`), so `path.dirname(worktreePath)` was a stable per-repo group key. Later, the spawn code was changed to place worktrees inside `<repoRoot>/.worktrees/<wt-name>` (to keep sibling dirs tidy) — `git-status.ts` grew `isClaudinhaInfrastructurePath` to hide that dir from dirty-main detection (L-029), but the four copies of `path.dirname(worktreePath)` elsewhere (inspector.ts's `normaliseRepoPath`, two sites in ipc-handlers.ts, plan-approval-sequencer.ts's `normaliseRepoPath`) were never updated. Each now returned `<repoRoot>/.worktrees` — a subdirectory — as the "repo path." The InspectorService broadcast that bogus path to the renderer; the Kanban rail rendered a `.worktrees` repo card for it; SpawnDialog's `lastSpawnedRepoPath` default pre-filled it; submitting the modal nested one more `.worktrees/` beneath the first; the cycle compounded.

**Why the agent got it wrong:**
Two reinforcing gaps. (1) The agent who moved worktrees under `.worktrees/` was thinking about the *filesystem layout* and the dirty-main status filter. They didn't search for `dirname(worktreePath)` because their mental model of "where do I store worktrees" didn't include "…and four other files compute the repo root by stripping one path segment." `dirname` is such a thin, generic helper that it doesn't register as *encoding a layout assumption* — but that's exactly what it does when the answer depends on how deep the worktree sits. (2) The original `normaliseRepoPath` helpers had comments like *"worktrees created by Claudinha live as sibling dirs under the repo's parent"* — accurate at the time, stale once the layout changed. A stale comment next to still-green tests (the tests passed literal `/repos/demo/.worktrees` as the "repoPath" input, encoding the bug as the contract) gave the appearance of a correct, documented invariant when both the behavior and the doc had been silently invalidated.

**How to avoid this in the future:**
When changing the on-disk layout of a resource (where it's stored, how it's named, what subdir holds it), do not stop at the code that writes it — run `grep dirname|basename|split|slice` across every file that touches the resource's path and audit whether each derivation still holds under the new layout. A `dirname` call on a filesystem path is a layout assumption compressed to one line, and those assumptions never self-announce at refactor time. A concrete self-check: *"I just changed `path.join(A, ..., B)` to `path.join(A, X, ..., B)`. Does any code reconstruct A from a path like B by counting segments from the end? If yes, each of those is broken now."* Also: when a helper encodes a layout invariant, name it (we already had `isClaudinhaInfrastructurePath` for the dirty-main filter — the four `dirname` sites should have been a named helper too, which this lesson's fix finally created: `worktreePathToRepoPath`). And: when tests encode the output of a broken helper as fixture input, fixing the helper breaks the tests in a way that reads like a regression — audit what the fixture *means* semantically, not just what value it carried before.

---

## L-043: Two derivations of the same concept both have to be audited, even when the names look unrelated

**Date:** 2026-04-24
**Source:** feedback — repo name displays as `.worktrees` on every Kanban card, repo rail header, and pane header in a workspace, even after L-042's fix to the repo-path grouping key
**Category:** architecture

**What happened:**
L-042 fixed `repoPath` derivation by introducing `worktreePathToRepoPath` — every site that needed the repo's grouping key now used it. But the same concept — "the parent repo this pane belongs to" — also has a *display* form, `pane.repoName`, which was separately set at spawn time via `path.basename(repoPath)`. When `repoPath` came in as `<repoRoot>/.worktrees` (pre-fix poison, user paste, stale localStorage), `basename` yielded `.worktrees` and got persisted on the pane forever. The L-042 fix healed the grouping key but left the display label silently wrong, and because `repoName` was a stored field rather than a computed one, the bug survived the fix and continued to display on existing panes. The follow-up had to both correct the spawn-time write *and* repair the display at the inspector boundary to fix panes already on disk.

**Why the agent got it wrong:**
The L-042 author treated `worktreePathToRepoPath` as "the fix for the .worktrees problem" — bundling the repo-root grouping concept into one named helper felt complete. But "the parent repo this pane belongs to" has two siblings: the *path* (used for grouping, comparison, IPC identity) and the *name* (used for display). They share one underlying truth but diverged into two separate writes at spawn time — one through the renamed helper, one through a raw `path.basename(repoPath)`. The refactor moved the first, not the second, because the `repoName` assignment wasn't phrased as a path-derivation — it read like an innocuous label assignment. A store-once, read-many field like `repoName` also hides the bug: once written wrong at spawn time, it persists through sessions and looks like current truth to any future reader. And: a fix that resolves the *path* form of a concept does not automatically resolve the *name* form, even though they're computed from the same input and suffer the same failure mode.

**How to avoid this in the future:**
When fixing a derivation bug, enumerate every *form* of the concept, not just every call site of one form. For a filesystem-rooted concept, that usually means: the path (for identity/grouping), the name (for display), and any cached/persisted copies of either. Write them on paper before grepping — "what does this layout decision produce?" If one helper resolves the path form, write the matching helper for the name form *in the same commit* so both derive from the same source and no caller can pick the wrong one. For any field that's stored rather than computed (like `pane.repoName` in a persisted snapshot), also apply a defensive repair at the read boundary during the same fix: once the legacy value has been persisted to user machines, the spawn-time correction alone is insufficient. Concrete self-check: *"My fix changes how X is derived. Is X ever stored and read back as truth later? If yes, add a read-side repair so users already affected see the fix immediately."*

---

## L-044: A mode-gated component hides every affordance it contains — audit each distinct affordance before suppressing the component wholesale

**Date:** 2026-04-24
**Source:** feedback — triggering "Merge" on a Kanban repo card on a repo with a dirty main branch left the user staring at a small "Main dirty" chip with no way to resolve the error; they thought there was a modal to describe what was dirty and help resolve it, but no such modal existed
**Category:** UX pattern

**What happened:**
`CompletionActionBar` (per-pane) is rendered in `Pane.tsx` behind a `chromeMode === 'wall'` gate. The Kanban view deliberately suppresses it because the Kanban repo-rail owns the *bulk* actions (Merge / Push / Merge+push / Create PR) — the comment reads *"the repo rail's per-repo card owns the bulk … affordances there, so the per-pane bar would only duplicate them."* That reasoning was correct for the half of the bar that duplicates. It was wrong for the other half: the bar also contains per-pane **recovery** affordances — "Resolve with Claude" / "Abort" for merge conflicts; "Reveal in Finder" / "Retry" / "Close" with a tooltip file list for dirty-main. Those affordances are NOT duplicated anywhere in the Kanban rail. Suppressing the bar in Kanban hid both halves, leaving the user with only a yellow "Main dirty" chip on the card and no click target to recover.

**Why the agent got it wrong:**
The bar's contents were treated as a single conceptual unit ("the merge/PR bar") rather than two distinct concerns braided together (orchestration: merge/PR dropdowns; recovery: resolve/abort/retry for terminal failure states). When deciding how to integrate the bar into Kanban mode, the agent asked "is this bar replaced by the repo rail?" — which is true for the orchestration half, and that answer short-circuited further inspection. The recovery half never entered the analysis because the bar is named after its primary role, and the primary role was, in fact, replaced. The gating condition encoded one question ("is this mode's alternative UI present?"), not the real question ("does every distinct affordance of this component have an alternative in this mode?"). The recovery affordances were the silent minority — they didn't surface often enough in dev builds to make the gap visible until a user hit a genuinely dirty main branch.

**How to avoid this in the future:**
When gating a component behind a mode selector, enumerate every *distinct affordance* the component provides and confirm each one has either (a) an equivalent in the alternate mode, or (b) a deliberate decision that the affordance is not needed in that mode. Do not let the component's name or primary role answer for its secondary roles. A hybrid component that mixes orchestration (let-me-start-work buttons) with recovery (something-broke-here buttons) is especially dangerous to suppress wholesale — recovery affordances are used rarely but are load-bearing when they are used, and their absence shows up only in rare failure modes that dev testing often skips. Concrete self-check: *"If this component disappears in mode X, make a list of every button / link / status indicator inside it. For each entry, where does the user find that action in mode X?"* If the answer is "nowhere" for any entry, either expose it elsewhere in mode X (a click target on a status chip, a secondary surface) or accept the gap explicitly in a comment so a future agent knows it was a conscious choice.

---

## L-045: An "idempotency check" that matches by exact string silently accretes duplicates whenever the canonical string changes

**Date:** 2026-04-24
**Source:** feedback — flood of "PostToolUse hook error / No such file or directory" in Claude Code, traced to six ctest5 worktrees whose `.claude/settings.json` still referenced `/Users/.../orchard/scripts/claudinha-hook-relay.sh` from before the app was renamed to claudinha/
**Category:** implementation pattern

**What happened:**
`PermissionsManager.mergeHooks` decided whether its hook entry was "already present" by building a `Set` of current-command strings and asking whether any existing hook's `.command` was in that set. On first write into a fresh worktree this was correct. But after the Claudinha app directory was renamed from `orchard/` to `claudinha/`, `app.getAppPath()` returned a new absolute path, so the *current* command string no longer matched the stale string left in the worktree from the previous install. `alreadyPresent` became `false`, and the merge code cheerfully appended the new hook alongside the stale one. Every hook event then ran twice — once against the current path (succeeding), once against the ghost orchard path (failing with "No such file or directory"), flooding Claude Code with error toasts. The dedup was structurally unable to recognise its own past work.

**Why the agent got it wrong:**
The original code read like a safe idempotency guard — "if our commands are already there, skip; otherwise add them." The hidden assumption was that "our commands" is a stable string across time. That held while the app never moved, which is the only state the tests covered. The failure mode requires a physical rename of the app's install directory, which doesn't happen in dev or in unit tests, only in user reality when they rename / reorganise / reinstall. The agent was thinking in terms of *what my current code writes* (a single fixed command) rather than *what past versions of my code wrote* (commands whose path depended on where the app lived at the time). Exact-string matching treats two variants of the same conceptual entry as unrelated strangers.

**How to avoid this in the future:**
Any persistence written with an absolute path, version number, hostname, or any other ambient value baked in will eventually diverge from what the current code would write. Dedup/upsert logic that compares by the *current* serialization is guaranteed to leave stale siblings behind the day the ambient value shifts — installs move, users rename directories, hostnames change. Match persisted entries by a *recognition predicate* (does this entry look like something we wrote, regardless of path?) separate from the *equality check* (is this entry exactly what we'd write now?), then either replace or skip based on both. Concrete self-check before writing merge/upsert code: *"If the field I'm writing contains any value derived from the current environment (absolute path, app version, hostname, pid), can I recognise an earlier version of my own entry that used a different value? If not, add a sentinel/marker or match by structural pattern, not by equality."* And: when the on-disk state can only be written by this app but can persist across app renames/moves, include a one-shot migration sweep at launch — not just a per-spawn correction — so users already holding the broken state see the fix without needing to trigger the code path that touches each stale record.

---

## L-046: A "last-line" check on a streamed agent buffer misses any signal followed by a clarifier sentence, footer, or prompt prefix

**Date:** 2026-04-27
**Source:** feedback — screenshot of a Claudinha kanban card stuck in WORKING after the agent ended its turn with "Want me to fix #4? Those are the two cheapest pre-launch chores." The Stop hook's last-line `endsWith('?')` refinement missed the question because the very last line is the clarifier ("Those are…"), not the question. Notification doesn't fire on plain-text questions, so the card never moved to NEEDS INPUT.
**Category:** status detection / heuristic design

**What happened:**
The `Stop` hook handler in `hook-listener.ts` defaulted to `done` and refined to `needs-input` only when `lastOutput.split('\n').pop().endsWith('?')`. Two things in real PTY buffers break that:
1. Claude regularly follows a question with one more declarative sentence ("Those are the two cheapest pre-launch chores.") — so the literal last line is declarative even though the message is asking something.
2. Claude Code prints a `* Worked for Xm Ys` footer and a `> ` prompt prefix below the response — the actual response lines are never the literal last line of the buffer.
Either condition individually defeats the heuristic; together they're the common case. The card sat in WORKING until the user manually re-classified it.

**Why the agent got it wrong:**
The original heuristic was written for the most legible mental model — "if the message ends with a question mark, treat it as a question." That holds when you imagine the message as a clean, isolated paragraph. It fails the moment you remember the buffer is the *streamed terminal view*, which has its own framing layer (footers, prompt prefixes, line wrap) and its own conventional ending (the clarifier sentence after a question is a strong stylistic norm in Claude's writing). The reasoning gap was treating the agent's logical message and the terminal buffer as the same thing — and assuming the *signal* (a question) lives at the *boundary* (last line) instead of somewhere in a *region* (the recent tail). Same gap applies to any other "last X" check on streaming output: last line, last token, last paragraph — each works until the surrounding output adds anything after the signal.

**How to avoid this in the future:**
When classifying a multi-line agent buffer for a signal, ask: *"Could this signal be followed by metadata, a footer, a prompt prefix, a clarifying sentence, or commentary?"* If the answer is "yes" or "I don't know," scan a tail *window* (last N chars or last paragraph after blank lines), not the literal last line. Bound the scan with a regex that won't false-match earlier code blocks (e.g. `\?[^?]{0,200}$/s` — a `?` followed by ≤200 non-`?` chars to end). Concretely: prefer `region matches a question pattern` over `last line ends with the signal character`. Same rule applies to inverted detection (Done vs Needs Input) — the "completion" signal can be buried before clarifying notes, so completion patterns also need region-scoped matching, not boundary matching.
