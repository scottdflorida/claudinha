# Changelog

All notable changes to Claudinha are documented here. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/), and the project follows [Semantic Versioning](https://semver.org/).

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
