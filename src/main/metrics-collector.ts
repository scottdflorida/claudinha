import fs from 'fs'
import path from 'path'
import { IPC, metricsToIpc } from '../shared/ipc-channels'
import type { PaneMetricsPayload, RateLimitsPayload, RateLimitWindow } from '../shared/ipc-channels'
import type { PaneMetrics, ToolUsageSummary } from '../shared/types'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import type { InspectorService } from './inspector'
import {
  abbreviateModel,
  getModelContextWindow,
  getStatuslineTempDir,
  AUTO_COMPACT_BUFFER_TOKENS
} from './constants'

// ---------------------------------------------------------------------------
// JSONL transcript entry schema (Claude Code session transcript)
// ---------------------------------------------------------------------------

interface JsonlEntry {
  type?: string
  isSidechain?: boolean
  isApiErrorMessage?: boolean
  message?: {
    role?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
  /** Present on tool_use entries */
  tool_name?: string
  /** Present on custom-title entries (AI-generated session title) */
  customTitle?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Statusline JSON schema (Claude Code → claudinha-statusline.sh → temp file)
// ---------------------------------------------------------------------------

interface StatuslineJson {
  session_id?: string
  transcript_path?: string
  model?: {
    id?: string
    display_name?: string
  }
  cost?: {
    total_cost_usd?: number
    total_duration_ms?: number
    total_api_duration_ms?: number
    total_lines_added?: number
    total_lines_removed?: number
  }
  context_window?: {
    used_percentage?: number
    context_window_size?: number
  }
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: string | number }
    seven_day?: { used_percentage?: number; resets_at?: string | number }
  }
  // Additional fields ignored
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

/**
 * MetricsCollector — reads Claude Code's statusline JSON for metrics (PRD F7).
 *
 * At pane spawn time, PermissionsManager configures Claude Code to pipe a
 * JSON payload to `scripts/claudinha-statusline.sh` on each statusline update.
 * That script writes the JSON atomically to `/tmp/claudinha-statusline-{paneId}.json`.
 *
 * MetricsCollector watches that file with fs.watchFile (polling) and parses:
 *   cost.total_cost_usd           → totalCostUsd
 *   cost.total_duration_ms        → durationMs
 *   cost.total_lines_added        → linesAdded
 *   cost.total_lines_removed      → linesRemoved
 *   model.id                      → modelDisplayName (abbreviated)
 *   model.display_name            → modelDisplayName (preferred)
 *   context_window.used_percentage → contextPercent
 *   transcript_path               → stored in SessionRegistry for B-037
 *
 * totalTokens and toolsUsed are populated by B-037 (JSONL parsing).
 * This class preserves those fields when merging metrics.
 *
 * fs.watchFile is used instead of fs.watch because the statusline temp file
 * does not exist at spawn time — the hook relay creates it shortly after.
 * fs.watchFile supports non-existent files (polling detects creation).
 *
 * A single instance is created in index.ts. Call watchPane() at spawn and
 * unwatchPane() on pane close.
 */
export class MetricsCollector {
  /** Map of paneId → filePath being watched via fs.watchFile */
  private readonly watchedFiles = new Map<string, string>()

  /**
   * Last emitted rate limit payload, serialized for change detection.
   * Rate limits are account-global, so we deduplicate across all panes.
   */
  private lastRateLimitsJson: string | null = null

  /**
   * Set post-construction by index.ts to break the Inspector↔Metrics circular
   * dep. Lets us overlay `linesAdded`/`linesRemoved` on PaneMetrics with the
   * inspector's git-computed cache so the Kanban card chip agrees with the
   * repo-rail row (single source of truth; L-032).
   */
  private inspector: InspectorService | null = null

  constructor(
    private readonly sessionRegistry: SessionRegistry,
    private readonly windowManager: WindowManager
  ) {}

