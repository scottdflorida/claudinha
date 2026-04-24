import { describe, it, expect, beforeEach } from 'vitest'
import { SessionRegistry } from '../src/main/session-registry'
import type { PaneState } from '../src/shared/types'

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
    repoName: 'my-repo',
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
// Tests
// ---------------------------------------------------------------------------

describe('SessionRegistry', () => {
  let registry: SessionRegistry

  beforeEach(() => {
    registry = new SessionRegistry()
  })

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  describe('registerPane / getPane / removePane', () => {
    it('round-trip: register, get, remove', () => {
      const pane = makePaneState({ id: 'p1' })
      registry.registerPane(pane)

      expect(registry.getPane('p1')).toBe(pane)

      const removed = registry.removePane('p1')
      expect(removed).toBe(pane)
      expect(registry.getPane('p1')).toBeUndefined()
    })

    it('getPane returns undefined for unknown pane', () => {
      expect(registry.getPane('unknown')).toBeUndefined()
    })

    it('removePane returns undefined for unknown pane', () => {
      expect(registry.removePane('unknown')).toBeUndefined()
    })

    it('paneCount reflects registered panes', () => {
      expect(registry.paneCount).toBe(0)
      registry.registerPane(makePaneState({ id: 'p1' }))
      expect(registry.paneCount).toBe(1)
      registry.registerPane(makePaneState({ id: 'p2' }))
      expect(registry.paneCount).toBe(2)
      registry.removePane('p1')
      expect(registry.paneCount).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Window queries
  // -------------------------------------------------------------------------

  describe('getPanesForWindow', () => {
    it('returns only panes belonging to the given window', () => {
      registry.registerPane(makePaneState({ id: 'p1', windowId: 'win-1' }))
      registry.registerPane(makePaneState({ id: 'p2', windowId: 'win-2' }))
      registry.registerPane(makePaneState({ id: 'p3', windowId: 'win-1' }))

      const win1 = registry.getPanesForWindow('win-1')
      expect(win1.map((p) => p.id)).toEqual(['p1', 'p3'])
    })

    it('returns empty array for unknown window', () => {
      expect(registry.getPanesForWindow('unknown')).toEqual([])
    })
  })

  describe('getPanesForWorkspace', () => {
    it('returns only panes belonging to the given workspace', () => {
      registry.registerPane(makePaneState({ id: 'p1', workspaceId: 'workspace-1' }))
      registry.registerPane(makePaneState({ id: 'p2', workspaceId: 'workspace-2' }))
      registry.registerPane(makePaneState({ id: 'p3', workspaceId: 'workspace-1' }))

      const workspace1 = registry.getPanesForWorkspace('workspace-1')
      expect(workspace1.map((p) => p.id)).toEqual(['p1', 'p3'])
    })

    it('returns empty array for unknown workspace', () => {
      expect(registry.getPanesForWorkspace('unknown')).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Status updates
  // -------------------------------------------------------------------------

  describe('updatePaneStatus', () => {
    it('status change updates statusChangedAt and sets hasUnseenStatusChange for unfocused pane', () => {
      const before = Date.now()
      const pane = makePaneState({ id: 'p1', status: 'awaiting-prompt', isFocused: false })
      registry.registerPane(pane)

      const result = registry.updatePaneStatus('p1', 'working', 'hook')

      expect(result?.status).toBe('working')
      expect(result?.statusChangedAt).toBeGreaterThanOrEqual(before)
      expect(result?.hasUnseenStatusChange).toBe(true)
    })

    it('status change does not set hasUnseenStatusChange for focused pane', () => {
      const pane = makePaneState({ id: 'p1', status: 'awaiting-prompt', isFocused: true })
      registry.registerPane(pane)

      const result = registry.updatePaneStatus('p1', 'working', 'hook')

      expect(result?.hasUnseenStatusChange).toBe(false)
    })

    it('no-change call does not update statusChangedAt', () => {
      const fixedTimestamp = 12345
      const pane = makePaneState({ id: 'p1', status: 'working', statusChangedAt: fixedTimestamp })
      registry.registerPane(pane)

      const result = registry.updatePaneStatus('p1', 'working', 'hook')

      expect(result?.statusChangedAt).toBe(fixedTimestamp)
    })

    it('records the source of detection', () => {
      const pane = makePaneState({ id: 'p1', status: 'awaiting-prompt' })
      registry.registerPane(pane)

      registry.updatePaneStatus('p1', 'working', 'pty-fallback')
      expect(registry.getPane('p1')?.statusSource).toBe('pty-fallback')
    })

    it('updates activeToolName when provided', () => {
      const pane = makePaneState({ id: 'p1', status: 'awaiting-prompt' })
      registry.registerPane(pane)

      registry.updatePaneStatus('p1', 'working', 'hook', 'Read')
      expect(registry.getPane('p1')?.activeToolName).toBe('Read')
    })

    it('returns null for unknown pane', () => {
      expect(registry.updatePaneStatus('unknown', 'working', 'hook')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Tool usage
  // -------------------------------------------------------------------------

  describe('incrementToolUsage', () => {
    it('creates toolsUsed Map when null and sets count to 1', () => {
      const pane = makePaneState({ id: 'p1' })
      registry.registerPane(pane)

      registry.incrementToolUsage('p1', 'Read')

      expect(pane.metrics.toolsUsed?.get('Read')).toBe(1)
    })

    it('increments existing tool count', () => {
      const toolsUsed = new Map([['Read', 3]])
      const pane = makePaneState({ id: 'p1', metrics: { ...makeMetrics(), toolsUsed } })
      registry.registerPane(pane)

      registry.incrementToolUsage('p1', 'Read')

      expect(pane.metrics.toolsUsed?.get('Read')).toBe(4)
    })

    it('tracks multiple distinct tools independently', () => {
      const pane = makePaneState({ id: 'p1' })
      registry.registerPane(pane)

      registry.incrementToolUsage('p1', 'Read')
      registry.incrementToolUsage('p1', 'Edit')
      registry.incrementToolUsage('p1', 'Read')

      expect(pane.metrics.toolsUsed?.get('Read')).toBe(2)
      expect(pane.metrics.toolsUsed?.get('Edit')).toBe(1)
    })

    it('no-ops for unknown pane', () => {
      // Should not throw
      expect(() => registry.incrementToolUsage('unknown', 'Read')).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Window movement
  // -------------------------------------------------------------------------

  describe('movePane', () => {
    it('updates windowId and returns updated pane', () => {
      const pane = makePaneState({ id: 'p1', windowId: 'win-1' })
      registry.registerPane(pane)

      const result = registry.movePane('p1', 'win-2')

      expect(result?.windowId).toBe('win-2')
      expect(registry.getPane('p1')?.windowId).toBe('win-2')
    })

    it('returns null for unknown pane', () => {
      expect(registry.movePane('unknown', 'win-2')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Focus management
  // -------------------------------------------------------------------------

  describe('setPaneFocused', () => {
    it('clears hasUnseenStatusChange when pane gains focus', () => {
      const pane = makePaneState({ id: 'p1', hasUnseenStatusChange: true })
      registry.registerPane(pane)

      registry.setPaneFocused('p1', true)

      expect(pane.hasUnseenStatusChange).toBe(false)
    })

    it('does not clear hasUnseenStatusChange on blur', () => {
      const pane = makePaneState({ id: 'p1', hasUnseenStatusChange: true })
      registry.registerPane(pane)

      registry.setPaneFocused('p1', false)

      expect(pane.hasUnseenStatusChange).toBe(true)
    })

    it('returns null for unknown pane', () => {
      expect(registry.setPaneFocused('unknown', true)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Auxiliary updaters
  // -------------------------------------------------------------------------

  describe('updatePaneSessionId / updatePaneTranscriptPath', () => {
    it('stores session ID on pane', () => {
      registry.registerPane(makePaneState({ id: 'p1' }))
      registry.updatePaneSessionId('p1', 'sess-abc')
      expect(registry.getPane('p1')?.sessionId).toBe('sess-abc')
    })

    it('stores transcript path on pane', () => {
      registry.registerPane(makePaneState({ id: 'p1' }))
      registry.updatePaneTranscriptPath('p1', '/tmp/transcript.jsonl')
      expect(registry.getPane('p1')?.transcriptPath).toBe('/tmp/transcript.jsonl')
    })
  })
})
