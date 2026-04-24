import { useEffect, useRef } from 'react'
import type { IpcChannel } from '../../shared/ipc-channels'

// ---------------------------------------------------------------------------
// useIpc — typed wrappers around window.api (contextBridge)
// ---------------------------------------------------------------------------

/**
 * Send a fire-and-forget message to the main process.
 * Stable reference — safe to call outside React effects.
 */
export function ipcSend(channel: IpcChannel, payload?: unknown): void {
  window.api.send(channel, payload)
}

/**
 * Invoke a main-process handler and return its response.
 */
export function ipcInvoke(channel: IpcChannel, payload?: unknown): Promise<unknown> {
  return window.api.invoke(channel, payload)
}

/**
 * useIpcListener — register an IPC listener for the lifetime of the component.
 *
 * Automatically registers on mount and deregisters on unmount (or when
 * channel / listener reference changes). The listener receives the typed
 * payload directly (IpcRendererEvent is stripped by the preload layer).
 *
 * @param channel  IPC channel to listen on (main → renderer direction)
 * @param listener Callback receiving the payload
 */
export function useIpcListener(
  channel: IpcChannel,
  listener: (payload: unknown) => void
): void {
  // Keep a stable ref to the listener so the effect dep array doesn't
  // re-fire on every render if the caller passes an inline function.
  const listenerRef = useRef(listener)
  listenerRef.current = listener

  useEffect(() => {
    // Test environments may render components without a window.api shim. The
    // language feature added useStrings() to many components that did not
    // previously touch IPC; falling through to a no-op keeps those tests
    // working without forcing each one to mock the IPC bridge.
    if (typeof window === 'undefined' || !window.api) return
    const stable = (payload: unknown): void => listenerRef.current(payload)
    window.api.on(channel, stable)
    return () => {
      window.api.off(channel, stable)
    }
  }, [channel])
}
