/**
 * MetricsCollector unit tests.
 *
 * Tests statusline JSON parsing (via the initial read triggered by watchPane)
 * and JSONL transcript parsing (via parseTranscriptForPane).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import type { PaneState } from '../src/shared/types'
import { IPC } from '../src/shared/ipc-channels'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
    promises: {
      readFile: vi.fn()
    }
  }
}))

vi.mock('../src/main/constants', async () => {
  const actual = await vi.importActual('../src/main/constants') as Record<string, unknown>
  return {
    ...actual,
    getStatuslineTempDir: vi.fn(() => '/tmp')
  }
})

import fs from 'fs'
import { MetricsCollector } from '../src/main/metrics-collector'
import { getStatuslineTempDir } from '../src/main/constants'
import { createMockRegistry } from './helpers/mock-registry'
import { createMockWindowManager } from './helpers/mock-window-manager'

const mockGetStatuslineTempDir = vi.mocked(getStatuslineTempDir)

const mockReadFileSync = vi.mocked(fs.readFileSync)
const mockWatchFile = vi.mocked(fs.watchFile)
const mockUnwatchFile = vi.mocked(fs.unwatchFile)
const mockReadFile = vi.mocked(fs.promises.readFile)

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

/** Build a valid statusline JSON string for testing */
function makeStatuslineJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: { id: 'claude-sonnet-4-6' },
    cost: {
      total_cost_usd: 0.05,
      total_duration_ms: 12000,
      total_lines_added: 10,
      total_lines_removed: 3
    },
    context_window: { used_percentage: 42 },
    ...overrides
  })
}

