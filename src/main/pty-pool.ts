import * as pty from 'node-pty'
import { PTY_GRACEFUL_KILL_TIMEOUT_MS } from './constants'
import type { Model } from '../shared/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  /** Pane ID — used as the ptyId key for 1:1 pane↔PTY mapping */
  paneId: string
  /** Absolute path for the PTY's working directory */
  workingDirectory: string
  /**
   * Additional environment variables merged on top of the user's shell env.
   * Typically includes CLAUDINHA_SOCKET_PATH, CLAUDINHA_PANE_ID, etc.
   */
  extraEnv?: Record<string, string>
  /** Optional CLI arguments passed to the `claude` command (e.g. ['--resume', '<id>']) */
  args?: string[]
  /**
   * Claude model alias (haiku/sonnet/opus). When set, `--model <model>` is
   * prepended to args so the spawned `claude` process starts on that model.
   * Omit to let Claude pick its own default.
   */
  model?: Model
  /**
   * Initial PTY dimensions. If omitted, default to 80×24 — but callers that
   * spawn a Claude Code session should always pass the real cols/rows so the
   * TUI doesn't paint at 24 rows and then have to redraw on the next
   * SIGWINCH (which strands the cursor one row south of the input box).
   */
  cols?: number
  rows?: number
  /** Called for each chunk of PTY output (must be low-latency, no buffering) */
  onData: (data: string) => void
  /** Called when the PTY process exits */
  onExit: (exitCode: number, signal?: number) => void
}

export interface SpawnResult {
  /** The ptyId (equals paneId) for subsequent operations */
  ptyId: string
  /**
   * True if ANTHROPIC_API_KEY was found in the spawned process environment.
   * Used to decide whether to show cost metrics in the UI (PRD F7).
   */
  isApiBilling: boolean
}

interface PtyEntry {
  pty: pty.IPty
  hasExited: boolean
  killTimer?: ReturnType<typeof setTimeout>
}

interface PendingEntry {
  options: SpawnOptions
  /** Falls back to spawning at 80×24 if the renderer never sends a resize. */
  safetyTimer: ReturnType<typeof setTimeout>
}

/**
 * Safety net: if the renderer never reports a real cols/rows (broken xterm
 * mount, 0-sized container, crashed renderer), spawn at the legacy 80×24
 * default after this delay so the user isn't left with a never-started PTY.
 */
const PENDING_SPAWN_SAFETY_MS = 10_000

// ---------------------------------------------------------------------------
// PtyPool
// ---------------------------------------------------------------------------

/**
 * PtyPool — creates and manages node-pty instances for Claude Code sessions.
 *
 * Each pane has exactly one PTY. The ptyId equals the paneId for simplicity.
 * A single instance is created in index.ts and shared by IPC handlers.
 */
export class PtyPool {
  private readonly ptys = new Map<string, PtyEntry>()
  private readonly pending = new Map<string, PendingEntry>()

