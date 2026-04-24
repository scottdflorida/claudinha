# Claudinha

**A terminal manager for Claude Code.** Run many Claude Code sessions side-by-side in one window — each in its own git worktree, with a Kanban-style overview, completion policies, shared permissions, and cross-session bulk actions.

macOS, Windows, and Linux.

<!-- Replace with a real screenshot or GIF before v0.2.0 -->
<!-- ![Claudinha screenshot](docs/screenshot.png) -->

---

## Why

Running several Claude Code sessions in parallel from the terminal is powerful but quickly gets noisy: juggling tmux panes, losing track of which session is waiting for input, forgetting which worktree is which. Claudinha keeps every session visible, labeled, and reachable from one window — and adds a Kanban board so you can see at a glance which sessions are idle, working, blocked on permission, or done.

---

## Features

- **Many sessions in one window.** Spawn and tile multiple Claude Code terminals. Resize, move, and close them without leaving the app.
- **Git worktrees per session.** Each session runs in its own worktree under `.worktrees/` so parallel work doesn't collide.
- **Kanban view.** Live status board grouped by repository — idle, working, awaiting permission, done, or failed.
- **Permissions manager.** Review and edit allowed tools globally or per project.
- **Completion policies.** Configure what happens when a session finishes — notify, auto-merge, open PR, or stop.
- **Merge queue.** Bulk-merge or open PRs across multiple finished sessions.
- **Paused terminals.** Archive session snapshots to disk and restore them later.
- **Session inspector.** Metrics, token usage, and history per session.
- **CLAUDE.md editor.** Quick inline editing of project and repo-level `CLAUDE.md` files.
- **Keyboard-first.** Shortcut-driven navigation between workspaces and terminals.
- **Internationalized.** English and Brazilian Portuguese out of the box.

---

## Requirements

- **Node.js 20+** (only for the `npm install -g` install path; not needed if you use a prebuilt installer)
- **[Claude Code CLI](https://github.com/anthropics/claude-code)** installed and on your `PATH` (`npm install -g @anthropic-ai/claude-code`)
- **git** available on your `PATH`
- macOS, Windows, or Linux

---

## Install

### Prebuilt installers (recommended)

Download the latest artifact for your platform from the [Releases](https://github.com/scottdflorida/claudinha/releases) page:

| Platform | File |
|----------|------|
| macOS | `Claudinha-x.x.x.dmg` or `-mac.zip` |
| Windows | `Claudinha-Setup-x.x.x.exe` |
| Linux | `Claudinha-x.x.x.AppImage` |

> **Note on unsigned builds.** v0.1.x artifacts are **not** code-signed or notarized. On macOS, Gatekeeper will refuse to open the app on first launch — right-click the app in Finder, choose **Open**, then confirm. On Windows, SmartScreen may warn; choose **More info → Run anyway**. Signed builds are planned for a later release.

### npm

```bash
npm install -g claudinha
claudinha
```

The global install pulls the Electron runtime and native modules (`node-pty`) and rebuilds them for your platform. First install takes a minute or two.

### From source

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup.

---

## Quick start

1. Launch Claudinha.
2. Create a workspace by pointing it at a project directory (any git repo).
3. Spawn a terminal in the workspace — Claudinha creates a worktree for it and starts a Claude Code session.
4. Open the Kanban view to see all sessions across all workspaces at a glance.

Terminology: **workspace** = a project you've opened; **terminal** / **session** = a single Claude Code instance running in a worktree under that workspace.

---

## Telemetry & privacy

Claudinha includes **opt-in** anonymous usage telemetry to help improve the product.

- **Opt-in, not opt-out.** On first launch, a dialog asks whether to enable telemetry. If you decline or close the dialog without choosing, **no events are sent**.
- **Change your mind anytime** in **Configuration → Privacy**.
- **No PII.** Events are identified only by a random `installation_id` UUID generated locally. No file paths, prompts, outputs, git URLs, usernames, or email addresses are ever transmitted.
- **Full catalog of events** is documented in [`docs/analytics-event-catalog.md`](docs/analytics-event-catalog.md) — every field, every event, with the exact schema.

---

## Links

- **Issues:** https://github.com/scottdflorida/claudinha/issues
- **Security:** see [SECURITY.md](SECURITY.md)
- **Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md)
- **Changelog:** see [CHANGELOG.md](CHANGELOG.md)

---

## License

MIT — see [LICENSE](LICENSE).

---

## Not affiliated with Anthropic

Claudinha is an independent, community tool and is **not** affiliated with, endorsed by, or sponsored by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, PBC.
