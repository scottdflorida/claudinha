# Contributing to Claudinha

Thank you for your interest in contributing.

---

## Development Setup

### Prerequisites

- **Node.js** 20 or later
- **npm** 10 or later
- **Claude Code** CLI installed (`npm install -g @anthropic-ai/claude-code`)
- macOS, Windows, or Linux

### Clone and install

```bash
git clone https://github.com/scottdflorida/claudinha.git
cd claudinha
npm install
```

> `postinstall` runs `electron-rebuild` automatically to compile native modules (`node-pty`) for your Electron version.

---

## Build and Run

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start in dev mode with hot reload (electron-vite) |
| `npm run build` | Compile TypeScript → `out/` |
| `npm run dist` | Compile + package installers → `dist/` |
| `npm run typecheck` | Type-check main and renderer processes |
| `npm run preview` | Preview the production build |

### Dev workflow

```bash
npm run dev
```

This starts Electron with Vite's dev server for the renderer. Changes to renderer code hot-reload; changes to main process code require restarting.

---

## Architecture Overview

Claudinha is an Electron application using the standard main/renderer split.

```
src/
  main/           # Electron main process (Node.js)
    index.ts        # App entry point, lifecycle wiring
    window-manager.ts
    session-registry.ts  # Tracks all pane sessions
    pty-pool.ts          # node-pty process pool
    ipc-handlers.ts      # IPC bridge (main side)
    hook-listener.ts     # Claude Code hook event listener
    status-detector.ts   # Pane status inference
    metrics-collector.ts # Session metrics
    permissions-manager.ts
    menu.ts              # Application menu bar
    auto-updater.ts      # electron-updater integration

  renderer/       # React UI (runs in Electron's BrowserWindow)
    components/     # React components
    hooks/          # Custom React hooks
    store/          # State management

src/preload/      # Context bridge — exposes safe IPC APIs to renderer
```

**Key design constraints:**
- All Claude Code processes are spawned in the main process via `node-pty`
- The renderer communicates with main exclusively through IPC (no direct Node access)
- Session state lives in `SessionRegistry` (main process); renderer receives updates via IPC events

---

## Contribution Guidelines

### Before you start

- Check open issues to avoid duplicating work
- For non-trivial changes, open an issue first to discuss the approach

### Making changes

1. Create a branch from `main`
2. Keep changes focused — one concern per PR
3. Follow existing TypeScript patterns and naming conventions
4. Run `npm run typecheck` before submitting

### Pull requests

- Write a clear PR description explaining what and why
- Reference any related issues
- Keep diffs small and reviewable

### Code style

- TypeScript strict mode is enabled — no `any` without justification
- Prefer explicit types on public function signatures
- Main-process modules are classes or plain functions — no framework

---

## License

By contributing, you agree your contributions will be licensed under the [MIT License](LICENSE).