  /**
   * Wire the InspectorService after construction (see inspector field comment).
   * Called from index.ts alongside the other bidirectional references.
   */
  setInspector(inspector: InspectorService): void {
    this.inspector = inspector
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Return the last broadcast rate limit payload, or null if none received yet. */
  getLastRateLimits(): import('../shared/ipc-channels').RateLimitsPayload | null {
    if (!this.lastRateLimitsJson) return null
    try {
      return JSON.parse(this.lastRateLimitsJson) as import('../shared/ipc-channels').RateLimitsPayload
    } catch {
      return null
    }
  }

  /**
   * Start watching the statusline temp file for this pane.
   * Call after PTY spawn, once the pane is registered.
   *
   * Uses fs.watchFile (polling) so the watcher works even when the file
   * does not exist yet. The callback fires when mtime changes, including
   * on initial file creation.
   */
  watchPane(paneId: string): void {
    const filePath = path.join(getStatuslineTempDir(), `claudinha-statusline-${paneId}.json`)

    // Initial read — no-op if file not yet written (onFileChange handles ENOENT)
    this.onFileChange(paneId, filePath)

    // Polling-based watcher — works for non-existent files (fires when file appears)
    fs.watchFile(filePath, { persistent: false, interval: 2000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        this.onFileChange(paneId, filePath)
      }
    })

    this.watchedFiles.set(paneId, filePath)
    // [rate-limits-debug] temporary — confirms watcher is wired for this pane
    console.log('[metrics-collector] watchPane', paneId, '->', filePath)
  }

  /**
   * Trigger an async re-read of the JSONL transcript for this pane.
   *
   * Called by HookListener on Stop or Notification hook events (PRD F7).
   * Uses the transcript_path stored in SessionRegistry (set by HookListener
   * on Stop events, or from the statusline JSON via applyStatuslineData).
   *
   * Non-blocking: runs async, does not throw.
   */
  parseTranscriptForPane(paneId: string): void {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane?.transcriptPath) return

    void this.parseTranscriptAsync(paneId, pane.transcriptPath)
  }

  /**
   * Stop watching the statusline temp file and clean up.
   * Call on pane close.
   */
  unwatchPane(paneId: string): void {
    const filePath = this.watchedFiles.get(paneId)
    if (filePath) {
      fs.unwatchFile(filePath)
      this.watchedFiles.delete(paneId)
    }
  }

  // ---------------------------------------------------------------------------
  // Private — file parsing and emission
  // ---------------------------------------------------------------------------

  private onFileChange(paneId: string, filePath: string): void {
    // Read and parse the statusline JSON file
    let raw: string
    try {
      raw = fs.readFileSync(filePath, 'utf8')
    } catch {
      // File not yet written or was deleted — ignore
      return
    }

    let data: StatuslineJson
    try {
      data = JSON.parse(raw) as StatuslineJson
    } catch {
      console.warn('[metrics-collector] failed to parse statusline JSON for pane', paneId)
      return
    }

    // [rate-limits-debug] temporary — confirms file write reached the watcher
    console.log(
      '[metrics-collector] onFileChange',
      paneId,
      'bytes=' + raw.length,
      'hasRateLimits=' + (data.rate_limits ? 'yes' : 'no')
    )

    this.applyStatuslineData(paneId, data)
  }

