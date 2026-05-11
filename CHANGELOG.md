# Changelog

All notable changes to Claudinha are documented here. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/), and the project follows [Semantic Versioning](https://semver.org/).

## 0.3.0 — 2026-05-11

### Added

- **Bulk Change (Completion Actions v2).** A new flow for promoting work from active terminals into reviewable, mergeable commits. The rail card has a "Changes Ready" link that opens a per-pane Turns modal listing every Claude-Code-authored turn since the base branch; you can split (including hunk-level via interactive rebase), discard with cascade rebase, reorder, or punt back to Claude. A repo-level Bulk Change modal aggregates every pane in a repo and runs selected bulk actions (merge / push / open PR) through a sequential pipeline with per-pane progress, multi-conflict handling, no-FF for sequential merges, and PR URL surfacing. A per-repo Publish-path config controls whether direct merges go through a side-clone or the working tree.
- **"On main" branch layout.** New workspace option that runs panes directly on the base branch with no worktrees — each turn becomes a commit on `main`. The launch form disables per-pane branch naming when this layout is selected.
- **Redesigned repo rail.** Per-pane cards grouped by repo, with a draggable width handle, the active pane's last-message as the card subtitle, Planning/Working state labels that animate with cycling dots, and a "Changes Ready" link that opens the Turns modal.
- **Plan-mode column ("Planning" / "Plan Ready").** Panes in `ExitPlanMode` land in their own column instead of being misfiled as Working or Awaiting Orders. The status pill speaks the same column vocabulary as the board.
- **Inspector summary pinned to Haiku at low effort** for speed and cost.
- **New-workspace form remembers advanced choices** across launches.

### Changed

- **"ADE" replaces "Kanban" in user-facing labels.** View-mode toggle, launch-form picker, Configuration view, keyboard-shortcuts overlay, and hint copy now read "ADE." Internal IPC values still use `'kanban'`, so no migration is needed.
- **Dark mode is locked.** The title-bar theme toggle is hidden and the app stays dark regardless of system theme.
- **Status pill speaks the column vocabulary** (Working, Awaiting Orders, Planning, etc.) instead of generic states.
- **Tactile slide-up + card-move animations** on the ADE view, including cross-column transitions and column refreshes.
- **Per-terminal modal polish.** Shipped-state checkboxes disabled, the close-confirm counts ahead-of-origin, the sequence dialog is wider.
- **Merge button is explicit about the destination** — "Merge to origin/<base>".
- **Dialogs cap at viewport height** with internal scrolling instead of running off-screen.
- **Dev launches.** The dev icon is badged "DEV" so it's distinguishable from the installed app in the Dock, and dev launches no longer collide with the installed app's user-data directory.

### Fixed

- **Phantom-working states.** Idle redraws no longer flip fresh agents to "working"; the phantom-working bridge is narrowed to actual thinking words.
- **Worktree git hygiene.** `.worktrees/` and `.claude/` are written to `.git/info/exclude` on spawn so the turn recorder's `git add -A` no longer fails on those paths.
- **Push gate.** The status pill clears its "↑N to push" indicator immediately after a push, and the ADE Push affordance requires an engaged agent.
- **Workspace creation re-validates the repo path**, so a deleted-and-recreated path isn't held stale in memory.
- **Window-bound focus.** `WORKSPACE_FOCUS_PANE` is now allowed through preload and repaints the ADE pane on show.
- **TURNS_GET** stops short-circuiting on `pane.isWorktree`, so on-main panes list their turns correctly.
- **Failed-merge recovery** surfaces in the ADE view instead of being buried.
- **CI.** Permissions/metrics tests are cross-platform; the Windows test gate is re-enabled. GitHub Actions bumped to current majors.

## 0.2.0 — 2026-04-27

### Added

- **Workspace spawn loading overlay.** First-time terminal spawn now shows a Claudinha overlay with an eye-blink animation while the PTY warms up.
- **Rate-limit elapsed-time marker.** For rate-limited sessions, the rate-limit bar now includes a marker showing where you are in the current reset timeline — e.g. if you are 3.5 days from reset on a 7-day limit, the marker sits at the halfway point of the bar regardless of where actual usage is.

### Changed

- **App icon polish.** The icon now respects Apple's macOS safe-area template so it renders at the same visual size as system apps in the Dock and Cmd-Tab switcher, instead of ~24% larger. The character has more breathing room inside the green squircle and the bottom shadow is lighter.
- **Terminal cursor in Claudinha gold.** The xterm cursor color is locked to Claudinha's gold accent rather than inheriting whatever theme color happens to be active, and the standard ANSI palette is restored so rendering is consistent across themes.

### Fixed

- **Kanban resize drag.** No longer freezes and prevents further resizing.

## 0.1.1 — 2026-04-24

### Changed

- **Kanban is now the default view mode.** New workspaces and fresh installs land in Kanban. Three stale `'wall'` fallbacks in the window-init payload, the workspace shell, and the Settings view-mode control were out of step with the rest of the product and have been flipped.
- **Launch-form model precedence.** When "Default model" is set in Settings, it now overrides the most-recently-used model in the Plant-a-workspace form. Baseline remains Opus + High; picking "None" in Settings returns control to the last-used model. If the override lands on a non-Opus model, effort clamps from `max`/`xhigh` down to `high`, matching the rule that already runs when a user picks a model manually.
- **Refreshed app icon** with gradients, inner depth layers, highlights, and soft drop shadows, so the Dock tile reads as a modern 3D piece rather than flat color blocks. Same green-squircle silhouette and yellow-face character. Already-installed builds will keep the old tile until reinstalled — electron-builder bakes the `.icns` at package time.

### Fixed

- **`npm install -g claudinha` now launches.** Electron and `@electron/rebuild` were in devDependencies, so global installs were missing the runtime packages that `bin/claudinha` and the postinstall step rely on. Both are now production dependencies.
- **Published tarball trimmed to runtime-only files** (`out/`, `bin/`, `assets/`) via a `files` allowlist in `package.json`. Source, tests, docs, and CI config no longer ship to npm. Packed size: ~812 KB across 25 files.

## 0.1.0 — Initial public release

First open-source release of Claudinha — a terminal manager for Claude Code.

### Added

- **Multi-session window.** Spawn, tile, resize, move, and close multiple Claude Code terminals in a single Electron window.
- **Git worktrees per session.** Each terminal runs in its own worktree under `.worktrees/` so parallel sessions don't collide.
- **Kanban view.** Live status board grouped by repository, showing which sessions are idle, working, awaiting permission, done, or failed.
- **Permissions manager.** Review and edit Claude Code allowed-tool rules globally or per project.
- **Completion policies.** Per-session configuration for what happens when a session finishes (notify, auto-merge, open PR, or stop).
- **Merge queue.** Bulk-merge or open PRs across multiple completed sessions.
- **Paused terminals.** Archive session snapshots and restore them later.
- **Session inspector.** Metrics, token usage, and session history.
- **CLAUDE.md editor.** Inline editing of project and repo-level `CLAUDE.md` files.
- **Keyboard shortcuts** for navigation between workspaces and terminals.
- **Internationalization.** English and Brazilian Portuguese.
- **Opt-in anonymous telemetry.** First-launch consent dialog, Configuration-screen toggle, anonymous `installation_id` only, no PII. Full event catalog in `docs/analytics-event-catalog.md`.
- **Prebuilt installers** for macOS (`.dmg`, `.zip`), Windows (`.exe`), and Linux (`.AppImage`).
- **npm global install** (`npm install -g claudinha`).

### Known limitations

- Builds are **not** code-signed or notarized. macOS users need to right-click → Open on first launch; Windows users may see a SmartScreen warning.
