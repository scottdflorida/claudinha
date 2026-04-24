/**
 * PaneSpawnBuffer — holds PTY output for a newly spawned pane until its
 * renderer-side XTermView mounts and registers its pane:data listener.
 *
 * Without this gate, any pane:data that fires before the renderer listener
 * attaches is emitted on ipcRenderer with no handler and dropped — producing
 * partial startup output (typically the first pane in a multi-pane workspace
 * launch). Same class of race as L-006 / L-014 but at the pane level.
 *
 * Lifecycle per pane:
 *   1. open(paneId, onTimeout)       — begin gating
 *   2. capture(paneId, data) → bool  — true if buffered, false if no gate
 *   3. flush(paneId) → string | null — release all buffered data, stop gating
 *   4. clear(paneId)                 — drop the gate without flushing
 *
 * A per-pane safety timer auto-flushes via `onTimeout` if the renderer never
 * signals ready (crash after mount, disposed window, etc.) so the buffer
 * cannot leak memory indefinitely.
 */

export const PANE_SPAWN_BUFFER_DEFAULT_TIMEOUT_MS = 10_000

interface Entry {
  chunks: string[]
  timer: ReturnType<typeof setTimeout>
}

export class PaneSpawnBuffer {
  private readonly entries = new Map<string, Entry>()

  /**
   * Begin gating PTY output for a pane. Must be called before the PTY starts
   * producing data. If a gate already exists for this pane it is replaced.
   *
   * @param onTimeout Fired if the gate is still open after `timeoutMs`. The
   *                  caller typically flushes the buffer to the window so
   *                  data isn't lost in renderer-crash scenarios.
   */
  open(
    paneId: string,
    onTimeout: () => void,
    timeoutMs: number = PANE_SPAWN_BUFFER_DEFAULT_TIMEOUT_MS
  ): void {
    const existing = this.entries.get(paneId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(onTimeout, timeoutMs)
    this.entries.set(paneId, { chunks: [], timer })
  }

  /**
   * Attempt to buffer a PTY data chunk for a gated pane.
   * Returns true if captured (caller must NOT forward to the window).
   * Returns false if no gate is open for this pane (caller forwards live).
   */
  capture(paneId: string, data: string): boolean {
    const entry = this.entries.get(paneId)
    if (!entry) return false
    entry.chunks.push(data)
    return true
  }

  /**
   * Flush all buffered chunks as a single concatenated string and remove the
   * gate. Returns null if no gate was open (so the caller can distinguish
   * "nothing buffered because already flushed" from "pane had a gate with
   * zero chunks").
   */
  flush(paneId: string): string | null {
    const entry = this.entries.get(paneId)
    if (!entry) return null
    clearTimeout(entry.timer)
    this.entries.delete(paneId)
    return entry.chunks.join('')
  }

  /** Drop the gate without flushing (e.g. PTY exited before ready). */
  clear(paneId: string): void {
    const entry = this.entries.get(paneId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.entries.delete(paneId)
  }

  /** Whether a gate is currently open for this pane. Primarily for tests. */
  isOpen(paneId: string): boolean {
    return this.entries.has(paneId)
  }
}