  private applyStatuslineData(paneId: string, data: StatuslineJson): void {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return

    // Store transcript_path in SessionRegistry for JSONL parsing (B-037).
    // If this is the first time we're learning the path (pane was attached
    // but no Stop hook has fired yet), kick off an async JSONL parse so the
    // `custom-title` session-name entry is picked up within one statusline
    // poll cycle (~2s) instead of waiting for the next Stop. Later updates
    // of the same path are no-ops — Stop/Notification handle incremental
    // re-parses.
    if (data.transcript_path) {
      const isFirstTranscriptPath = !pane.transcriptPath
      this.sessionRegistry.updatePaneTranscriptPath(paneId, data.transcript_path)
      if (isFirstTranscriptPath) {
        void this.parseTranscriptAsync(paneId, data.transcript_path)
      }
    }

    // Store context_window_size from statusline (PE-02) — used by JSONL fallback
    if (data.context_window?.context_window_size) {
      this.sessionRegistry.updatePaneContextWindowSize(paneId, data.context_window.context_window_size)
    }

    // Resolve model display name: always use abbreviated model ID (PRD F7).
    // model.id maps to abbreviations like s4.6, o4.6, h4.5.
    // display_name (e.g. "Claude Sonnet 4.6") is not used — not in the mapping.
    let modelDisplayName: string | null = null
    if (data.model?.id) {
      modelDisplayName = abbreviateModel(data.model.id)
    } else if (data.model?.display_name) {
      // Fallback: first 6 chars of display name if no id available
      modelDisplayName = data.model.display_name.slice(0, 6)
    }

    // Build partial metrics from statusline data — preserve JSONL-derived fields.
    // linesAdded/linesRemoved intentionally come from the inspector's
    // git-computed diff cache (via this.pickLineCounts) rather than Claude
    // Code's statusline `cost.total_lines_added/removed`. The per-pane card
    // chip and the repo-rail row must agree, and git is the authoritative
    // source for "what would land on merge" (L-032).
    const existingMetrics = pane.metrics
    const lineCounts = this.pickLineCounts(paneId, existingMetrics)
    const updatedMetrics: PaneMetrics = {
      // Preserve JSONL-derived fields (populated by B-037)
      totalTokens: existingMetrics.totalTokens,
      toolsUsed: existingMetrics.toolsUsed,
      sessionTitle: existingMetrics.sessionTitle,

      // Statusline-derived fields
      contextPercent: data.context_window?.used_percentage ?? existingMetrics.contextPercent,
      totalCostUsd: data.cost?.total_cost_usd ?? existingMetrics.totalCostUsd,
      durationMs: data.cost?.total_duration_ms ?? existingMetrics.durationMs,
      modelDisplayName: modelDisplayName ?? existingMetrics.modelDisplayName,
      // Inspector cache (git-based); falls back to previous value while the
      // cache warms up on first poll so the chip doesn't flicker to 0.
      linesAdded: lineCounts.linesAdded,
      linesRemoved: lineCounts.linesRemoved
    }

    this.sessionRegistry.updatePaneMetrics(paneId, updatedMetrics)

    // Emit pane:metrics IPC to the renderer (serialize Map → Record for toolsUsed)
    const win = this.windowManager.getWindow(pane.windowId)
    if (!win || win.isDestroyed()) return

    const payload: PaneMetricsPayload = { paneId, metrics: metricsToIpc(updatedMetrics) }
    win.webContents.send(IPC.PANE_METRICS, payload)

    // Broadcast rate limits to all windows if changed (PE-01)
    this.broadcastRateLimitsIfChanged(data)
  }

