/**
 * Global type augmentations for the renderer process.
 *
 * Declares `window.api` so renderer TypeScript code has full type safety
 * when calling the preload API exposed via contextBridge (B-007), and pulls
 * in Vite's client types for `?url`, `?raw`, and other asset queries.
 */

/// <reference types="vite/client" />

// The `export {}` makes this a module so `declare global` is a true augmentation
export {}

declare global {
  interface Window {
    api: {
      /**
       * Send a fire-and-forget message to the main process.
       * Only channels defined in IPC (renderer → main direction) are accepted.
       */
      send(channel: string, payload?: unknown): void

      /**
       * Register a listener for events from the main process.
       * Only channels defined in IPC (main → renderer direction) are accepted.
       * The listener receives the payload directly (IpcRendererEvent is stripped).
       */
      on(channel: string, listener: (payload: unknown) => void): void

      /**
       * Remove a previously registered listener.
       */
      off(channel: string, listener: (payload: unknown) => void): void

      /**
       * Invoke a main-process handler and await its response.
       * Only channels defined in INVOKE_CHANNELS are accepted.
       */
      invoke(channel: string, payload?: unknown): Promise<unknown>
    }
  }
}