  /**
   * Spawn a new PTY running the `claude` CLI in the given directory.
   *
   * PTY inherits the user's full shell environment, merged with extraEnv.
   * Callbacks fire on the main process thread — keep them fast.
   *
   * PRD NFR Performance: PTY output must be forwarded with < 10ms latency.
   * Do not buffer or batch data before calling onData.
   */
  spawn(options: SpawnOptions): SpawnResult {
    const { paneId, workingDirectory, extraEnv = {}, args = [], model, cols, rows, onData, onExit } = options

    // If the caller previously deferred this paneId via prepareSpawn, drop
    // that pending entry — this call is the actual spawn we were waiting for.
    this.clearPending(paneId)

    // Merge: user shell env → extraEnv (extraEnv can override shell env)
    const mergedEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) mergedEnv[k] = v
    }
    for (const [k, v] of Object.entries(extraEnv)) {
      mergedEnv[k] = v
    }

    const isApiBilling = !!mergedEnv['ANTHROPIC_API_KEY']

    // Prepend --model so it sits before any --resume etc and is unambiguous
    // to the CLI parser. Skip when model is undefined to let Claude default.
    const finalArgs = model ? ['--model', model, ...args] : args

    const ptyProcess = pty.spawn('claude', finalArgs, {
      name: 'xterm-256color',
      cols: cols ?? 80,
      rows: rows ?? 24,
      cwd: workingDirectory,
      env: mergedEnv
    })

    const entry: PtyEntry = { pty: ptyProcess, hasExited: false }
    this.ptys.set(paneId, entry)

    // Forward PTY output directly — no buffering (PRD NFR < 10ms latency)
    ptyProcess.onData((data) => {
      onData(data)
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      entry.hasExited = true
      if (entry.killTimer) {
        clearTimeout(entry.killTimer)
        entry.killTimer = undefined
      }
      onExit(exitCode ?? 0, signal ?? undefined)
    })

    return { ptyId: paneId, isApiBilling }
  }

  /**
   * Reserve a paneId for a deferred spawn. The actual `pty.spawn()` call is
   * delayed until the first `resize()` for this paneId — so Claude Code
   * starts at the renderer's real cols/rows instead of the 80×24 default.
   *
   * Why: if the PTY exec's at 80×24, Claude Code (an ink TUI) paints its
   * input box for that geometry. When the renderer's xterm subsequently
   * fits and sends `PANE_RESIZE`, ink redraws — but its "leave cursor below
   * the dynamic region" anchor is computed against the previous paint and
   * lands one row south of the freshly-drawn input box. Deferring the exec
   * until the real geometry is known eliminates the mid-startup SIGWINCH
   * and the resulting cursor drift.
   *
   * Returns synchronously: `ptyId` and `isApiBilling` are knowable from the
   * options alone (the API key check just inspects merged env), so the
   * caller can populate PaneState immediately.
   *
   * Safety: if no resize arrives within PENDING_SPAWN_SAFETY_MS, the spawn
   * runs at the legacy 80×24 default so a broken renderer can't strand us.
   */
  prepareSpawn(options: SpawnOptions): SpawnResult {
    const { paneId, extraEnv = {} } = options

    // isApiBilling is just an env-presence check; no need to wait for the
    // PTY to exist before reporting it.
    const apiKey = extraEnv['ANTHROPIC_API_KEY'] ?? process.env.ANTHROPIC_API_KEY
    const isApiBilling = !!apiKey

    // Drop any prior pending entry for this paneId before installing the
    // new one (defensive — paneIds are unique per session, so this should
    // never actually hit, but the dangling timer cost would be silent).
    this.clearPending(paneId)

    const safetyTimer = setTimeout(() => {
      const entry = this.pending.get(paneId)
      if (!entry) return
      console.warn('[pty-pool] pending spawn safety timeout — falling back to 80×24', paneId)
      // Don't call clearPending here; spawn() does that. Just kick spawn().
      this.spawn(entry.options)
    }, PENDING_SPAWN_SAFETY_MS)

    this.pending.set(paneId, { options, safetyTimer })
    return { ptyId: paneId, isApiBilling }
  }

  private clearPending(paneId: string): boolean {
    const entry = this.pending.get(paneId)
    if (!entry) return false
    clearTimeout(entry.safetyTimer)
    this.pending.delete(paneId)
    return true
  }

  /**
   * Returns the raw node-pty instance for a given ptyId, or undefined.
   * Prefer using the typed methods (write, resize, kill) over direct access.
   */
  getPty(ptyId: string): pty.IPty | undefined {
    return this.ptys.get(ptyId)?.pty
  }

  /**
   * Write data (user keyboard input) to the PTY.
   * No-ops silently if the PTY does not exist or has already exited.
   */
  write(ptyId: string, data: string): void {
    const entry = this.ptys.get(ptyId)
    if (!entry || entry.hasExited) return
    try {
      entry.pty.write(data)
    } catch {
      // Process may be in the middle of exiting — ignore
    }
  }

  /**
   * Resize the terminal dimensions. Must be called whenever the pane container
   * changes size so the running process sees the correct cols/rows.
   *
   * If this paneId has a pending (deferred) spawn from prepareSpawn(), that
   * spawn is now executed at the supplied cols/rows — this is the moment
   * Claude Code's PTY actually starts.
   */
  resize(ptyId: string, cols: number, rows: number): void {
    const pending = this.pending.get(ptyId)
    if (pending) {
      this.spawn({ ...pending.options, cols, rows })
      return
    }
    const entry = this.ptys.get(ptyId)
    if (!entry || entry.hasExited) return
    try {
      entry.pty.resize(cols, rows)
    } catch {
      // Process may be exiting — ignore
    }
  }

  /**
   * Kill a PTY process gracefully:
   * 1. Send SIGHUP (graceful termination signal for terminal sessions)
   * 2. After PTY_GRACEFUL_KILL_TIMEOUT_MS (2s), force-kill if still alive
   * 3. Remove from the pool after the kill timer fires (whether or not it exited)
   *
   * PRD F2: "sends SIGHUP, waits briefly for graceful exit, then force-kills"
   * Windows: node-pty does not support SIGHUP; falls back to unconditional kill.
   */
  kill(ptyId: string): void {
    // A pending (deferred) spawn that gets killed before its first resize
    // never started a real process — just drop the pending entry.
    if (this.clearPending(ptyId)) return

    const entry = this.ptys.get(ptyId)
    if (!entry) return

    if (entry.hasExited) {
      this.ptys.delete(ptyId)
      return
    }

    // Attempt graceful SIGHUP first
    try {
      if (process.platform !== 'win32') {
        entry.pty.kill('SIGHUP')
      } else {
        // Windows: no SIGHUP — go straight to unconditional kill
        entry.pty.kill()
      }
    } catch {
      // Process may already be dead
    }

    // Schedule force-kill after timeout
    entry.killTimer = setTimeout(() => {
      if (!entry.hasExited) {
        try {
          entry.pty.kill()
        } catch {
          // Ignore
        }
      }
      this.ptys.delete(ptyId)
    }, PTY_GRACEFUL_KILL_TIMEOUT_MS)
  }

  /**
   * Kill all PTYs in the pool. Used during app shutdown to avoid orphan processes.
   */
  killAll(): void {
    for (const ptyId of this.pending.keys()) {
      this.clearPending(ptyId)
    }
    for (const ptyId of this.ptys.keys()) {
      this.kill(ptyId)
    }
  }

  /**
   * Returns true if the given ptyId exists and has not yet exited.
   * A pending (deferred) spawn counts as alive — the pane logically owns
   * a PTY even if it hasn't exec'd yet.
   */
  isAlive(ptyId: string): boolean {
    if (this.pending.has(ptyId)) return true
    const entry = this.ptys.get(ptyId)
    return !!entry && !entry.hasExited
  }

  /** Number of PTY entries (includes entries pending force-kill) */
  get size(): number {
    return this.ptys.size + this.pending.size
  }
}
