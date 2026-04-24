import { vi } from 'vitest'
import type { SessionRegistry } from '../../src/main/session-registry'

export function createMockRegistry(): {
  [K in keyof SessionRegistry]: ReturnType<typeof vi.fn>
} & { getPanesForWindow: ReturnType<typeof vi.fn> } {
  return {
    generatePaneId: vi.fn(() => 'mock-pane-id'),
    registerPane: vi.fn(),
    getPane: vi.fn(),
    removePane: vi.fn(),
    getPanesForWindow: vi.fn(() => []),
    getPanesForWorkspace: vi.fn(() => []),
    movePane: vi.fn(),
    updatePaneStatus: vi.fn(),
    updatePaneMetrics: vi.fn(),
    updatePaneSessionId: vi.fn(),
    updatePaneTranscriptPath: vi.fn(),
    updatePaneContextWindowSize: vi.fn(),
    setPaneFocused: vi.fn(),
    incrementToolUsage: vi.fn(),
    updatePaneGitStatus: vi.fn(),
    updatePaneCompletionStatus: vi.fn(),
    updatePanePermissionMode: vi.fn(() => false),
    setResolvingConflict: vi.fn(),
    onNextStatusChange: vi.fn(() => () => { /* noop unsubscribe */ }),
    onAnyStatusChange: vi.fn(() => () => { /* noop unsubscribe */ }),
    getAllPanes: vi.fn(() => new Map()),
    // size and paneCount are getters — expose as plain values via writable props
    size: 0 as unknown as ReturnType<typeof vi.fn>,
    paneCount: 0 as unknown as ReturnType<typeof vi.fn>
  } as unknown as { [K in keyof SessionRegistry]: ReturnType<typeof vi.fn> } & {
    getPanesForWindow: ReturnType<typeof vi.fn>
  }
}
