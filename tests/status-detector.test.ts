/**
 * StatusDetector unit tests.
 *
 * Tests timer behaviour (fake timers), pure-function classify/stripAnsi via
 * the onData public surface, and fallback lifecycle management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PaneState } from '../src/shared/types'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('../src/main/analytics/error-instrumentation', () => ({
  trackFallbackActivated: vi.fn()
}))

import { StatusDetector } from '../src/main/status-detector'
import { trackFallbackActivated } from '../src/main/analytics/error-instrumentation'
import { createMockRegistry } from './helpers/mock-registry'
import { createMockWindowManager } from './helpers/mock-window-manager'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics() {
  return {
    totalTokens: null,
    contextPercent: null,
    toolsUsed: null,
    totalCostUsd: null,
    durationMs: null,
    modelDisplayName: null,
    linesAdded: null,
    linesRemoved: null,
    sessionTitle: null
  }
}

function makePaneState(overrides: Partial<PaneState> = {}): PaneState {
  return {
    id: 'pane-1',
    windowId: 'win-1',
    workspaceId: 'workspace-1',
    ptyId: 'pty-1',
    sessionId: null,
    transcriptPath: null,
    contextWindowSize: null,
    repoName: 'repo',
    worktreeName: 'main',
    worktreePath: '/path',
    status: 'awaiting-prompt',
    activeToolName: null,
    statusChangedAt: 0,
    statusSource: 'hook',
    isFocused: false,
    hasUnseenStatusChange: false,
    isApiBilling: false,
    effort: 'medium',
    model: 'opus',
    metrics: makeMetrics(),
    createdAt: 0,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

describe('StatusDetector', () => {
  let registry: ReturnType<typeof createMockRegistry>
  let windowManager: ReturnType<typeof createMockWindowManager>
  let detector: StatusDetector

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    registry = createMockRegistry()
    windowManager = createMockWindowManager()
    detector = new StatusDetector(
      registry as unknown as import('../src/main/session-registry').SessionRegistry,
      windowManager as unknown as import('../src/main/window-manager').WindowManager
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Fallback timer lifecycle
  // -------------------------------------------------------------------------

  describe('registerPane — fallback timer', () => {
    it('starts 30s timer; before 30s full fallback is not active but awaiting→working detection works', () => {
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1', status: 'awaiting-prompt' }))
      detector.registerPane('pane-1')

      // The detector requires the prompt to be seen at least once before it
      // trusts non-prompt output as a "working" signal — otherwise startup
      // banner text would false-positive (commit 688b0ea). So feed the prompt
      // first, then real working output.
      detector.onData('pane-1', '\n> ')
      expect(registry.updatePaneStatus).not.toHaveBeenCalled()

      // Now non-prompt output after a seen prompt → working transition
      detector.onData('pane-1', 'some output')
      expect(registry.updatePaneStatus).toHaveBeenCalledWith('pane-1', 'working', 'pty-fallback', null)
    })

    it('starts 30s timer; before 30s onData is a no-op for already-working panes', () => {
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1', status: 'working' }))
      detector.registerPane('pane-1')

      detector.onData('pane-1', 'some output')
      expect(registry.updatePaneStatus).not.toHaveBeenCalled()
    })

    it('fires activateFallback after 30s', () => {
      detector.registerPane('pane-1')

      vi.advanceTimersByTime(30_000)

      expect(vi.mocked(trackFallbackActivated)).toHaveBeenCalledOnce()
    })

    it('onData is processed after the 30s timer fires', () => {
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1' }))
      detector.registerPane('pane-1')

      vi.advanceTimersByTime(30_000)

      detector.onData('pane-1', 'some output')

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'working',
        'pty-fallback',
        null
      )
    })

    it('socketFailed=true activates fallback immediately without a timer', () => {
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1' }))
      detector.registerPane('pane-1', true)

      // No timer needed — should be active immediately
      detector.onData('pane-1', 'some output')

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'working',
        'pty-fallback',
        null
      )
      // trackFallbackActivated is not called for socket-failed path
      expect(vi.mocked(trackFallbackActivated)).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // cancelFallbackTimer
  // -------------------------------------------------------------------------

  describe('cancelFallbackTimer', () => {
    it('cancelling the timer prevents fallback activation', () => {
      // Use 'working' status so the awaiting→working early detection doesn't trigger
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1', status: 'working' }))
      detector.registerPane('pane-1')
      detector.cancelFallbackTimer('pane-1')

      vi.advanceTimersByTime(30_000)

      expect(vi.mocked(trackFallbackActivated)).not.toHaveBeenCalled()
      // Full fallback onData remains a no-op (not active)
      detector.onData('pane-1', 'some output')
      expect(registry.updatePaneStatus).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // deregisterPane
  // -------------------------------------------------------------------------

  describe('deregisterPane', () => {
    it('cleans up timer so fallback never activates', () => {
      detector.registerPane('pane-1')
      detector.deregisterPane('pane-1')

      vi.advanceTimersByTime(30_000)

      expect(vi.mocked(trackFallbackActivated)).not.toHaveBeenCalled()
    })

    it('cleans up debounce timer and pane entry', () => {
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1' }))
      detector.registerPane('pane-1', true) // immediate activation

      detector.onData('pane-1', 'data')
      detector.deregisterPane('pane-1')

      // onData for deregistered pane is a no-op
      detector.onData('pane-1', 'more data')
      vi.advanceTimersByTime(600)

      // Only the first onData's immediate 'working' emit is expected
      const calls = vi.mocked(registry.updatePaneStatus).mock.calls
      expect(calls.every((c) => c[0] === 'pane-1' && c[1] === 'working')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // onData — debounce and classification (tests classify and stripAnsi indirectly)
  // -------------------------------------------------------------------------

  describe('onData', () => {
    beforeEach(() => {
      // Immediate fallback for all onData tests
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1', status: 'awaiting-prompt' }))
      detector.registerPane('pane-1', true)
    })

    it('emits working immediately on first data chunk', () => {
      detector.onData('pane-1', 'processing...')

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'working',
        'pty-fallback',
        null
      )
    })

    it('emits inferred status after 500ms silence (classify: done pattern)', () => {
      detector.onData('pane-1', 'Total cost: $0.02')

      vi.advanceTimersByTime(500)

      const calls = vi.mocked(registry.updatePaneStatus).mock.calls
      expect(calls[0][1]).toBe('working') // immediate
      expect(calls[1][1]).toBe('done') // after silence
    })

    it('emits needs-input for permission prompt pattern after 500ms', () => {
      detector.onData('pane-1', 'Allow bash command? [y/n]')

      vi.advanceTimersByTime(500)

      const calls = vi.mocked(registry.updatePaneStatus).mock.calls
      expect(calls[calls.length - 1][1]).toBe('needs-input')
    })

    it('emits awaiting-prompt for bare > prompt after 500ms', () => {
      // Override initial status to 'done' so the 'awaiting-prompt' classify result
      // is a real status change (dedup check: pane.status !== newStatus)
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1', status: 'done' }))

      detector.onData('pane-1', 'some output\n>')

      vi.advanceTimersByTime(500)

      const calls = vi.mocked(registry.updatePaneStatus).mock.calls
      expect(calls[calls.length - 1][1]).toBe('awaiting-prompt')
    })

    it('emits working as default when no pattern matches', () => {
      // A second onData call — pane.status is still 'awaiting-prompt' in the mock,
      // so 'working' will be emitted again on the immediate path
      detector.onData('pane-1', 'no recognisable pattern here xyzzy')

      vi.advanceTimersByTime(500)

      const calls = vi.mocked(registry.updatePaneStatus).mock.calls
      // Both immediate and debounced should be 'working'
      expect(calls[0][1]).toBe('working')
      expect(calls[1][1]).toBe('working')
    })

    it('resets debounce on second data chunk — only one final emit', () => {
      detector.onData('pane-1', 'first')
      vi.advanceTimersByTime(300)

      detector.onData('pane-1', 'Total cost: $0.02') // reset timer
      vi.advanceTimersByTime(499) // 499ms since second — no final emit yet

      const callsAt499 = vi.mocked(registry.updatePaneStatus).mock.calls.length

      vi.advanceTimersByTime(1) // 500ms since second — timer fires

      const callsAt500 = vi.mocked(registry.updatePaneStatus).mock.calls.length
      expect(callsAt500).toBeGreaterThan(callsAt499) // one more call (final status)

      const lastCall = vi.mocked(registry.updatePaneStatus).mock.calls.at(-1)
      expect(lastCall?.[1]).toBe('done')
    })

    it('strips ANSI codes before pattern matching', () => {
      // Wrap a 'done' pattern in ANSI colour codes
      const ansiWrapped = '\x1b[32mTotal cost:\x1b[0m $0.05'
      detector.onData('pane-1', ansiWrapped)

      vi.advanceTimersByTime(500)

      const calls = vi.mocked(registry.updatePaneStatus).mock.calls
      expect(calls.at(-1)?.[1]).toBe('done')
    })

    it('no-op when pane not registered', () => {
      detector.onData('unregistered-pane', 'data')

      expect(registry.updatePaneStatus).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getLastOutput — rolling tail used by HookListener Stop classifier
  // -------------------------------------------------------------------------

  describe('getLastOutput', () => {
    it('returns null for unknown panes and panes with no data yet', () => {
      expect(detector.getLastOutput('never-registered')).toBeNull()
      detector.registerPane('pane-1')
      expect(detector.getLastOutput('pane-1')).toBeNull()
    })

    it('accumulates across multiple onData chunks (not just the most recent frame)', () => {
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1' }))
      detector.registerPane('pane-1')

      // Frame 1: agent's question. Frame 2: ink redraw of the input box that
      // would clobber a single-frame `lastChunk` view. The classifier needs
      // both, so the question text from frame 1 must still be visible.
      detector.onData('pane-1', 'Should I delete X?\n')
      detector.onData('pane-1', '\x1b[H\x1b[2J❯ ')

      const out = detector.getLastOutput('pane-1')
      expect(out).not.toBeNull()
      expect(out!).toContain('Should I delete X?')
    })

    it('returns ANSI-stripped text (no escape bytes leak through)', () => {
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1' }))
      detector.registerPane('pane-1')

      detector.onData('pane-1', '\x1b[31mred\x1b[0m and \x1b[1mbold\x1b[0m')

      const out = detector.getLastOutput('pane-1')
      expect(out).not.toBeNull()
      expect(out!).not.toMatch(/\x1b\[/)
      expect(out!).toContain('red and bold')
    })
  })

  // -------------------------------------------------------------------------
  // Plan-mode detection (Phase: Kanban polish)
  // -------------------------------------------------------------------------

  describe('plan-mode detection', () => {
    let sendSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      detector.registerPane('pane-1')
      const pane = makePaneState({ id: 'pane-1' })
      vi.mocked(registry.getPane).mockReturnValue(pane)
      sendSpy = vi.fn()
      vi.mocked(windowManager.getWindow).mockReturnValue({
        isDestroyed: () => false,
        webContents: { send: sendSpy }
      } as unknown as import('electron').BrowserWindow)
      // Default: registry reports "mode actually changed" on first call, and
      // not again thereafter. The per-test code overrides when needed.
      vi.mocked(registry.updatePanePermissionMode).mockImplementation(() => true)
    })

    it('flips to plan when the mode-footer says "plan mode on"', () => {
      // Icon prefix is irrelevant — the mode word is the source of truth.
      detector.onData('pane-1', '⏸ plan mode on (shift+tab to cycle)\n')

      expect(registry.updatePanePermissionMode).toHaveBeenCalledWith('pane-1', 'plan')
      expect(sendSpy).toHaveBeenCalledWith(
        'pane:permission-mode',
        { paneId: 'pane-1', permissionMode: 'plan' }
      )
    })

    it('flips to normal when the mode-footer says "auto mode on" (the field bug)', () => {
      // Step 1: enter plan mode.
      detector.onData('pane-1', '⏸ plan mode on (shift+tab to cycle)\n')
      expect(registry.updatePanePermissionMode).toHaveBeenLastCalledWith('pane-1', 'plan')

      // Step 2: user accepts the plan, Claude switches to auto-edit mode.
      // The historical "plan mode on" line is STILL in the rolling buffer,
      // but the most recent footer says "auto mode on" — so the most-recent
      // -wins logic flips us to 'normal'. This is the bug from round 3
      // screenshots where the chip stayed stuck on PLANNING.
      detector.onData('pane-1', '⏵⏵ auto mode on (shift+tab to cycle)\n')
      expect(registry.updatePanePermissionMode).toHaveBeenLastCalledWith('pane-1', 'normal')
    })

    it('also flips to normal on "accept edits on" (alternate auto-mode label)', () => {
      detector.onData('pane-1', '⏸ plan mode on (shift+tab to cycle)\n')
      detector.onData('pane-1', '⏸ accept edits on (shift+tab to cycle)\n')
      expect(registry.updatePanePermissionMode).toHaveBeenLastCalledWith('pane-1', 'normal')
    })

    it('most-recent footer wins when several footers accumulate in the buffer', () => {
      detector.onData('pane-1', '⏸ plan mode on (shift+tab to cycle)\n')
      detector.onData('pane-1', 'some unrelated output\n')
      detector.onData('pane-1', '⏵⏵ auto mode on (shift+tab to cycle)\n')

      expect(registry.updatePanePermissionMode).toHaveBeenLastCalledWith('pane-1', 'normal')
    })

    // -----------------------------------------------------------------------
    // ink renders the input-box footer one glyph at a time with cursor-
    // positioning escapes between glyphs. After stripAnsi those escapes
    // collapse to nothing, so "plan mode on (shift+tab to cycle)" becomes
    // "planmodeon (shift+tabtocycle)" in the rolling buffer. Tests below
    // mirror what we observed live in the [plan-mode debug] field log.
    // -----------------------------------------------------------------------

    it('flips to plan on spaceless ink rendering ("planmodeon (shift+tabtocycle)")', () => {
      detector.onData('pane-1', '⏸planmodeon (shift+tabtocycle)\n')
      expect(registry.updatePanePermissionMode).toHaveBeenCalledWith('pane-1', 'plan')
    })

    it('flips to normal on spaceless ink rendering ("automodeon (shift+tabtocycle)")', () => {
      detector.onData('pane-1', '⏵⏵automodeon (shift+tabtocycle)\n')
      expect(registry.updatePanePermissionMode).toHaveBeenCalledWith('pane-1', 'normal')
    })

    it('most-recent wins across spaceless footers (the round-4 field bug)', () => {
      // The exact failure mode from the user's logs: chip flipped to PLAN on
      // the first paint, then the rolling buffer kept seeing the spaceless
      // "planmodeon" text without ever seeing a clear "auto mode on" — so the
      // chip stayed PLAN long enough for the Stop hook to fire and route the
      // pane into Needs Input. With spaceless tolerance the most-recent
      // "automodeon" in the buffer flips us to 'normal' immediately.
      detector.onData('pane-1', '⏸planmodeon (shift+tabtocycle)\n')
      expect(registry.updatePanePermissionMode).toHaveBeenLastCalledWith('pane-1', 'plan')

      detector.onData('pane-1', 'still thinking with high effort\n'.repeat(20))
      detector.onData('pane-1', '⏵⏵automodeon (shift+tabtocycle)\n')
      expect(registry.updatePanePermissionMode).toHaveBeenLastCalledWith('pane-1', 'normal')
    })

    it('falls back to the "Enabled plan mode" message when no footer has appeared yet', () => {
      // Brief window after toggle-on: the transcript contains "Enabled plan
      // mode" but the input box hasn't repainted, so no mode-footer is in
      // the buffer.
      detector.onData('pane-1', '| Enabled plan mode\n')
      expect(registry.updatePanePermissionMode).toHaveBeenCalledWith('pane-1', 'plan')
    })

    it('leaves mode unchanged on tiny ambiguous chunks (single keystroke echo)', () => {
      detector.onData('pane-1', 'a')
      expect(registry.updatePanePermissionMode).not.toHaveBeenCalled()
    })

    it('does not broadcast when updatePanePermissionMode reports no change', () => {
      vi.mocked(registry.updatePanePermissionMode).mockImplementation(() => false)
      detector.onData('pane-1', '⏸ plan mode on (shift+tab to cycle)\n')
      expect(sendSpy).not.toHaveBeenCalled()
    })

    it('strips ANSI codes before matching the mode footer', () => {
      const ansiWrapped =
        '\x1b[2m⏸ plan mode on (shift+tab to cycle)\x1b[0m'
      detector.onData('pane-1', ansiWrapped)

      expect(registry.updatePanePermissionMode).toHaveBeenCalledWith('pane-1', 'plan')
    })

    it('does NOT eat lowercase letters adjacent to a stray ESC byte (regression)', () => {
      // Field bug: Claude Code's footer arrived as bytes that included a
      // stray `\x1b` immediately before the `t` of `to`. The old stripAnsi
      // regex `\x1b[A-Za-z]` matched `\x1bt` and discarded both characters.
      const buggyChunk =
        '⏸ plan mode on (shift+tab \x1bto cycle)\r\n'
      detector.onData('pane-1', buggyChunk)

      expect(registry.updatePanePermissionMode).toHaveBeenCalledWith('pane-1', 'plan')
    })

    it('matches across chunk boundaries via the rolling buffer', () => {
      detector.onData('pane-1', 'preamble. ⏸ plan mode on (shift')
      // First chunk's footer is incomplete — no closing `+tab` yet.
      expect(registry.updatePanePermissionMode).not.toHaveBeenCalled()

      detector.onData('pane-1', '+tab to cycle)\n')
      // Second chunk completes the line; rolling buffer scan now matches.
      expect(registry.updatePanePermissionMode).toHaveBeenCalledWith('pane-1', 'plan')
    })

    it('logs one transition line per flip with the captured mode word', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        detector.onData('pane-1', '⏸ plan mode on (shift+tab to cycle)\n')
        // Same state should not log again (registry returns false the second time).
        vi.mocked(registry.updatePanePermissionMode).mockImplementationOnce(() => false)
        detector.onData('pane-1', 'unrelated output\n')

        const planLogs = logSpy.mock.calls
          .map((c) => String(c[0] ?? ''))
          .filter((s) => s.startsWith('[plan-mode]'))
        expect(planLogs).toHaveLength(1)
        expect(planLogs[0]).toMatch(/pane pane-1 → plan/)
        expect(planLogs[0]).toMatch(/matched: footer-mode/)
        expect(planLogs[0]).toMatch(/mode="plan"/)
      } finally {
        logSpy.mockRestore()
      }
    })

    it('throttled debug log fires when buffer mentions "plan" but no canonical match (diagnostic)', () => {
      // Useful safety net: if this round's hypothesis is wrong, the next
      // failure surfaces real bytes instead of silent miss.
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        // Bytes contain "plan" but no `<word> on (shift+tab` pattern.
        detector.onData('pane-1', 'I have a plan that is not in the canonical mode-footer format.\n')

        const debugLogs = logSpy.mock.calls
          .map((c) => String(c[0] ?? ''))
          .filter((s) => s.startsWith('[plan-mode debug]'))
        expect(debugLogs).toHaveLength(1)
        expect(debugLogs[0]).toMatch(/pane pane-1 no canonical match/)
        expect(debugLogs[0]).toMatch(/tail=/)
      } finally {
        logSpy.mockRestore()
      }
    })
  })
})
