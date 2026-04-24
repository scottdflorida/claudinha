/**
 * PaneTransitionBuffer — buffers PTY data during pane transitions between windows.
 *
 * When a pane is moved to a new window, there is a period where the target
 * window's renderer isn't ready to receive PTY data. This buffer captures
 * that data so it can be replayed once the target is ready.
 *
 * During buffering, PTY data ALSO continues flowing to the source window
 * (the caller is responsible for still forwarding normally). The buffer
 * captures a COPY for replay in the target.
 *
 * Lifecycle:
 *   1. startBuffering(paneId) — begin capturing data
 *   2. write(paneId, data) — append a chunk (returns true if buffered)
 *   3. flush(paneId) — return all buffered data and stop buffering
 *
 * Safety: a timeout auto-clears each buffer to prevent memory leaks
 * if the target window fails to load.
 */
export class PaneTransitionBuffer {
  private readonly buffers = new Map<
    string,
    { chunks: string[]; timer: ReturnType<typeof setTimeout> }
  >()

  /**
   * Begin capturing PTY data for a pane.
   * If the pane is already being buffered, the existing buffer is cleared first.
   *
   * @param paneId    The pane to buffer
   * @param timeoutMs Safety timeout — buffer is auto-cleared after this duration (default 10s)
   */
  startBuffering(paneId: string, timeoutMs = 10_000): void {
    this.clear(paneId)

    const timer = setTimeout(() => {
      console.warn('[transition-buffer] timeout: clearing buffer for pane', paneId)
      this.buffers.delete(paneId)
    }, timeoutMs)

    this.buffers.set(paneId, { chunks: [], timer })
  }

  /**
   * Buffer a chunk of PTY data.
   *
   * Returns true if the data was captured (pane is being buffered).
   * Returns false if this pane is not being buffered.
   *
   * The caller should ALSO forward the data to the current window normally —
   * buffering captures a copy for replay, it does not intercept the live stream.
   */
  write(paneId: string, data: string): boolean {
    const entry = this.buffers.get(paneId)
    if (!entry) return false
    entry.chunks.push(data)
    return true
  }

  /**
   * Flush all buffered data and stop buffering.
   * Returns the concatenated buffered data string.
   * Returns empty string if the pane was not being buffered.
   */
  flush(paneId: string): string {
    const entry = this.buffers.get(paneId)
    if (!entry) return ''
    clearTimeout(entry.timer)
    const result = entry.chunks.join('')
    this.buffers.delete(paneId)
    return result
  }

  /** Discard the buffer without flushing (e.g. on error or timeout). */
  clear(paneId: string): void {
    const entry = this.buffers.get(paneId)
    if (entry) {
      clearTimeout(entry.timer)
      this.buffers.delete(paneId)
    }
  }

  /** Check if a pane is currently being buffered. */
  isBuffering(paneId: string): boolean {
    return this.buffers.has(paneId)
  }
}
