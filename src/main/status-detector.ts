import { IPC } from '../shared/ipc-channels'
import type { PaneStatusPayload, PanePermissionModePayload } from '../shared/ipc-channels'
import type { PaneStatus } from '../shared/types'
import type { SessionRegistry } from './session-registry'
import type { WindowManager } from './window-manager'
import type { WorkspaceManager } from './workspace-manager'
import { CLAUDE_PATTERNS } from './claude-patterns'
import { PTY_SILENCE_DEBOUNCE_MS, HOOK_FALLBACK_ACTIVATION_MS } from './constants'
import { trackFallbackActivated } from './analytics/error-instrumentation'
// stripAnsi lives in src/shared so the renderer-side spawn-overlay detector
// can reuse the same logic (both need to look at "what the user sees" rather
// than raw bytes — markers can hide inside OSC title-set sequences).
import { stripAnsi } from '../shared/strip-ansi'

// ---------------------------------------------------------------------------
// Internal state per pane
// ---------------------------------------------------------------------------

interface PaneEntry {
  /** Most recent PTY data chunk, used for classification after silence */
  lastChunk: string
  /** Pending debounce timer; null when no data has arrived recently */
  debounceTimer: ReturnType<typeof setTimeout> | null
  /**
   * Whether fallback is active for this pane. Starts false; set to true by
   * activateFallback() when the 30s hook-timeout fires (B-054).
   */
  isActive: boolean
  /**
   * 30s timer started at spawn time. Fires activateFallback() unless cancelled
   * by cancelFallbackTimer() when the first hook event arrives (B-054).
   */
  fallbackTimer: ReturnType<typeof setTimeout> | null
  /**
   * Whether the Claude Code prompt (> or ❯) has been seen at least once.
   * Used to gate the awaiting-prompt → working PTY bridge: startup banner
   * text is non-prompt output but does NOT mean Claude is working. Only after
   * the prompt has appeared do we know that subsequent non-prompt output
   * means the user submitted something and Claude is actively working.
   */
  promptSeen: boolean
  /**
   * Rolling tail of ANSI-stripped PTY output, capped at PLAN_MODE_BUFFER_BYTES.
   * Two consumers:
   *   - `detectPermissionMode` (this file) — needs accumulation because ink
   *     fragments mode-footer text via cursor-positioning between glyphs.
   *   - `getLastOutput` → HookListener Stop classifier — needs accumulation
   *     because ink overwrites the visible question with input-box redraws,
   *     so the literal last `onData` chunk is just the prompt redraw.
   */
  recentStripped: string
}

/** Rolling-buffer size for plan-mode detection. ~16KB ≈ 250 lines of output. */
const PLAN_MODE_BUFFER_BYTES = 16384

/**
 * Plan-mode signals printed by Claude Code:
 *   - On enter: a one-shot `Enabled plan mode` message in the transcript.
 *   - While active: a `plan mode on (shift+tab to cycle)` footer that lives
 *     under the input box and is repainted on every input-box update.
 *   - On exit: `Disabled plan mode` (or `Exited plan mode` in some builds).
 *
 * The transition messages are the authoritative signal. The footer is a
 * positive-sticky fallback so resumed sessions (where the transition message
 * scrolled off long ago) still pick up the badge once Claude renders the
 * input box at rest.
 *
 * IMPORTANT: footer ABSENCE is NOT evidence of exit — long tool-output
 * chunks routinely scroll the footer out of the most recent chunk while
 * plan mode is still active. We only flip to 'normal' on an explicit
 * disabled/exited message.
 *
 * Permissive whitespace gap: ink (Claude Code's TUI library) re-renders the
 * screen by emitting ANSI cursor-position sequences between glyphs. After
 * stripping ANSI, what was visually `Enabled plan mode` may show up as
 * `Enabledplanmode`, `Enabled  plan mode`, or with a stray non-breaking
 * space. `[\s ]{0,3}` between word fragments tolerates all these
 * variants while keeping the match anchored enough to avoid false positives.
 */
