import { vi } from 'vitest'

/**
 * Factory that creates a mock `window.api` object matching the shape exposed
 * by src/preload/index.ts via contextBridge. Call `installMockApi()` in
 * beforeEach to set `window.api`, and `uninstallMockApi()` in afterEach to
 * clean up.
 */
export function createMockApi() {
  return {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    invoke: vi.fn()
  }
}

let installed: ReturnType<typeof createMockApi> | null = null

/** Install a fresh mock api on `window.api` — call in beforeEach */
export function installMockApi(): ReturnType<typeof createMockApi> {
  installed = createMockApi()
  // Attach directly to the existing window object — do NOT replace window
  // with a spread copy, which would destroy DOM constructors (HTMLElement, etc.)
  // and break React DOM's focus management.
  ;(window as any).api = installed
  return installed
}

/** Remove mock api from window — call in afterEach */
export function uninstallMockApi(): void {
  delete (window as any).api
  installed = null
}
