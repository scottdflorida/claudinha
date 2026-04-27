/**
 * PtyPool unit tests.
 *
 * Verifies spawn, write, resize, kill, killAll, and isAlive behaviour
 * with a fully mocked node-pty module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockPty, type MockPty } from './helpers/mock-pty'

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

let latestMockPty: MockPty

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    latestMockPty = createMockPty()
    return latestMockPty
  })
}))

import { PtyPool } from '../src/main/pty-pool'
import * as pty from 'node-pty'
import { PTY_GRACEFUL_KILL_TIMEOUT_MS } from '../src/main/constants'

const mockSpawn = vi.mocked(pty.spawn)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultSpawnOptions(overrides: Record<string, unknown> = {}) {
  return {
    paneId: 'pane-1',
    workingDirectory: '/tmp/work',
    onData: vi.fn(),
    onExit: vi.fn(),
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PtyPool', () => {
  let pool: PtyPool

  beforeEach(() => {
    vi.clearAllMocks()
    pool = new PtyPool()
  })

  // =========================================================================
  // spawn
  // =========================================================================

  describe('spawn', () => {
    it('calls pty.spawn with correct arguments (claude binary, args, cwd, merged env)', () => {
      const opts = defaultSpawnOptions({
        args: ['--resume', 'abc'],
        extraEnv: { CLAUDINHA_SOCKET_PATH: '/tmp/sock' }
      })

      pool.spawn(opts as any)

      expect(mockSpawn).toHaveBeenCalledOnce()
      const [bin, args, spawnOpts] = mockSpawn.mock.calls[0]
      expect(bin).toBe('claude')
      expect(args).toEqual(['--resume', 'abc'])
      expect((spawnOpts as any).cwd).toBe('/tmp/work')
      expect((spawnOpts as any).name).toBe('xterm-256color')
      expect((spawnOpts as any).cols).toBe(80)
      expect((spawnOpts as any).rows).toBe(24)
      // extraEnv merged into env
      expect((spawnOpts as any).env.CLAUDINHA_SOCKET_PATH).toBe('/tmp/sock')
    })

    it('passes through cols/rows when supplied (deferred-spawn path)', () => {
      pool.spawn(defaultSpawnOptions({ cols: 137, rows: 41 }) as any)
      const [, , spawnOpts] = mockSpawn.mock.calls[0]
      expect((spawnOpts as any).cols).toBe(137)
      expect((spawnOpts as any).rows).toBe(41)
    })

    it('returns { ptyId, isApiBilling } where ptyId equals the paneId', () => {
      const result = pool.spawn(defaultSpawnOptions() as any)
      expect(result.ptyId).toBe('pane-1')
    })

    it('sets isApiBilling: true when ANTHROPIC_API_KEY is in extraEnv', () => {
      const result = pool.spawn(
        defaultSpawnOptions({
          extraEnv: { ANTHROPIC_API_KEY: 'sk-ant-xxx' }
        }) as any
      )
      expect(result.isApiBilling).toBe(true)
    })

    it('sets isApiBilling: false when no API key in env', () => {
      // Ensure the real process.env does not contain the key for this test
      const saved = process.env.ANTHROPIC_API_KEY
      delete process.env.ANTHROPIC_API_KEY

      try {
        const result = pool.spawn(defaultSpawnOptions() as any)
        expect(result.isApiBilling).toBe(false)
      } finally {
        if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
      }
    })

    it('fires the onData callback when PTY emits data', () => {
      const onData = vi.fn()
      pool.spawn(defaultSpawnOptions({ onData }) as any)

      latestMockPty._triggerData('hello world')

      expect(onData).toHaveBeenCalledWith('hello world')
    })

    it('fires the onExit callback when PTY exits', () => {
      const onExit = vi.fn()
      pool.spawn(defaultSpawnOptions({ onExit }) as any)

      latestMockPty._triggerExit(0)

      expect(onExit).toHaveBeenCalledWith(0, 0)
    })
  })

  // =========================================================================
  // prepareSpawn — deferred spawn path (B-XXX cursor-row-below-input fix)
  // =========================================================================

  describe('prepareSpawn', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not call pty.spawn synchronously', () => {
      pool.prepareSpawn(defaultSpawnOptions() as any)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('returns ptyId and isApiBilling synchronously, computed from env', () => {
      const result = pool.prepareSpawn(
        defaultSpawnOptions({
          extraEnv: { ANTHROPIC_API_KEY: 'sk-ant-xxx' }
        }) as any
      )
      expect(result.ptyId).toBe('pane-1')
      expect(result.isApiBilling).toBe(true)
    })

    it('counts a pending spawn as alive', () => {
      pool.prepareSpawn(defaultSpawnOptions() as any)
      expect(pool.isAlive('pane-1')).toBe(true)
    })

    it('first resize() drains the pending entry and exec`s pty.spawn at the supplied cols/rows', () => {
      pool.prepareSpawn(defaultSpawnOptions() as any)

      pool.resize('pane-1', 137, 41)

      expect(mockSpawn).toHaveBeenCalledOnce()
      const [, , spawnOpts] = mockSpawn.mock.calls[0]
      expect((spawnOpts as any).cols).toBe(137)
      expect((spawnOpts as any).rows).toBe(41)
    })

    it('a second resize() after drain goes through pty.resize, not a re-spawn', () => {
      pool.prepareSpawn(defaultSpawnOptions() as any)

      pool.resize('pane-1', 100, 30)
      const mockPty = latestMockPty
      expect(mockSpawn).toHaveBeenCalledOnce()

      pool.resize('pane-1', 120, 35)

      expect(mockSpawn).toHaveBeenCalledOnce() // not called again
      expect(mockPty.resize).toHaveBeenCalledWith(120, 35)
    })

    it('kill() before any resize drops the pending entry without spawning', () => {
      pool.prepareSpawn(defaultSpawnOptions() as any)

      pool.kill('pane-1')

      // No spawn happened, and isAlive flips false
      expect(mockSpawn).not.toHaveBeenCalled()
      expect(pool.isAlive('pane-1')).toBe(false)

      // Advancing past the safety timer must NOT resurrect the spawn
      vi.advanceTimersByTime(60_000)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('safety timeout falls back to spawning at 80×24 if no resize ever arrives', () => {
      pool.prepareSpawn(defaultSpawnOptions() as any)

      vi.advanceTimersByTime(10_000)

      expect(mockSpawn).toHaveBeenCalledOnce()
      const [, , spawnOpts] = mockSpawn.mock.calls[0]
      expect((spawnOpts as any).cols).toBe(80)
      expect((spawnOpts as any).rows).toBe(24)
    })

    it('killAll() clears pending spawns', () => {
      pool.prepareSpawn(defaultSpawnOptions({ paneId: 'pane-a' }) as any)
      pool.prepareSpawn(defaultSpawnOptions({ paneId: 'pane-b' }) as any)

      pool.killAll()

      expect(pool.isAlive('pane-a')).toBe(false)
      expect(pool.isAlive('pane-b')).toBe(false)
      vi.advanceTimersByTime(60_000)
      expect(mockSpawn).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // write
  // =========================================================================

  describe('write', () => {
    it('calls pty.write(data) for a spawned PTY', () => {
      pool.spawn(defaultSpawnOptions() as any)
      const mockPty = latestMockPty

      pool.write('pane-1', 'ls -la\r')

      expect(mockPty.write).toHaveBeenCalledWith('ls -la\r')
    })

    it('does not throw for unknown ptyId', () => {
      expect(() => pool.write('nonexistent', 'data')).not.toThrow()
    })
  })

  // =========================================================================
  // resize
  // =========================================================================

  describe('resize', () => {
    it('calls pty.resize(cols, rows) for a spawned PTY', () => {
      pool.spawn(defaultSpawnOptions() as any)
      const mockPty = latestMockPty

      pool.resize('pane-1', 120, 40)

      expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
    })

    it('does not throw for unknown ptyId', () => {
      expect(() => pool.resize('nonexistent', 80, 24)).not.toThrow()
    })
  })

  // =========================================================================
  // kill
  // =========================================================================

  describe('kill', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('sends SIGHUP signal (on non-Windows)', () => {
      const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      try {
        pool.spawn(defaultSpawnOptions() as any)
        const mockPty = latestMockPty

        pool.kill('pane-1')

        expect(mockPty.kill).toHaveBeenCalledWith('SIGHUP')
      } finally {
        if (savedPlatform) {
          Object.defineProperty(process, 'platform', savedPlatform)
        }
      }
    })

    it('sets up force-kill timeout', () => {
      pool.spawn(defaultSpawnOptions() as any)
      const mockPty = latestMockPty

      pool.kill('pane-1')

      // Before timeout: force-kill not yet called (SIGHUP was the first call)
      expect(mockPty.kill).toHaveBeenCalledTimes(1)

      // Advance past the graceful kill timeout
      vi.advanceTimersByTime(PTY_GRACEFUL_KILL_TIMEOUT_MS)

      // After timeout: force-kill called (no signal = unconditional)
      expect(mockPty.kill).toHaveBeenCalledTimes(2)
      expect(mockPty.kill).toHaveBeenLastCalledWith()
    })

    it('after timeout, force kills the PTY', () => {
      pool.spawn(defaultSpawnOptions() as any)
      const mockPty = latestMockPty

      pool.kill('pane-1')

      vi.advanceTimersByTime(PTY_GRACEFUL_KILL_TIMEOUT_MS)

      // Second kill call should be the unconditional force-kill (no args)
      expect(mockPty.kill).toHaveBeenCalledTimes(2)
      const lastCall = mockPty.kill.mock.calls[1]
      expect(lastCall).toEqual([])
    })

    it('if PTY exits before timeout, clears the timer', () => {
      const onExit = vi.fn()
      pool.spawn(defaultSpawnOptions({ onExit }) as any)
      const mockPty = latestMockPty

      pool.kill('pane-1')

      // PTY exits gracefully before the timeout
      latestMockPty._triggerExit(0)

      // Advance past the timeout
      vi.advanceTimersByTime(PTY_GRACEFUL_KILL_TIMEOUT_MS)

      // Force-kill should NOT have been called — only the initial SIGHUP
      expect(mockPty.kill).toHaveBeenCalledTimes(1)
    })

    it('handles already-exited PTY gracefully', () => {
      pool.spawn(defaultSpawnOptions() as any)

      // Simulate PTY exit
      latestMockPty._triggerExit(0)

      // Now kill — should not throw and should remove from pool
      expect(() => pool.kill('pane-1')).not.toThrow()
      expect(pool.isAlive('pane-1')).toBe(false)
    })
  })

  // =========================================================================
  // killAll
  // =========================================================================

  describe('killAll', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('kills all spawned PTYs', () => {
      pool.spawn(defaultSpawnOptions({ paneId: 'pane-a' }) as any)
      const mockPtyA = latestMockPty

      pool.spawn(defaultSpawnOptions({ paneId: 'pane-b' }) as any)
      const mockPtyB = latestMockPty

      pool.killAll()

      expect(mockPtyA.kill).toHaveBeenCalled()
      expect(mockPtyB.kill).toHaveBeenCalled()
    })
  })

  // =========================================================================
  // isAlive
  // =========================================================================

  describe('isAlive', () => {
    it('returns true for spawned PTY', () => {
      pool.spawn(defaultSpawnOptions() as any)
      expect(pool.isAlive('pane-1')).toBe(true)
    })

    it('returns false after PTY exits', () => {
      pool.spawn(defaultSpawnOptions() as any)
      latestMockPty._triggerExit(0)
      expect(pool.isAlive('pane-1')).toBe(false)
    })

    it('returns false for unknown ptyId', () => {
      expect(pool.isAlive('nonexistent')).toBe(false)
    })
  })
})