  /**
   * Extract rate_limits from statusline data and broadcast to all windows
   * if the values have changed. Rate limits are account-global, so we emit
   * to every window, not just the pane's window.
   */
  private broadcastRateLimitsIfChanged(data: StatuslineJson): void {
    if (!data.rate_limits) {
      // [rate-limits-debug] temporary — Claude Code didn't include rate_limits
      console.log('[metrics-collector] broadcast skipped: no rate_limits in payload')
      return
    }

    const fiveHour = this.extractRateLimitWindow(data.rate_limits['five_hour'])
    const sevenDay = this.extractRateLimitWindow(data.rate_limits['seven_day'])

    // Skip if both are null (no data)
    if (!fiveHour && !sevenDay) {
      // [rate-limits-debug] temporary — extractor returned null for both windows
      console.log(
        '[metrics-collector] broadcast skipped: both windows null',
        'rawKeys=' + Object.keys(data.rate_limits).join(',')
      )
      return
    }

    const rateLimitsPayload: RateLimitsPayload = { fiveHour, sevenDay }
    const json = JSON.stringify(rateLimitsPayload)

    // Deduplicate — only broadcast when values actually changed
    if (json === this.lastRateLimitsJson) {
      // [rate-limits-debug] temporary — payload identical to last broadcast
      console.log('[metrics-collector] broadcast skipped: unchanged')
      return
    }
    this.lastRateLimitsJson = json

    // Broadcast to all windows (rate limits are account-level, not per-pane)
    let sentTo = 0
    for (const [, win] of this.windowManager.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.RATE_LIMITS_UPDATE, rateLimitsPayload)
        sentTo += 1
      }
    }
    // [rate-limits-debug] temporary — confirms IPC send fan-out
    console.log(
      '[metrics-collector] broadcast sent',
      'fiveHour=' + (fiveHour ? fiveHour.usedPercentage + '%' : 'null'),
      'sevenDay=' + (sevenDay ? sevenDay.usedPercentage + '%' : 'null'),
      'windows=' + sentTo
    )
  }

  private extractRateLimitWindow(
    raw: { used_percentage?: number; resets_at?: string | number } | undefined
  ): RateLimitWindow | null {
    if (!raw || raw.used_percentage === undefined || raw.resets_at === undefined) return null
    // resets_at may be a Unix timestamp (number) or ISO string — normalize to ISO
    const resetsAt =
      typeof raw.resets_at === 'number'
        ? new Date(raw.resets_at * 1000).toISOString()
        : raw.resets_at
    return { usedPercentage: raw.used_percentage, resetsAt }
  }

  // ---------------------------------------------------------------------------
  // Private — async JSONL transcript parsing (B-037)
  // ---------------------------------------------------------------------------

  private async parseTranscriptAsync(paneId: string, transcriptPath: string): Promise<void> {
    let raw: string
    try {
      raw = await fs.promises.readFile(transcriptPath, 'utf8')
    } catch {
      // File doesn't exist yet or can't be read — not an error
      return
    }

    const lines = raw.split('\n').filter((l) => l.trim().length > 0)

    let totalInputTokens = 0
    let totalOutputTokens = 0
    let latestUsage: JsonlEntry['message'] | null = null
    let latestModelId: string | null = null
    let sessionTitle: string | null = null
    const toolCounts: ToolUsageSummary = new Map()

    for (const line of lines) {
      let entry: JsonlEntry
      try {
        entry = JSON.parse(line) as JsonlEntry
      } catch {
        // Skip malformed lines
        continue
      }

      // Skip sidechain and error entries
      if (entry.isSidechain || entry.isApiErrorMessage) continue

      // Extract AI-generated session title (PE-04)
      if (entry.type === 'custom-title' && entry.customTitle) {
        sessionTitle = entry.customTitle
      }

      // Count tool usage
      if (entry.tool_name) {
        toolCounts.set(entry.tool_name, (toolCounts.get(entry.tool_name) ?? 0) + 1)
      }

      // Accumulate tokens from assistant message entries
      if (entry.type === 'assistant' && entry.message?.usage) {
        const usage = entry.message.usage
        totalInputTokens += usage.input_tokens ?? 0
        totalOutputTokens += usage.output_tokens ?? 0
        latestUsage = entry.message
      }

      // Track model id for context % fallback (if available in entry)
      if (typeof (entry as Record<string, unknown>)['model'] === 'string') {
        latestModelId = (entry as Record<string, unknown>)['model'] as string
      }
    }

    const totalTokens = totalInputTokens + totalOutputTokens || null

    // Context %: prefer statusline's pre-calculated value; fall back to JSONL calculation
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return

    let contextPercent: number | null = pane.metrics.contextPercent

    if (contextPercent === null && latestUsage?.usage) {
      // Manual fallback: sum all token types from the last entry / effective context window
      const usage = latestUsage.usage
      const totalUsed =
        (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)

      const modelId = latestModelId ?? ''
      // Prefer statusline-reported context window size (PE-02), fall back to hardcoded map
      const contextMax = pane.contextWindowSize ?? getModelContextWindow(modelId)
      const effectiveMax = contextMax - AUTO_COMPACT_BUFFER_TOKENS
      contextPercent = Math.min(100, Math.round((totalUsed / effectiveMax) * 100))
    }

    // Merge JSONL-derived data with existing metrics (preserve statusline fields)
    const existingMetrics = pane.metrics
    const lineCounts = this.pickLineCounts(paneId, existingMetrics)
    const updatedMetrics: PaneMetrics = {
      // JSONL-derived
      totalTokens: totalTokens ?? existingMetrics.totalTokens,
      toolsUsed: toolCounts.size > 0 ? toolCounts : existingMetrics.toolsUsed,
      contextPercent: contextPercent ?? existingMetrics.contextPercent,
      sessionTitle: sessionTitle ?? existingMetrics.sessionTitle,
      // Statusline-derived (preserved)
      totalCostUsd: existingMetrics.totalCostUsd,
      durationMs: existingMetrics.durationMs,
      modelDisplayName: existingMetrics.modelDisplayName,
      // Inspector cache (git-based) — same source as applyStatuslineData.
      linesAdded: lineCounts.linesAdded,
      linesRemoved: lineCounts.linesRemoved
    }

    this.sessionRegistry.updatePaneMetrics(paneId, updatedMetrics)

    // Emit pane:metrics IPC
    const win = this.windowManager.getWindow(pane.windowId)
    if (!win || win.isDestroyed()) return

    const metricsPayload: PaneMetricsPayload = { paneId, metrics: metricsToIpc(updatedMetrics) }
    win.webContents.send(IPC.PANE_METRICS, metricsPayload)
  }

  // ---------------------------------------------------------------------------
  // Private — diff-source overlay
  // ---------------------------------------------------------------------------

  /**
   * Resolve the authoritative `linesAdded`/`linesRemoved` for a pane.
   * Preference order: inspector's git-based cache → previously emitted values
   * (so the chip doesn't flicker to 0 before the first inspector poll) → 0.
   * Deliberately ignores Claude Code's statusline `cost.total_lines_added/
   * removed` — those are Claude's self-reported session counters, which
   * diverge from git's "what would merge" view (L-032).
   */
  private pickLineCounts(
    paneId: string,
    existingMetrics: PaneMetrics
  ): { linesAdded: number | null; linesRemoved: number | null } {
    const fromInspector = this.inspector?.getDiffStats(paneId)
    if (fromInspector) {
      return {
        linesAdded: fromInspector.linesAdded,
        linesRemoved: fromInspector.linesRemoved
      }
    }
    return {
      linesAdded: existingMetrics.linesAdded,
      linesRemoved: existingMetrics.linesRemoved
    }
  }

  /**
   * Re-emit a pane's current metrics with the inspector's latest diff cache
   * values overlaid. Called by InspectorService after `refreshPaneDiff`
   * updates its cache — keeps the per-pane card chip in sync with the repo
   * rail without needing the statusline to tick.
   */
  reemitWithInspectorDiff(paneId: string): void {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return
    const lineCounts = this.pickLineCounts(paneId, pane.metrics)
    const updatedMetrics: PaneMetrics = {
      ...pane.metrics,
      linesAdded: lineCounts.linesAdded,
      linesRemoved: lineCounts.linesRemoved
    }
    this.sessionRegistry.updatePaneMetrics(paneId, updatedMetrics)
    const win = this.windowManager.getWindow(pane.windowId)
    if (!win || win.isDestroyed()) return
    const payload: PaneMetricsPayload = { paneId, metrics: metricsToIpc(updatedMetrics) }
    win.webContents.send(IPC.PANE_METRICS, payload)
  }
}
