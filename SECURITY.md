# Security Policy

## Reporting a vulnerability

If you believe you've found a security issue in Claudinha, **please do not open a public GitHub issue**. Instead, report it privately to:

- **Email:** scott.d.florida@gmail.com
- **GitHub:** [Report a vulnerability via GitHub Security Advisories](https://github.com/scottdflorida/claudinha/security/advisories/new)

Please include:

- A description of the issue and its impact
- Steps to reproduce (a minimal test case if possible)
- Your Claudinha version, OS, and OS version
- Whether the issue requires any particular Claude Code configuration to trigger

You can expect an initial response within **7 days**. If the issue is confirmed, I'll work with you on a coordinated disclosure timeline before any public announcement or patch release.

## Scope

Claudinha spawns PTY sessions (`node-pty`) and executes Claude Code and git commands on your machine. Reports touching any of the following are in scope:

- The Electron main process (`src/main/`)
- The preload / IPC bridge (`src/preload/`, `src/shared/ipc-channels.ts`)
- Permissions handling (`src/main/permissions-*.ts`)
- PTY lifecycle and shell spawning (`src/main/pty-pool.ts`, `src/main/pane-lifecycle.ts`)
- Auto-update channels (when enabled)
- Telemetry transport (when the user has opted in)

Out of scope:

- Vulnerabilities in third-party dependencies that do not have a realistic exploitation path through Claudinha
- Issues in Claude Code itself — please report those to [Anthropic](https://github.com/anthropics/claude-code)
- Social-engineering attacks that require the user to run arbitrary shell commands

## Supported versions

During the pre-1.0 phase, only the **latest minor release** receives security fixes.

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
| < 0.1   | No        |
