# Changelog

All notable changes to Claudinha are documented here. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/), and the project follows [Semantic Versioning](https://semver.org/).

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
