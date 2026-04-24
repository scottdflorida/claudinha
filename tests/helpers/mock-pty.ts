import { vi } from 'vitest'

/**
 * Mock IPty-like object for testing PtyPool.
 *
 * The `onData` and `onExit` methods store their callbacks so tests can trigger
 * PTY output and exit events via `_triggerData()` and `_triggerExit()`.
 */
export interface MockPty {
  pid: number
  cols: number
  rows: number
  process: string
  handleFlowControl: boolean
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  onData: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  /** Trigger the stored onData callback with the given string */
  _triggerData: (data: string) => void
  /** Trigger the stored onExit callback with the given exit code and optional signal */
  _triggerExit: (exitCode: number, signal?: number) => void
}

let pidCounter = 1000

export function createMockPty(): MockPty {
  let dataCallback: ((data: string) => void) | null = null
  let exitCallback: ((e: { exitCode: number; signal: number }) => void) | null = null

  const mock: MockPty = {
    pid: pidCounter++,
    cols: 80,
    rows: 24,
    process: 'claude',
    handleFlowControl: false,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
    onData: vi.fn((cb: (data: string) => void) => {
      dataCallback = cb
      return { dispose: vi.fn() }
    }),
    onExit: vi.fn((cb: (e: { exitCode: number; signal: number }) => void) => {
      exitCallback = cb
      return { dispose: vi.fn() }
    }),
    _triggerData(data: string) {
      if (dataCallback) dataCallback(data)
    },
    _triggerExit(exitCode: number, signal?: number) {
      if (exitCallback) exitCallback({ exitCode, signal: signal ?? 0 })
    }
  }

  return mock
}