// Mode-footer scan, tolerant of ink's spaceless rendering. Captures one of a
// known set of mode keywords ("plan", "auto", "accept edits", "default",
// "ask") before "on (shift+tab to cycle)". The trailing "mode" word and the
// surrounding whitespace are all optional because ink renders the input-box
// footer one glyph at a time with cursor-positioning escapes between glyphs:
// after stripAnsi, "plan mode on (shift+tab to cycle)" collapses to
// "planmodeon (shift+tabtocycle)". The `on (shift+tab` anchor stays — it's
// specific enough to avoid false positives on body text. Most-recent match
// in the rolling buffer wins (icons like ⏸/⏵⏵ are irrelevant; the word is
// the source of truth). Whichever word matches: contains "plan" → 'plan',
// otherwise → 'normal'.
const MODE_FOOTER =
  /(plan|auto|accept(?:[\s ]*edits?)?|default|ask)(?:[\s ]*mode)?[\s ]*on[\s ]*\(shift[\s ]*\+?[\s ]*tab/gi
const PLAN_MODE_ENABLED_MSG = /Enabled.{0,8}plan.{0,8}mode/is

// Diagnostic-only: a very loose substring check for "plan" in the buffer.
// Used solely to log "we saw plan-related text but no canonical match
// fired" so a future failure surfaces actual buffer content instead of
// silent miss.
const PLAN_MODE_LOOSE_HINT = /plan/i

// ---------------------------------------------------------------------------
// StatusDetector
// ---------------------------------------------------------------------------

/**
 * StatusDetector — PTY regex-based fallback status detection (PRD F6).
 *
 * When hook-based detection is unavailable (no hooks received within 30s of
 * spawn), this detector subscribes to PTY data and uses a debounce + regex
 * approach to infer pane status from terminal output.
 *
 * Lifecycle:
 *   1. registerPane(paneId)    — called at spawn time
 *   2. activateFallback(id)   — called by B-054 after 30s with no hooks
 *   3. onData(paneId, data)   — called for each PTY data chunk while active
 *   4. deregisterPane(id)     — called on pane close
 *
 * When active:
 *   - Each PTY data arrival: immediately emit 'working' (if not already),
 *     reset 500ms silence debounce.
 *   - After 500ms silence: classify last chunk against claude-patterns.ts
 *     and emit the inferred status.
 *
 * In fallback mode, activeToolName is always null and toolsUsed is not
 * populated (hook events are not available).
 */
export class StatusDetector {
  private readonly panes = new Map<string, PaneEntry>()
  /**
   * Throttle map for the plan-mode "no canonical match but buffer mentions
   * plan" diagnostic log. Keyed by paneId, value is timestamp of last log.
   */
  private readonly lastDebugLogAt = new Map<string, number>()
  /**
   * Throttle map for the awaiting → working bridge promotion log. Keyed by
   * paneId. One log line per pane per 5 s so a tool run that emits a long
   * stream of "Considering"-bearing chunks doesn't drown the console; the
   * first promotion is what's diagnostic anyway.
   */
  private readonly lastBridgeLogAt = new Map<string, number>()

  /**
   * Wired after construction (workspaceManager constructs after StatusDetector,
   * so the DI graph can't pass it in). Held nullable so unit tests don't have
   * to satisfy the dependency.
   */
  private workspaceManager: WorkspaceManager | null = null

  constructor(
    private readonly sessionRegistry: SessionRegistry,
    private readonly windowManager: WindowManager
  ) {}

  setWorkspaceManager(wm: WorkspaceManager): void {
    this.workspaceManager = wm
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Register a pane for potential fallback monitoring. Call at spawn time.
   *
   * If `socketFailed` is true, immediately activates PTY fallback (B-058:
   * the hook socket is broken, so no hook events will ever arrive).
   * Otherwise starts a 30s timer that fires activateFallback() if no hook
   * event arrives first (B-054).
   */
  registerPane(paneId: string, socketFailed = false): void {
    if (socketFailed) {
      // Socket is already broken — skip the timer, activate immediately (B-058)
      this.panes.set(paneId, {
        lastChunk: '',
        debounceTimer: null,
        isActive: true,
        fallbackTimer: null,
        promptSeen: false,
        recentStripped: ''
      })
      console.log('[status-detector] PTY fallback immediately active (socket failed) for pane', paneId)
      return
    }

    const fallbackTimer = setTimeout(() => {
      this.activateFallback(paneId)
    }, HOOK_FALLBACK_ACTIVATION_MS)

    this.panes.set(paneId, {
      lastChunk: '',
      debounceTimer: null,
      isActive: false,
      fallbackTimer,
      promptSeen: false,
      recentStripped: ''
    })
  }

  /**
   * Cancel the 30s fallback timer for a pane.
   * Called by HookListener when the first hook event is received — hooks are
   * working, so PTY fallback is not needed (B-054).
   */
  cancelFallbackTimer(paneId: string): void {
    const entry = this.panes.get(paneId)
    if (!entry || entry.fallbackTimer === null) return
    clearTimeout(entry.fallbackTimer)
    entry.fallbackTimer = null
  }

  /**
   * Activate PTY fallback detection for this pane.
   * Called internally when the 30s timer fires (B-054).
   */
  activateFallback(paneId: string): void {
    const entry = this.panes.get(paneId)
    if (!entry) return
    entry.fallbackTimer = null
    entry.isActive = true
    console.log('[status-detector] PTY fallback activated for pane', paneId)
    trackFallbackActivated()
  }

  /** Clean up all timers and entries for a pane. Call on pane close. */
  deregisterPane(paneId: string): void {
    const entry = this.panes.get(paneId)
    if (!entry) return
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer)
    }
    if (entry.fallbackTimer !== null) {
      clearTimeout(entry.fallbackTimer)
    }
    this.panes.delete(paneId)
    this.lastDebugLogAt.delete(paneId)
    this.lastBridgeLogAt.delete(paneId)
  }

  /**
   * Handle incoming PTY data for a pane.
   *
   * If fallback is active for this pane:
   *   - Emits 'working' immediately on data arrival (if not already working).
   *   - Resets the 500ms silence debounce.
   *   - After 500ms of silence, classifies and emits the inferred status.
   *
   * No-op when fallback is not active (hook-based detection is in use).
   */
  /**
   * Return a rolling tail of recent ANSI-stripped PTY output for a pane.
   * Used by HookListener to refine Stop → done/needs-input classification.
   *
   * Returns `recentStripped` (a 16KB rolling buffer appended on every
   * `onData`), NOT just the last PTY frame. Claude Code is an ink TUI: it
   * emits the question text in one frame and then re-renders the input box
   * in subsequent frames, so the literal last frame typically contains only
   * cursor positioning + the prompt and is useless for question detection.
   */
  getLastOutput(paneId: string): string | null {
    const entry = this.panes.get(paneId)
    if (!entry || entry.recentStripped.length === 0) return null
    return entry.recentStripped
  }

  onData(paneId: string, data: string): void {
    const entry = this.panes.get(paneId)
    if (!entry) return

    // Always buffer last chunk (even when fallback is inactive) so
    // HookListener can consult it for Stop-event refinement.
    entry.lastChunk = data

    // Track Claude Code permission mode from the footer Claude Code prints
    // under the input box while plan mode is active:
    //     `plan mode on (shift+tab to cycle)`
    // See `detectPermissionMode` — only broadcasts on transitions.
    this.detectPermissionMode(paneId, data)

    if (!entry.isActive) {
      // Even with hooks as primary, detect awaiting-prompt → working transition
      // from PTY output as defense-in-depth. The hook map already covers the
      // user-submits case via `UserPromptSubmit: 'working'` (hook-listener.ts);
      // this bridge only needs to fire when a positive thinking/tool indicator
      // shows up in the chunk. Promoting on "any non-prompt visible content"
      // is too loose — Claude Code's idle UI redraws (input-box repaints,
      // token/status footer, cursor positioning) routinely emit visible
      // characters at rest and would flip a brand-new pane to `working`
      // without the user ever submitting a prompt.
      const pane = this.sessionRegistry.getPane(paneId)
      if (pane && pane.status === 'awaiting-prompt') {
        const clean = stripAnsi(data)
        const isPrompt = CLAUDE_PATTERNS.awaitingPrompt.some((p) => p.test(clean))
        if (isPrompt) {
          // Mark that we've seen the prompt at least once. Gates the bridge
          // so startup banner text before the first prompt can't promote.
          entry.promptSeen = true
        } else if (entry.promptSeen) {
          const matched = CLAUDE_PATTERNS.workingHint.find((p) => p.test(clean))
          if (matched) {
            // Throttled diagnostic — exposes which pattern matched and a
            // chunk preview so a future "phantom working" report can be
            // diagnosed from the console rather than guessed at again
            // (L-051 — instrument the live path before iterating on the
            // heuristic). One line per pane per 5 s.
            const now = Date.now()
            const last = this.lastBridgeLogAt.get(paneId) ?? 0
            if (now - last > 5000) {
              this.lastBridgeLogAt.set(paneId, now)
              const preview = JSON.stringify(clean.slice(0, 200))
              console.log(
                `[status-detector] bridge → working pane=${paneId} pattern=${matched.source} chunk=${preview}`
              )
            }
            this.emitStatus(paneId, 'working')
          }
        }
      }
      return
    }

    // Reset debounce timer
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer)
    }

    // Immediately signal 'working' on any PTY activity
    this.emitStatus(paneId, 'working')

    // After silence, classify and emit inferred status
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null
      const status = this.classify(entry.lastChunk)
      this.emitStatus(paneId, status)
    }, PTY_SILENCE_DEBOUNCE_MS)
  }

  // ---------------------------------------------------------------------------
  // Private — classification and emission
  // ---------------------------------------------------------------------------

  private classify(chunk: string): PaneStatus {
    const clean = stripAnsi(chunk)

    for (const pattern of CLAUDE_PATTERNS.needsInput) {
      if (pattern.test(clean)) return 'needs-input'
    }

    // PTY fallback can't run a diff probe like the hook path does, so the
    // safe collapse for "Claude finished a turn" is `needs-input`. If the
    // poller later detects changes the tile gets the diff chip via
    // gitStatus. Routing to `changes-ready` here would be wrong when the
    // tree is clean.
    for (const pattern of CLAUDE_PATTERNS.done) {
      if (pattern.test(clean)) return 'needs-input'
    }

    for (const pattern of CLAUDE_PATTERNS.awaitingPrompt) {
      if (pattern.test(clean)) return 'awaiting-prompt'
    }

    return 'working'
  }

  /**
   * Update the pane's permissionMode from PTY output. Scans a 16KB rolling
   * buffer of stripped output for any mode-footer line of the form
   * `<word> [<word>] on (shift+tab to cycle)` — Claude Code prints exactly
   * this for the input-box mode indicator. Each mode has its own icon prefix
   * (`⏸` for plan, `⏵⏵` for auto, etc.), but the icons appear NOT to swap
   * when the active mode changes, so the icon prefix is unreliable. The mode
   * WORD itself is what we read.
   *
   * Logic:
   *   1. Find every `<word> ... on (shift+tab` occurrence in the buffer.
   *   2. Take the LAST match (most recent input-box re-render).
   *   3. If the captured mode word(s) contain "plan" → 'plan'; otherwise
   *      → 'normal' (auto, accept-edits, default, ask, …).
   *   4. If no mode-footer match yet (toggle just happened and the input box
   *      hasn't repainted), fall back to the one-shot "Enabled plan mode"
   *      transcript message.
   *
   * Broadcasts PANE_PERMISSION_MODE only on actual transitions and emits one
   * console line per transition for in-the-field diagnostics. A throttled
   * `[plan-mode debug]` line fires when the buffer mentions "plan" but no
   * canonical match landed — useful if this round's hypothesis is also
   * wrong, so we get the actual buffer tail without needing another round.
   */
  private detectPermissionMode(paneId: string, data: string): void {
    const entry = this.panes.get(paneId)
    if (!entry) return

    // Append the stripped form to the rolling buffer (ink fragments text via
    // cursor-positioning between glyphs, so a per-chunk scan misses signals
    // that are only contiguous after several chunks accumulate).
    const cleanChunk = stripAnsi(data)
    entry.recentStripped = (entry.recentStripped + cleanChunk).slice(-PLAN_MODE_BUFFER_BYTES)

    let next: 'normal' | 'plan' | null = null
    let matched: 'footer-mode' | 'enable-msg' | null = null
    let matchedMode: string | null = null

    // Most-recent mode-footer wins. matchAll is needed because the /g regex
    // is stateful otherwise; we want every occurrence in the buffer.
    MODE_FOOTER.lastIndex = 0
    const allMatches = [...entry.recentStripped.matchAll(MODE_FOOTER)]
    if (allMatches.length > 0) {
      const lastText = allMatches[allMatches.length - 1][1] ?? ''
      matchedMode = lastText
      next = /plan/i.test(lastText) ? 'plan' : 'normal'
      matched = 'footer-mode'
    } else if (PLAN_MODE_ENABLED_MSG.test(entry.recentStripped)) {
      // Fallback: footer hasn't been rendered yet but the one-shot enable
      // message is in the buffer.
      next = 'plan'
      matched = 'enable-msg'
    }

    if (next === null) {
      // Diagnostic: no canonical match but buffer mentions "plan". Throttle
      // to once every 5 s per pane so we don't spam the console while Claude
      // is generating output.
      if (PLAN_MODE_LOOSE_HINT.test(entry.recentStripped)) {
        const now = Date.now()
        const lastLogged = this.lastDebugLogAt.get(paneId) ?? 0
        if (now - lastLogged > 5000) {
          this.lastDebugLogAt.set(paneId, now)
          const tail = entry.recentStripped.slice(-300)
          console.log(`[plan-mode debug] pane ${paneId} no canonical match; tail=${JSON.stringify(tail)}`)
        }
      }
      return
    }

    const changed = this.sessionRegistry.updatePanePermissionMode(paneId, next)
    if (!changed) return

    const matchSuffix = matchedMode !== null
      ? `  (matched: ${matched}, mode="${matchedMode.trim()}")`
      : `  (matched: ${matched})`
    console.log(`[plan-mode] pane ${paneId} → ${next}${matchSuffix}`)

    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return
    const win = this.windowManager.getWindow(pane.windowId)
    if (!win || win.isDestroyed()) return
    const payload: PanePermissionModePayload = { paneId, permissionMode: next }
    win.webContents.send(IPC.PANE_PERMISSION_MODE, payload)
  }

  private emitStatus(paneId: string, newStatus: PaneStatus): void {
    const pane = this.sessionRegistry.getPane(paneId)
    if (!pane) return

    // Only emit on actual status change (PRD F6: emit only on changes)
    if (pane.status === newStatus) return

    const updated = this.sessionRegistry.updatePaneStatus(
      paneId,
      newStatus,
      'pty-fallback',
      null
    )
    if (!updated) return

    const win = this.windowManager.getWindow(pane.windowId)
    if (!win || win.isDestroyed()) return

    const payload: PaneStatusPayload = {
      paneId,
      status: newStatus,
      activeToolName: null,
      source: 'pty-fallback'
    }
    win.webContents.send(IPC.PANE_STATUS, payload)
    this.workspaceManager?.pushManagerUpdate()
  }
}