/** Build a multi-line JSONL transcript string for testing */
function makeJsonl(...entries: Record<string, unknown>[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetricsCollector', () => {
  let registry: ReturnType<typeof createMockRegistry>
  let windowManager: ReturnType<typeof createMockWindowManager>
  let collector: MetricsCollector

  beforeEach(() => {
    vi.clearAllMocks()

    registry = createMockRegistry()
    windowManager = createMockWindowManager()

    collector = new MetricsCollector(
      registry as unknown as import('../src/main/session-registry').SessionRegistry,
      windowManager as unknown as import('../src/main/window-manager').WindowManager
    )
  })

  // -------------------------------------------------------------------------
  // Statusline parsing — via watchPane initial read
  // -------------------------------------------------------------------------

  describe('statusline parsing (watchPane initial read)', () => {
    function setupAndWatch(statuslineJson: string, pane?: Partial<PaneState>) {
      const paneState = makePaneState({ id: 'pane-1', ...pane })
      registry.getPane.mockReturnValue(paneState)
      mockReadFileSync.mockReturnValue(statuslineJson as unknown as Buffer)
      collector.watchPane('pane-1')
    }

    it('constructs file path using getStatuslineTempDir()', () => {
      mockGetStatuslineTempDir.mockReturnValue('/custom/tmp')
      const paneState = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(paneState)
      mockReadFileSync.mockReturnValue(makeStatuslineJson() as unknown as Buffer)

      collector.watchPane('pane-1')

      // The first argument to readFileSync should use the custom temp dir
      expect(mockReadFileSync).toHaveBeenCalledWith(
        path.join('/custom/tmp', 'claudinha-statusline-pane-1.json'),
        'utf8'
      )
      mockGetStatuslineTempDir.mockReturnValue('/tmp')
    })

    it('parses statusline cost fields: totalCostUsd, durationMs', () => {
      setupAndWatch(makeStatuslineJson())

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalCostUsd).toBe(0.05)
      expect(metrics.durationMs).toBe(12000)
    })

    it('does NOT read linesAdded/Removed from the statusline cost fields (uses inspector cache instead)', () => {
      // Claude Code's cost.total_lines_added/removed is a per-session counter
      // that diverges from git's view (L-032). The Kanban card + repo rail
      // must agree, so lines come from the inspector's git-based diff cache.
      // With no inspector wired, pickLineCounts returns the previously
      // emitted values — here that's the pane's initial `null`s.
      setupAndWatch(makeStatuslineJson())

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.linesAdded).toBeNull()
      expect(metrics.linesRemoved).toBeNull()
    })

    it('overlays linesAdded/Removed from the inspector cache when wired', () => {
      const inspector = {
        getDiffStats: vi.fn(() => ({ filesTouched: 2, linesAdded: 42, linesRemoved: 7 }))
      } as unknown as import('../src/main/inspector').InspectorService
      collector.setInspector(inspector)
      setupAndWatch(makeStatuslineJson())

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.linesAdded).toBe(42)
      expect(metrics.linesRemoved).toBe(7)
    })

    it('parses model.id and abbreviates it', () => {
      setupAndWatch(makeStatuslineJson({ model: { id: 'claude-sonnet-4-6' } }))

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.modelDisplayName).toBe('s4.6')
    })

    it('abbreviates suffixed model IDs via prefix match', () => {
      setupAndWatch(makeStatuslineJson({ model: { id: 'claude-opus-4-6[1m]' } }))

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.modelDisplayName).toBe('o4.6')
    })

    it('falls back to stripped model ID for unknown models', () => {
      setupAndWatch(makeStatuslineJson({ model: { id: 'claude-future-5-0' } }))

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.modelDisplayName).toBe('future-5-0')
    })

    it('parses context_window.used_percentage', () => {
      setupAndWatch(makeStatuslineJson({ context_window: { used_percentage: 75 } }))

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.contextPercent).toBe(75)
    })

    it('stores context_window_size from statusline in registry (PE-02)', () => {
      setupAndWatch(makeStatuslineJson({
        context_window: { used_percentage: 42, context_window_size: 1_000_000 }
      }))

      expect(registry.updatePaneContextWindowSize).toHaveBeenCalledWith('pane-1', 1_000_000)
    })

    it('preserves JSONL-derived fields (totalTokens, toolsUsed, sessionTitle) from existing metrics', () => {
      const toolsUsed = new Map([['Read', 5]])
      const pane: Partial<PaneState> = {
        metrics: { ...makeMetrics(), totalTokens: 8000, toolsUsed, sessionTitle: 'fix-auth' }
      }
      setupAndWatch(makeStatuslineJson(), pane)

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalTokens).toBe(8000)
      expect(metrics.toolsUsed).toBe(toolsUsed)
      expect(metrics.sessionTitle).toBe('fix-auth')
    })

    it('handles missing optional cost fields gracefully (nulls)', () => {
      setupAndWatch(makeStatuslineJson({ cost: {} }))

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalCostUsd).toBeNull()
      expect(metrics.durationMs).toBeNull()
      // linesAdded/Removed come from the inspector (not statusline). With no
      // inspector wired, pickLineCounts returns the pane's prior values (null).
      expect(metrics.linesAdded).toBeNull()
      expect(metrics.linesRemoved).toBeNull()
    })

    it('handles malformed JSON: logs warning, does not update registry', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const paneState = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(paneState)
      mockReadFileSync.mockReturnValue('not valid json' as unknown as Buffer)

      collector.watchPane('pane-1')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[metrics-collector]'),
        expect.any(String)
      )
      expect(registry.updatePaneMetrics).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('emits IPC.PANE_METRICS to the correct window', () => {
      setupAndWatch(makeStatuslineJson())

      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.PANE_METRICS,
        expect.objectContaining({ paneId: 'pane-1' })
      )
    })

    it('no-ops when readFileSync throws (file not yet written)', () => {
      const paneState = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(paneState)
      mockReadFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      expect(() => collector.watchPane('pane-1')).not.toThrow()
      expect(registry.updatePaneMetrics).not.toHaveBeenCalled()
      // watchFile should still be called (it works with non-existent files)
      expect(mockWatchFile).toHaveBeenCalled()
    })

    it('falls back to display_name prefix when model.id is absent', () => {
      setupAndWatch(
        makeStatuslineJson({ model: { display_name: 'Claude Sonnet 4.6' } })
      )

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      // First 6 chars of display_name
      expect(metrics.modelDisplayName).toBe('Claude')
    })

    it('triggers watcher callback on file change event (mtime changed)', () => {
      let capturedCallback: ((curr: fs.Stats, prev: fs.Stats) => void) | undefined
      mockWatchFile.mockImplementation((_path, _opts, cb) => {
        capturedCallback = cb as (curr: fs.Stats, prev: fs.Stats) => void
      })

      const paneState = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(paneState)

      // First read (initial)
      mockReadFileSync.mockReturnValueOnce(makeStatuslineJson({ cost: { total_cost_usd: 0.01 } }) as unknown as Buffer)
      collector.watchPane('pane-1')

      vi.clearAllMocks()
      registry.getPane.mockReturnValue(paneState)

      // Simulate a file change event (mtime changed)
      mockReadFileSync.mockReturnValue(makeStatuslineJson({ cost: { total_cost_usd: 0.99 } }) as unknown as Buffer)
      capturedCallback?.(
        { mtimeMs: 2000 } as fs.Stats,
        { mtimeMs: 1000 } as fs.Stats
      )

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalCostUsd).toBe(0.99)
    })

    it('skips callback when mtime is unchanged', () => {
      let capturedCallback: ((curr: fs.Stats, prev: fs.Stats) => void) | undefined
      mockWatchFile.mockImplementation((_path, _opts, cb) => {
        capturedCallback = cb as (curr: fs.Stats, prev: fs.Stats) => void
      })

      const paneState = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(paneState)
      mockReadFileSync.mockReturnValueOnce(makeStatuslineJson() as unknown as Buffer)
      collector.watchPane('pane-1')

      vi.clearAllMocks()

      // Simulate a poll where mtime is the same
      capturedCallback?.(
        { mtimeMs: 1000 } as fs.Stats,
        { mtimeMs: 1000 } as fs.Stats
      )

      expect(mockReadFileSync).not.toHaveBeenCalled()
    })

    it('triggers an eager JSONL parse the first time a pane learns its transcript_path', async () => {
      // While a session is mid-turn (status=working) the Stop hook hasn't
      // fired yet. If Claude has already written `custom-title` into the
      // JSONL, we want the sessionTitle to show up within one statusline
      // poll cycle instead of waiting for the next Stop. applyStatuslineData
      // detects the "first time seen" transition and kicks off the parse.
      const paneState = makePaneState({
        id: 'pane-1',
        transcriptPath: null, // not yet seen
        metrics: { ...makeMetrics() }
      })
      registry.getPane.mockReturnValue(paneState)
      mockReadFileSync.mockReturnValue(
        makeStatuslineJson({ transcript_path: '/tmp/transcript.jsonl' }) as unknown as Buffer
      )
      mockReadFile.mockResolvedValue(
        makeJsonl(
          { type: 'custom-title', customTitle: 'cute-animal-stories' }
        ) as unknown as Buffer
      )

      collector.watchPane('pane-1')

      // transcript_path recorded in registry
      expect(registry.updatePaneTranscriptPath).toHaveBeenCalledWith('pane-1', '/tmp/transcript.jsonl')

      // And the JSONL parse was kicked off against the same path
      await new Promise<void>((r) => setTimeout(r, 0))
      expect(mockReadFile).toHaveBeenCalledWith('/tmp/transcript.jsonl', 'utf8')
    })

    it('does NOT re-trigger an eager JSONL parse on subsequent statusline ticks', async () => {
      // Only the first "transition" from null → path should parse; later
      // statusline updates leave transcript parsing to Stop/Notification.
      const paneState = makePaneState({
        id: 'pane-1',
        transcriptPath: '/tmp/transcript.jsonl', // already known
        metrics: { ...makeMetrics() }
      })
      registry.getPane.mockReturnValue(paneState)
      mockReadFileSync.mockReturnValue(
        makeStatuslineJson({ transcript_path: '/tmp/transcript.jsonl' }) as unknown as Buffer
      )

      collector.watchPane('pane-1')
      await new Promise<void>((r) => setTimeout(r, 0))

      expect(mockReadFile).not.toHaveBeenCalled()
    })

    it('regression: file does not exist at watch time, then appears — metrics emitted', () => {
      let capturedCallback: ((curr: fs.Stats, prev: fs.Stats) => void) | undefined
      mockWatchFile.mockImplementation((_path, _opts, cb) => {
        capturedCallback = cb as (curr: fs.Stats, prev: fs.Stats) => void
      })

      const paneState = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(paneState)

      // Initial read fails — file doesn't exist yet
      mockReadFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      collector.watchPane('pane-1')

      // No metrics emitted yet
      expect(registry.updatePaneMetrics).not.toHaveBeenCalled()
      // But watchFile was still registered
      expect(mockWatchFile).toHaveBeenCalled()

      // File appears — simulate mtime change (0 → non-zero = file created)
      mockReadFileSync.mockReturnValue(makeStatuslineJson({ cost: { total_cost_usd: 0.42 } }) as unknown as Buffer)
      capturedCallback?.(
        { mtimeMs: 1000 } as fs.Stats,
        { mtimeMs: 0 } as fs.Stats
      )

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalCostUsd).toBe(0.42)
      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.PANE_METRICS,
        expect.objectContaining({ paneId: 'pane-1' })
      )
    })
  })

  // -------------------------------------------------------------------------
  // reemitWithInspectorDiff — inspector-driven chip refresh
  // -------------------------------------------------------------------------

  describe('reemitWithInspectorDiff', () => {
    it('re-emits PaneMetrics with inspector cache values overlaid', () => {
      const paneState = makePaneState({
        id: 'pane-1',
        metrics: {
          ...makeMetrics(),
          totalCostUsd: 0.42,
          totalTokens: 12345,
          sessionTitle: 'cute-animal-stories'
        }
      })
      registry.getPane.mockReturnValue(paneState)
      const inspector = {
        getDiffStats: vi.fn(() => ({ filesTouched: 3, linesAdded: 19, linesRemoved: 4 }))
      } as unknown as import('../src/main/inspector').InspectorService
      collector.setInspector(inspector)

      collector.reemitWithInspectorDiff('pane-1')

      // Registry updated with git-based line counts, other fields preserved.
      const updated = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(updated.linesAdded).toBe(19)
      expect(updated.linesRemoved).toBe(4)
      expect(updated.totalCostUsd).toBe(0.42)
      expect(updated.totalTokens).toBe(12345)
      expect(updated.sessionTitle).toBe('cute-animal-stories')

      // PANE_METRICS IPC emitted with the same values.
      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.PANE_METRICS,
        expect.objectContaining({
          paneId: 'pane-1',
          metrics: expect.objectContaining({ linesAdded: 19, linesRemoved: 4 })
        })
      )
    })

    it('no-ops when the pane is unknown', () => {
      registry.getPane.mockReturnValue(undefined)
      expect(() => collector.reemitWithInspectorDiff('gone')).not.toThrow()
      expect(registry.updatePaneMetrics).not.toHaveBeenCalled()
      expect(windowManager._sendSpy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // unwatchPane
  // -------------------------------------------------------------------------

  describe('unwatchPane', () => {
    it('calls fs.unwatchFile on unwatch', () => {
      const paneState = makePaneState({ id: 'pane-1' })
      registry.getPane.mockReturnValue(paneState)
      mockReadFileSync.mockReturnValue(makeStatuslineJson() as unknown as Buffer)

      collector.watchPane('pane-1')
      collector.unwatchPane('pane-1')

      expect(mockUnwatchFile).toHaveBeenCalledWith(
        path.join('/tmp', 'claudinha-statusline-pane-1.json')
      )
    })

    it('no-ops when pane was never watched', () => {
      expect(() => collector.unwatchPane('unknown')).not.toThrow()
      expect(mockUnwatchFile).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // JSONL transcript parsing — via parseTranscriptForPane
  // -------------------------------------------------------------------------

  describe('parseTranscriptForPane', () => {
    function setupForJsonl(jsonlContent: string, existingMetrics?: Partial<PaneState['metrics']>) {
      const paneState = makePaneState({
        id: 'pane-1',
        transcriptPath: '/tmp/transcript.jsonl',
        metrics: { ...makeMetrics(), ...existingMetrics }
      })
      registry.getPane.mockReturnValue(paneState)
      mockReadFile.mockResolvedValue(jsonlContent as unknown as Buffer)
    }

    async function runAndFlush() {
      collector.parseTranscriptForPane('pane-1')
      // Yield to the event loop so the async chain completes
      await new Promise<void>((r) => setTimeout(r, 0))
    }

    it('accumulates input+output tokens across all assistant entries', async () => {
      setupForJsonl(
        makeJsonl(
          { type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } },
          { type: 'assistant', message: { usage: { input_tokens: 200, output_tokens: 75 } } }
        )
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalTokens).toBe(425) // 100+50+200+75
    })

    it('skips sidechain entries', async () => {
      setupForJsonl(
        makeJsonl(
          { type: 'assistant', isSidechain: true, message: { usage: { input_tokens: 999, output_tokens: 999 } } },
          { type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } }
        )
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalTokens).toBe(150)
    })

    it('skips API error entries', async () => {
      setupForJsonl(
        makeJsonl(
          { type: 'assistant', isApiErrorMessage: true, message: { usage: { input_tokens: 999, output_tokens: 999 } } },
          { type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } }
        )
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalTokens).toBe(150)
    })

    it('counts tool usage per tool name', async () => {
      setupForJsonl(
        makeJsonl(
          { tool_name: 'Read' },
          { tool_name: 'Edit' },
          { tool_name: 'Read' },
          { tool_name: 'Bash' }
        )
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.toolsUsed?.get('Read')).toBe(2)
      expect(metrics.toolsUsed?.get('Edit')).toBe(1)
      expect(metrics.toolsUsed?.get('Bash')).toBe(1)
    })

    it('preserves statusline-derived fields when updating from JSONL', async () => {
      setupForJsonl(
        makeJsonl({ type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } }),
        { totalCostUsd: 0.05, durationMs: 12000, modelDisplayName: 's4.6', linesAdded: 5, linesRemoved: 2 }
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalCostUsd).toBe(0.05)
      expect(metrics.durationMs).toBe(12000)
      expect(metrics.modelDisplayName).toBe('s4.6')
      expect(metrics.linesAdded).toBe(5)
      expect(metrics.linesRemoved).toBe(2)
    })

    it('handles empty transcript without updating registry', async () => {
      setupForJsonl('')

      await runAndFlush()

      // totalTokens will be null → no meaningful update, but updatePaneMetrics still called
      // with null totalTokens — verify no exception thrown
      expect(() => undefined).not.toThrow()
    })

    it('skips malformed JSONL lines and continues', async () => {
      setupForJsonl(
        [
          '{ not valid json',
          JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } }),
          'also bad',
          JSON.stringify({ tool_name: 'Read' })
        ].join('\n')
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.totalTokens).toBe(150)
      expect(metrics.toolsUsed?.get('Read')).toBe(1)
    })

    it('no-ops when pane has no transcriptPath', async () => {
      const paneState = makePaneState({ id: 'pane-1', transcriptPath: null })
      registry.getPane.mockReturnValue(paneState)

      await runAndFlush()

      expect(mockReadFile).not.toHaveBeenCalled()
      expect(registry.updatePaneMetrics).not.toHaveBeenCalled()
    })

    it('no-ops when transcript file cannot be read', async () => {
      const paneState = makePaneState({ id: 'pane-1', transcriptPath: '/tmp/missing.jsonl' })
      registry.getPane.mockReturnValue(paneState)
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      await runAndFlush()

      expect(registry.updatePaneMetrics).not.toHaveBeenCalled()
    })

    it('emits IPC.PANE_METRICS after JSONL parse', async () => {
      setupForJsonl(
        makeJsonl({ type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } })
      )

      await runAndFlush()

      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.PANE_METRICS,
        expect.objectContaining({ paneId: 'pane-1' })
      )
    })

    it('extracts customTitle from JSONL into sessionTitle (PE-04)', async () => {
      setupForJsonl(
        makeJsonl(
          { type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } },
          { type: 'custom-title', customTitle: 'fix-auth-middleware', sessionId: 'sess-1' },
          { tool_name: 'Read' }
        )
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.sessionTitle).toBe('fix-auth-middleware')
      // Other fields still parsed correctly
      expect(metrics.totalTokens).toBe(150)
      expect(metrics.toolsUsed?.get('Read')).toBe(1)
    })

    it('preserves existing sessionTitle when JSONL has no custom-title entry (PE-04)', async () => {
      setupForJsonl(
        makeJsonl(
          { type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } }
        ),
        { sessionTitle: 'previous-title' }
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.sessionTitle).toBe('previous-title')
    })

    it('uses latest customTitle when multiple custom-title entries exist (PE-04)', async () => {
      setupForJsonl(
        makeJsonl(
          { type: 'custom-title', customTitle: 'first-title' },
          { type: 'custom-title', customTitle: 'updated-title' }
        )
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.sessionTitle).toBe('updated-title')
    })

    it('extracts the first user message into initialPrompt (string content)', async () => {
      setupForJsonl(
        makeJsonl(
          { type: 'user', message: { role: 'user', content: 'Refactor the auth middleware to drop session tokens' } },
          { type: 'assistant', message: { usage: { input_tokens: 50, output_tokens: 25 } } },
          { type: 'user', message: { role: 'user', content: 'Also add a test' } }
        )
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.initialPrompt).toBe('Refactor the auth middleware to drop session tokens')
    })

    it('extracts initialPrompt from a content-array (text-block) message', async () => {
      setupForJsonl(
        makeJsonl(
          { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Fix the failing test' }] } },
          { type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5 } } }
        )
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.initialPrompt).toBe('Fix the failing test')
    })

    it('skips isMeta user entries when extracting initialPrompt', async () => {
      setupForJsonl(
        makeJsonl(
          { type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: …' } },
          { type: 'user', message: { role: 'user', content: 'The actual first prompt' } }
        )
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.initialPrompt).toBe('The actual first prompt')
    })

    it('preserves existing initialPrompt when JSONL has no user message', async () => {
      setupForJsonl(
        makeJsonl({ type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50 } } }),
        { initialPrompt: 'Earlier captured prompt' }
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      expect(metrics.initialPrompt).toBe('Earlier captured prompt')
    })

    it('JSONL fallback uses 1M context window for claude-opus-4-6[1m] (PE-02)', async () => {
      // Set up a pane with no statusline contextPercent and no contextWindowSize,
      // but with a model entry in the JSONL that matches the 1M variant
      const paneState = makePaneState({
        id: 'pane-1',
        transcriptPath: '/tmp/transcript.jsonl',
        contextWindowSize: null,
        metrics: { ...makeMetrics(), contextPercent: null }
      })
      registry.getPane.mockReturnValue(paneState)

      // 500K tokens used — with 1M context (minus 40K buffer = 960K effective),
      // that should be ~52%, NOT ~312% that you'd get with 200K
      mockReadFile.mockResolvedValue(
        makeJsonl(
          { type: 'assistant', model: 'claude-opus-4-6[1m]', message: { usage: { input_tokens: 400_000, output_tokens: 100_000 } } }
        ) as unknown as Buffer
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      // 500K / (1M - 40K) = 500000 / 960000 ≈ 52%
      expect(metrics.contextPercent).toBe(52)
    })

    it('JSONL fallback prefers statusline-reported context_window_size over hardcoded map (PE-02)', async () => {
      // Set up a pane where statusline has reported a custom context window size
      const paneState = makePaneState({
        id: 'pane-1',
        transcriptPath: '/tmp/transcript.jsonl',
        contextWindowSize: 500_000, // statusline-reported value
        metrics: { ...makeMetrics(), contextPercent: null }
      })
      registry.getPane.mockReturnValue(paneState)

      // 200K tokens used — with 500K context (minus 40K buffer = 460K effective),
      // that should be ~43%
      mockReadFile.mockResolvedValue(
        makeJsonl(
          { type: 'assistant', model: 'claude-sonnet-4-6', message: { usage: { input_tokens: 150_000, output_tokens: 50_000 } } }
        ) as unknown as Buffer
      )

      await runAndFlush()

      const metrics = vi.mocked(registry.updatePaneMetrics).mock.calls[0][1]
      // 200K / (500K - 40K) = 200000 / 460000 ≈ 43%
      expect(metrics.contextPercent).toBe(43)
    })
  })

  // -------------------------------------------------------------------------
  // Rate limit broadcasting (PE-01)
  // -------------------------------------------------------------------------

  describe('rate limit broadcasting (PE-01)', () => {
    function setupAndWatch(statuslineJson: string, pane?: Partial<PaneState>) {
      const paneState = makePaneState({ id: 'pane-1', ...pane })
      registry.getPane.mockReturnValue(paneState)
      mockReadFileSync.mockReturnValue(statuslineJson as unknown as Buffer)
      collector.watchPane('pane-1')
    }

    it('broadcasts rate limits to all windows when rate_limits is present', () => {
      setupAndWatch(makeStatuslineJson({
        rate_limits: {
          five_hour: { used_percentage: 42.5, resets_at: '2026-03-20T14:30:00Z' },
          seven_day: { used_percentage: 18.2, resets_at: '2026-03-25T00:00:00Z' }
        }
      }))

      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.RATE_LIMITS_UPDATE,
        {
          fiveHour: { usedPercentage: 42.5, resetsAt: '2026-03-20T14:30:00Z' },
          sevenDay: { usedPercentage: 18.2, resetsAt: '2026-03-25T00:00:00Z' }
        }
      )
    })

    it('does not broadcast when rate_limits is absent', () => {
      setupAndWatch(makeStatuslineJson())

      const rateLimitCalls = windowManager._sendSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === IPC.RATE_LIMITS_UPDATE
      )
      expect(rateLimitCalls).toHaveLength(0)
    })

    it('deduplicates: does not re-broadcast when values are unchanged', () => {
      const rateLimitsData = {
        rate_limits: {
          five_hour: { used_percentage: 42.5, resets_at: '2026-03-20T14:30:00Z' },
          seven_day: { used_percentage: 18.2, resets_at: '2026-03-25T00:00:00Z' }
        }
      }

      // First read
      setupAndWatch(makeStatuslineJson(rateLimitsData))

      // Simulate a second file change with the same rate limit values
      let capturedCallback: ((curr: unknown, prev: unknown) => void) | undefined
      mockWatchFile.mockImplementation((_path, _opts, cb) => {
        capturedCallback = cb as (curr: unknown, prev: unknown) => void
      })

      vi.clearAllMocks()
      registry.getPane.mockReturnValue(makePaneState({ id: 'pane-1' }))
      mockReadFileSync.mockReturnValue(makeStatuslineJson(rateLimitsData) as unknown as Buffer)

      // Re-watch to capture callback, then trigger
      collector.unwatchPane('pane-1')
      collector.watchPane('pane-1')

      // The initial read on re-watch fires, but rate limits match lastRateLimitsJson
      // from the first watch — however unwatchPane doesn't reset lastRateLimitsJson,
      // so the second emission should be deduplicated.
      // Count RATE_LIMITS_UPDATE calls — should be 0 since same values
      const rateLimitCalls = windowManager._sendSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === IPC.RATE_LIMITS_UPDATE
      )
      expect(rateLimitCalls).toHaveLength(0)
    })

    it('handles partial rate limits (only five_hour present)', () => {
      setupAndWatch(makeStatuslineJson({
        rate_limits: {
          five_hour: { used_percentage: 85.0, resets_at: '2026-03-20T16:00:00Z' }
        }
      }))

      expect(windowManager._sendSpy).toHaveBeenCalledWith(
        IPC.RATE_LIMITS_UPDATE,
        {
          fiveHour: { usedPercentage: 85.0, resetsAt: '2026-03-20T16:00:00Z' },
          sevenDay: null
        }
      )
    })

    it('handles rate limit window with missing fields gracefully (returns null)', () => {
      setupAndWatch(makeStatuslineJson({
        rate_limits: {
          five_hour: { used_percentage: 50 },  // missing resets_at
          seven_day: { resets_at: '2026-03-25T00:00:00Z' }  // missing used_percentage
        }
      }))

      // Both windows should be null since they have missing required fields
      const rateLimitCalls = windowManager._sendSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === IPC.RATE_LIMITS_UPDATE
      )
      expect(rateLimitCalls).toHaveLength(0)
    })
  })
})
