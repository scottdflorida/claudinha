/**
 * Global type augmentations for the renderer process.
 *
 * Declares `window.api` so renderer TypeScript code has full type safety
 * when calling the preload API exposed via contextBridge (B-007).
 */

// The `export {}` makes this a module so `declare global` is a true augmentation
export {}

// Vite asset imports — allows `import url from '*.mp3?url'`
declare module '*.mp3?url' {
  const src: string
  export default src
}

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
