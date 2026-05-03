/**
 * HookListener unit tests.
 *
 * Tests hook event → status mapping, transcript path extraction,
 * and transcript parsing triggers via the Unix domain socket interface.
 */

import net from 'net'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PaneState } from '../src/shared/types'
import { createMockRegistry } from './helpers/mock-registry'
import { createMockWindowManager } from './helpers/mock-window-manager'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/app') }
}))

vi.mock('../src/main/claude-patterns', async () => {
  // Override CLAUDE_PATTERNS.needsInput to keep Notification refinement
  // deterministic in this suite, but use the REAL classifyStopOutput /
  // STOP_CLASSIFIER so question-detection tests exercise production logic.
  const actual = await vi.importActual<typeof import('../src/main/claude-patterns')>(
    '../src/main/claude-patterns'
  )
  return {
    ...actual,
    CLAUDE_PATTERNS: { needsInput: [] }
  }
})

vi.mock('../src/main/git-status', () => ({
  getGitStatus: vi.fn()
}))

import { HookListener } from '../src/main/hook-listener'
import { getGitStatus } from '../src/main/git-status'

const mockGetGitStatus = vi.mocked(getGitStatus)

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
    sessionTitle: null,
    initialPrompt: null
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
    status: 'working',
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

/** Send a JSON payload over the socket and wait for it to be processed. */
function sendPayload(socketPath: string, payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(payload) + '\n')
      client.end()
    })
    client.on('close', () => {
      // Small delay to let the server process the message
      setTimeout(resolve, 20)
    })
    client.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HookListener', () => {
  let registry: ReturnType<typeof createMockRegistry>
  let windowManager: ReturnType<typeof createMockWindowManager>
  let metricsCollector: { parseTranscriptForPane: ReturnType<typeof vi.fn> }
  let listener: HookListener
  let socketPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    registry = createMockRegistry()
    windowManager = createMockWindowManager()
    metricsCollector = { parseTranscriptForPane: vi.fn() }

    const pane = makePaneState()
    registry.getPane.mockReturnValue(pane)
    registry.updatePaneStatus.mockReturnValue(true)

    listener = new HookListener(
      registry as unknown as Parameters<typeof HookListener extends new (...args: infer P) => unknown ? (...args: P) => void : never>[0],
      windowManager as unknown as Parameters<typeof HookListener extends new (...args: infer P) => unknown ? (...args: P) => void : never>[1],
      metricsCollector as unknown as Parameters<typeof HookListener extends new (...args: infer P) => unknown ? (...args: P) => void : never>[2]
    )
    socketPath = listener.getSocketPath()
    listener.start()

    // Wait for server to be ready
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  })

  afterEach(() => {
    listener.stop()
  })

  // -------------------------------------------------------------------------
  // UserPromptSubmit
  // -------------------------------------------------------------------------

  describe('UserPromptSubmit', () => {
    it('maps to working status when the pane was idle', async () => {
      // Pane starts in 'done' (post-Stop). User submits a new prompt — the
      // pill should flip to 'working' immediately, before any tool call.
      const pane = makePaneState({ status: 'done' })
      registry.getPane.mockReturnValue(pane)

      await sendPayload(socketPath, {
        hookEventName: 'UserPromptSubmit',
        paneId: 'pane-1'
      })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'working',
        'hook',
        null
      )
    })

    it('is a no-op when the pane is already working', async () => {
      const pane = makePaneState({ status: 'working' })
      registry.getPane.mockReturnValue(pane)

      await sendPayload(socketPath, {
        hookEventName: 'UserPromptSubmit',
        paneId: 'pane-1'
      })

      expect(registry.updatePaneStatus).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // StopFailure
  // -------------------------------------------------------------------------

  // SKIPPED PENDING REWRITE: PR #1 dropped 'error' from PaneStatus and routes
  // failure differently (terminated flag + completionStatus.state). These tests
  // need a from-scratch rewrite against the new model. Tracked as integration debt.
  describe.skip('StopFailure', () => {
    it('maps to error status', async () => {
      await sendPayload(socketPath, {
        hookEventName: 'StopFailure',
        paneId: 'pane-1'
      })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'error',
        'hook',
        null
      )
    })

    it('extracts transcript_path', async () => {
      await sendPayload(socketPath, {
        hookEventName: 'StopFailure',
        paneId: 'pane-1',
        transcript_path: '/tmp/transcript.jsonl'
      })

      expect(registry.updatePaneTranscriptPath).toHaveBeenCalledWith(
        'pane-1',
        '/tmp/transcript.jsonl'
      )
    })

    it('triggers transcript parsing', async () => {
      await sendPayload(socketPath, {
        hookEventName: 'StopFailure',
        paneId: 'pane-1'
      })

      expect(metricsCollector.parseTranscriptForPane).toHaveBeenCalledWith('pane-1')
    })

    it('is NOT refined to needs-input even when PTY output ends with ?', async () => {
      const mockDetector = {
        getLastOutput: vi.fn(() => 'Should I continue?')
      }
      listener.setStatusDetector(mockDetector as unknown as Parameters<HookListener['setStatusDetector']>[0])

      await sendPayload(socketPath, {
        hookEventName: 'StopFailure',
        paneId: 'pane-1'
      })

      // Should be 'error', not 'needs-input' — the Stop→needs-input refinement
      // only applies to hookEventName === 'Stop', not 'StopFailure'
      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'error',
        'hook',
        null
      )
    })
  })

  // -------------------------------------------------------------------------
  // Stop question heuristic
  //
  // The Stop hook defaults to 'done', but the classifyStopOutput helper can
  // refine to 'needs-input' when Claude's tail buffer contains a plain-text
  // question that the Notification hook won't catch (Notification only fires
  // for permission prompts and AskUserQuestion-style tool calls).
  // -------------------------------------------------------------------------

  describe('Stop question heuristic', () => {
    it('routes Stop → needs-input when the last buffer has a question followed by a clarifier', async () => {
      // Real-world case: Claude ends with a question and then adds one more
      // sentence summarizing the choice. A last-line check would miss the
      // question because the very last line is declarative.
      const buffer =
        'Want me to fix #4 (paths in the wave guide) and draft the Track 11 ' +
        'continuation kickoff variant now? Those are the two cheapest ' +
        'pre-launch chores.\n\n* Worked for 1m 34s\n\n> '
      const mockDetector = {
        getLastOutput: vi.fn(() => buffer)
      }
      listener.setStatusDetector(
        mockDetector as unknown as Parameters<HookListener['setStatusDetector']>[0]
      )

      await sendPayload(socketPath, {
        hookEventName: 'Stop',
        paneId: 'pane-1'
      })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'needs-input',
        'hook',
        null
      )
    })
  })

  // -------------------------------------------------------------------------
  // Plan-mode Stop override (Phase: Kanban polish)
  // -------------------------------------------------------------------------

  // SKIPPED PENDING REWRITE: PR #1 redesigned plan-mode Stop routing — instead
  // of coercing done → needs-input it now emits 'planning' / 'plan-ready' from
  // the synchronous diff probe. Tests need rewrite against the new contract.
  describe.skip('Stop in plan mode', () => {
    it('coerces done → needs-input when pane.permissionMode === "plan"', async () => {
      // Claude Code plans typically end with something like
      //   "Want me to adjust the lineup, or should I proceed?"
      //   ...no question mark at the very end because the line wraps or
      //   the transcript prints "Let me know and I'll proceed." last.
      // Without the plan-mode override the pane would show Done even though
      // the agent is blocked on user approval.
      const pane = makePaneState({ permissionMode: 'plan' })
      registry.getPane.mockReturnValue(pane)
      const mockDetector = {
        getLastOutput: vi.fn(() => "Let me know and I'll proceed.") // no '?' — question-mark refinement wouldn't trigger
      }
      listener.setStatusDetector(mockDetector as unknown as Parameters<HookListener['setStatusDetector']>[0])

      await sendPayload(socketPath, {
        hookEventName: 'Stop',
        paneId: 'pane-1'
      })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'needs-input',
        'hook',
        null
      )
    })

    it('leaves Stop → done alone when pane.permissionMode === "normal"', async () => {
      const pane = makePaneState({ permissionMode: 'normal' })
      registry.getPane.mockReturnValue(pane)
      const mockDetector = {
        getLastOutput: vi.fn(() => 'All done. See you next time.')
      }
      listener.setStatusDetector(mockDetector as unknown as Parameters<HookListener['setStatusDetector']>[0])

      await sendPayload(socketPath, {
        hookEventName: 'Stop',
        paneId: 'pane-1'
      })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'done',
        'hook',
        null
      )
    })
  })

  // -------------------------------------------------------------------------
  // Stop routing (post-PR #1 contract): plan-ready / planning / changes-ready
  // / needs-input
  // -------------------------------------------------------------------------

  describe('Stop routing (PR #1 PaneStatus union)', () => {
    beforeEach(() => {
      mockGetGitStatus.mockReset()
    })

    it('routes to plan-ready when activeToolName is ExitPlanMode, regardless of permissionMode', async () => {
      // The regression case: a plan-mode pane where the async permissionMode
      // detector hasn't populated the field yet still has to land in
      // plan-ready, because the synchronous ExitPlanMode signal is
      // load-bearing on its own.
      const pane = makePaneState({
        status: 'working',
        activeToolName: 'ExitPlanMode',
        permissionMode: undefined
      })
      registry.getPane.mockReturnValue(pane)
      mockGetGitStatus.mockResolvedValue({
        hasUncommittedChanges: false,
        commitsAhead: 0
      } as never)

      await sendPayload(socketPath, { hookEventName: 'Stop', paneId: 'pane-1' })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'plan-ready',
        'hook',
        null
      )
    })

    it('routes to plan-ready when ExitPlanMode is active AND permissionMode is plan', async () => {
      const pane = makePaneState({
        status: 'working',
        activeToolName: 'ExitPlanMode',
        permissionMode: 'plan'
      })
      registry.getPane.mockReturnValue(pane)

      await sendPayload(socketPath, { hookEventName: 'Stop', paneId: 'pane-1' })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'plan-ready',
        'hook',
        null
      )
    })

    it('routes to planning when permissionMode is plan but no ExitPlanMode (mid-composition pause)', async () => {
      const pane = makePaneState({
        status: 'working',
        activeToolName: null,
        permissionMode: 'plan'
      })
      registry.getPane.mockReturnValue(pane)

      await sendPayload(socketPath, { hookEventName: 'Stop', paneId: 'pane-1' })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'planning',
        'hook',
        null
      )
    })

    it('routes to changes-ready when not in plan mode and the worktree has uncommitted changes', async () => {
      const pane = makePaneState({
        status: 'working',
        activeToolName: null,
        permissionMode: undefined
      })
      registry.getPane.mockReturnValue(pane)
      mockGetGitStatus.mockResolvedValue({
        hasUncommittedChanges: true,
        commitsAhead: 0
      } as never)

      await sendPayload(socketPath, { hookEventName: 'Stop', paneId: 'pane-1' })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'changes-ready',
        'hook',
        null
      )
    })

    it('routes to changes-ready when commitsAhead > 0', async () => {
      const pane = makePaneState({
        status: 'working',
        activeToolName: null,
        permissionMode: undefined
      })
      registry.getPane.mockReturnValue(pane)
      mockGetGitStatus.mockResolvedValue({
        hasUncommittedChanges: false,
        commitsAhead: 3
      } as never)

      await sendPayload(socketPath, { hookEventName: 'Stop', paneId: 'pane-1' })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'changes-ready',
        'hook',
        null
      )
    })

    it('routes to needs-input when not in plan mode and the worktree is clean', async () => {
      const pane = makePaneState({
        status: 'working',
        activeToolName: null,
        permissionMode: undefined
      })
      registry.getPane.mockReturnValue(pane)
      mockGetGitStatus.mockResolvedValue({
        hasUncommittedChanges: false,
        commitsAhead: 0
      } as never)

      await sendPayload(socketPath, { hookEventName: 'Stop', paneId: 'pane-1' })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'needs-input',
        'hook',
        null
      )
    })

    it('falls back to needs-input when the diff probe throws', async () => {
      const pane = makePaneState({
        status: 'working',
        activeToolName: null,
        permissionMode: undefined
      })
      registry.getPane.mockReturnValue(pane)
      mockGetGitStatus.mockRejectedValue(new Error('git not a repo'))

      await sendPayload(socketPath, { hookEventName: 'Stop', paneId: 'pane-1' })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'needs-input',
        'hook',
        null
      )
    })
  })

  // -------------------------------------------------------------------------
  // PostCompact
  // -------------------------------------------------------------------------

  describe('PostCompact', () => {
    it('does not change status', async () => {
      await sendPayload(socketPath, {
        hookEventName: 'PostCompact',
        paneId: 'pane-1'
      })

      expect(registry.updatePaneStatus).not.toHaveBeenCalled()
    })

    it('triggers transcript parsing', async () => {
      await sendPayload(socketPath, {
        hookEventName: 'PostCompact',
        paneId: 'pane-1'
      })

      expect(metricsCollector.parseTranscriptForPane).toHaveBeenCalledWith('pane-1')
    })
  })

  // -------------------------------------------------------------------------
  // activeToolName lifecycle
  //
  // activeToolName is set on PreToolUse and cleared on every other hook event
  // (including PostToolUse). Per user feedback the pane label should revert to
  // "Working" between tool calls rather than sticking on the last tool's verb.
  // -------------------------------------------------------------------------

  describe('activeToolName lifecycle across tool events', () => {
    it('PreToolUse sets activeToolName to the new tool', async () => {
      const pane = makePaneState({ status: 'awaiting-prompt', activeToolName: null })
      registry.getPane.mockReturnValue(pane)

      await sendPayload(socketPath, {
        hookEventName: 'PreToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'working',
        'hook',
        'Read'
      )
    })

    it('PostToolUse clears activeToolName so the label reverts to "Working"', async () => {
      // Pane is mid-turn with Claude actively reading. When PostToolUse fires
      // the label should drop the tool verb ("Reading") and show the generic
      // "Working" fallback until the next PreToolUse arrives.
      const pane = makePaneState({ status: 'working', activeToolName: 'Read' })
      registry.getPane.mockReturnValue(pane)

      await sendPayload(socketPath, {
        hookEventName: 'PostToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'working',
        'hook',
        null
      )
    })

    it('UserPromptSubmit clears activeToolName at the start of a new turn', async () => {
      // Pane just finished a turn and is showing the last-used tool. The user
      // submits a new prompt — we want a clean slate, not a stale tool name
      // from the previous turn lingering until the next PreToolUse.
      const pane = makePaneState({ status: 'done', activeToolName: 'Read' })
      registry.getPane.mockReturnValue(pane)

      await sendPayload(socketPath, {
        hookEventName: 'UserPromptSubmit',
        paneId: 'pane-1'
      })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'working',
        'hook',
        null
      )
    })

    // SKIPPED PENDING REWRITE: PR #1 dropped 'done' as a Stop destination — now
    // Stop routes to 'changes-ready' / 'needs-input' / 'plan-ready' via diff probe.
    it.skip('Stop clears activeToolName when transitioning to done', async () => {
      const pane = makePaneState({ status: 'working', activeToolName: 'Read' })
      registry.getPane.mockReturnValue(pane)

      await sendPayload(socketPath, {
        hookEventName: 'Stop',
        paneId: 'pane-1'
      })

      expect(registry.updatePaneStatus).toHaveBeenCalledWith(
        'pane-1',
        'done',
        'hook',
        null
      )
    })
  })

  // -------------------------------------------------------------------------
  // MIN_TOOL_DISPLAY_MS hold
  //
  // Many Claude Code tools (Read / Grep / Glob / small Edit) complete in tens
  // of ms, so the PreToolUse → PostToolUse verb swap was too fast to read.
  // The emit block now holds a given tool verb visible for at least 2s
  // before allowing the next value through, coalescing any tool changes
  // inside the hold window to the most recent ideal.
  // -------------------------------------------------------------------------

  describe('MIN_TOOL_DISPLAY_MS hold', () => {
    const HOLD_WAIT_MS = 2100

    /**
     * Mock the registry's updatePaneStatus to ACTUALLY mutate the pane so
     * consecutive hook events read the post-update state — mirrors the
     * production SessionRegistry and lets multi-event sequences run through
     * the same guard clauses (`didStatusChange`, `didToolChange`) the real
     * registry would produce.
     */
    function wireMutatingRegistry(pane: PaneState) {
      registry.getPane.mockReturnValue(pane)
      registry.updatePaneStatus.mockImplementation(
        (_id: unknown, status: unknown, _source: unknown, tool: unknown) => {
          pane.status = status as PaneState['status']
          pane.activeToolName = tool as PaneState['activeToolName']
          return true
        }
      )
    }

    it('defers a rapid PostToolUse so the tool verb stays visible for ≥2s', async () => {
      const pane = makePaneState({ status: 'awaiting-prompt', activeToolName: null })
      wireMutatingRegistry(pane)

      // PreToolUse emits immediately (status changed) and starts the hold.
      await sendPayload(socketPath, {
        hookEventName: 'PreToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })
      expect(windowManager._sendSpy).toHaveBeenCalledTimes(1)
      expect(windowManager._sendSpy).toHaveBeenLastCalledWith(
        'pane:status',
        expect.objectContaining({ activeToolName: 'Read', status: 'working' })
      )

      // PostToolUse fires quickly — should defer, not emit.
      await sendPayload(socketPath, {
        hookEventName: 'PostToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })
      expect(windowManager._sendSpy).toHaveBeenCalledTimes(1)

      // Once the hold expires, the coalesced "clear" update fires.
      await new Promise<void>((resolve) => setTimeout(resolve, HOLD_WAIT_MS))
      expect(windowManager._sendSpy).toHaveBeenCalledTimes(2)
      expect(windowManager._sendSpy).toHaveBeenLastCalledWith(
        'pane:status',
        expect.objectContaining({ activeToolName: null, status: 'working' })
      )
    })

    it('coalesces tool changes inside the hold window to the most recent value', async () => {
      const pane = makePaneState({ status: 'awaiting-prompt', activeToolName: null })
      wireMutatingRegistry(pane)

      // Pre Read → emit, hold starts.
      await sendPayload(socketPath, {
        hookEventName: 'PreToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })
      // Post Read → defer (pending=null).
      await sendPayload(socketPath, {
        hookEventName: 'PostToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })
      // Pre Edit inside the hold → defer, replace pending with 'Edit'.
      await sendPayload(socketPath, {
        hookEventName: 'PreToolUse',
        paneId: 'pane-1',
        tool_name: 'Edit'
      })
      expect(windowManager._sendSpy).toHaveBeenCalledTimes(1)

      await new Promise<void>((resolve) => setTimeout(resolve, HOLD_WAIT_MS))

      // One deferred emit fires with the coalesced final value ('Edit').
      expect(windowManager._sendSpy).toHaveBeenCalledTimes(2)
      expect(windowManager._sendSpy).toHaveBeenLastCalledWith(
        'pane:status',
        expect.objectContaining({ activeToolName: 'Edit' })
      )
    })

    // SKIPPED PENDING REWRITE: depends on PR #1's reworked status broadcast shape.
    it.skip('a status change during the hold emits immediately and cancels the pending update', async () => {
      const pane = makePaneState({ status: 'awaiting-prompt', activeToolName: null })
      wireMutatingRegistry(pane)

      await sendPayload(socketPath, {
        hookEventName: 'PreToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })
      await sendPayload(socketPath, {
        hookEventName: 'PostToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })
      // PostToolUse deferred. Now status flips to done via Stop — must emit now.
      await sendPayload(socketPath, {
        hookEventName: 'Stop',
        paneId: 'pane-1'
      })
      expect(windowManager._sendSpy).toHaveBeenCalledTimes(2)
      expect(windowManager._sendSpy).toHaveBeenLastCalledWith(
        'pane:status',
        expect.objectContaining({ status: 'done', activeToolName: null })
      )

      // Wait past what WOULD have been the hold timer — no extra emit.
      await new Promise<void>((resolve) => setTimeout(resolve, HOLD_WAIT_MS))
      expect(windowManager._sendSpy).toHaveBeenCalledTimes(2)
    })

    it('emits immediately when the prior display is already older than the hold', async () => {
      const pane = makePaneState({ status: 'awaiting-prompt', activeToolName: null })
      wireMutatingRegistry(pane)

      await sendPayload(socketPath, {
        hookEventName: 'PreToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })
      await new Promise<void>((resolve) => setTimeout(resolve, HOLD_WAIT_MS))

      // Hold already elapsed; PostToolUse should emit on the spot.
      await sendPayload(socketPath, {
        hookEventName: 'PostToolUse',
        paneId: 'pane-1',
        tool_name: 'Read'
      })
      expect(windowManager._sendSpy).toHaveBeenCalledTimes(2)
      expect(windowManager._sendSpy).toHaveBeenLastCalledWith(
        'pane:status',
        expect.objectContaining({ activeToolName: null })
      )
    })
  })

  // -------------------------------------------------------------------------
  // Plan-approval broadcast (drives the Kanban repo rail's
  // "Approve plans in sequence" button appearance)
  // -------------------------------------------------------------------------

  describe('ExitPlanMode broadcast', () => {
    it('triggers inspector broadcast when a pane flips INTO ExitPlanMode', async () => {
      const pane = makePaneState({ status: 'working', activeToolName: 'Read' })
      registry.getPane.mockReturnValue(pane)
      const inspector = { broadcastSummary: vi.fn() }
      listener.setInspectorService(
        inspector as unknown as Parameters<typeof listener.setInspectorService>[0]
      )

      await sendPayload(socketPath, {
        hookEventName: 'PreToolUse',
        paneId: 'pane-1',
        tool_name: 'ExitPlanMode'
      })

      expect(inspector.broadcastSummary).toHaveBeenCalledWith('workspace-1')
    })

    it('triggers inspector broadcast when a pane flips OUT of ExitPlanMode', async () => {
      const pane = makePaneState({ status: 'needs-input', activeToolName: 'ExitPlanMode' })
      registry.getPane.mockReturnValue(pane)
      const inspector = { broadcastSummary: vi.fn() }
      listener.setInspectorService(
        inspector as unknown as Parameters<typeof listener.setInspectorService>[0]
      )

      await sendPayload(socketPath, {
        hookEventName: 'PostToolUse',
        paneId: 'pane-1',
        tool_name: 'ExitPlanMode'
      })

      expect(inspector.broadcastSummary).toHaveBeenCalledWith('workspace-1')
    })

    it('does NOT trigger inspector broadcast on unrelated tool changes', async () => {
      const pane = makePaneState({ status: 'working', activeToolName: 'Read' })
      registry.getPane.mockReturnValue(pane)
      const inspector = { broadcastSummary: vi.fn() }
      listener.setInspectorService(
        inspector as unknown as Parameters<typeof listener.setInspectorService>[0]
      )

      await sendPayload(socketPath, {
        hookEventName: 'PreToolUse',
        paneId: 'pane-1',
        tool_name: 'Edit'
      })

      expect(inspector.broadcastSummary).not.toHaveBeenCalled()
    })
  })
})
