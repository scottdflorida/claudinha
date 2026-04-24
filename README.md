# Claudinha

**A desktop companion for Claude Code,** with auto-tiled "Wall" view of many terminals, "Kanban" view with agent status, and other helpful visibility and orchestration features.

macOS, Windows, and Linux.

<!-- Replace with a real screenshot or GIF before v0.2.0 -->
<!-- ![Claudinha screenshot](docs/screenshot.png) -->

---

## Why

Running several Claude Code sessions in parallel from the terminal is powerful but quickly gets noisy: juggling tmux panes, losing track of which session is waiting for input, forgetting which worktree is which. Claudinha keeps every session visible, labeled, and reachable from one window, and layers on orchestration — a live agent-status board, per-session completion policies, a bulk merge queue, a permissions manager, and more — so parallel Claude Code work stops feeling like herding cats.

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

## Usage

### Getting started

1. Launch Claudinha.
2. Create a **workspace** by pointing it at a project directory (any git repo).
3. Spawn a **terminal** in the workspace — Claudinha creates a git worktree for it and starts a Claude Code session inside.
4. Open as many terminals as you need. Switch to the Kanban view any time to see everything at a glance.

Terminology: a **workspace** is a project you've opened; a **terminal** (also called a session) is a single Claude Code instance running in its own worktree under that workspace.

### Wall view — every terminal, all at once

The Wall is Claudinha's default layout: an auto-tiled grid that packs every terminal in the workspace into the window. Spawn more terminals and the grid re-tiles to fit; close one and the remaining panes expand. No manual resizing, no window juggling. Each pane shows its git branch, live agent status, and a header with focus/close/move controls. Drag the resize handles if you want custom proportions; hit the toggle to flip the whole workspace into Kanban.

### Kanban view — agent status at a glance

The Kanban view groups every session across every workspace by repository and shows where each agent is in its loop — **idle**, **working**, **awaiting permission**, **done**, or **failed**. The repo rail on the left lets you zoom into a single project; the board updates live as Claude Code hooks fire. It's the fastest way to answer "which of my sessions need me right now?" when you're running eight of them in parallel.

### Git worktrees per terminal

Every terminal runs in its own worktree under `.worktrees/` in the project, so parallel sessions can't step on each other's working tree. Branch, checkout, commit, and merge independently. When you're done with a session, Claudinha can clean up the worktree on close.

### Permissions manager

A dedicated view for reviewing and editing Claude Code's allowed-tool rules — globally, or overridden per project. Add, remove, or reset allow/deny patterns from a single pane instead of hand-editing settings files. Autocomplete draws from every rule across every project you've used, so common patterns are one keystroke away.

### Completion policies

Tell Claudinha what each session should do when it finishes: **notify** (just tell you), **auto-merge** the worktree into its base branch, **open a PR**, or **stop** with no action. Policies can be set per workspace and per session, and are enforced by Claudinha's completion executor — you don't have to babysit the endgame of each agent.

### Merge queue

When several sessions finish at once, the merge queue batches their completion actions so merges and PR-openings run in series with clear per-session status. If one fails, the rest still go through and the failure is surfaced with its error in the merge-or-PR-failed modal.

### Paused terminals

Snapshot a terminal, close it, and restore it later — scrollback and all. Paused terminals live on disk attached to the workspace they came from, so you can pick up an in-flight session after a restart without losing history.

### Session inspector

Open the inspector drawer on any terminal to see metrics, token usage, and session history. Useful for spotting runaway sessions, comparing cost across agents, and auditing what a session actually did.

### CLAUDE.md editor

Inline edit project-level and repo-level `CLAUDE.md` files without switching to your editor — useful when you're iterating on agent instructions mid-session.

### Keyboard-first navigation

Every workspace, terminal, and view is reachable via shortcuts. See **Help → Keyboard Shortcuts** in-app for the full cheat sheet.

### Internationalized

English and Brazilian Portuguese are bundled. The UI language follows the `LanguageFlagToggle` in the titlebar.

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
