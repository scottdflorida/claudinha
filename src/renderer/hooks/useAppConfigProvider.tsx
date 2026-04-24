import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { AppConfigChangedPayload } from '../../shared/ipc-channels'
import type { AppConfig } from '../../shared/types'
import { DEFAULT_APP_CONFIG } from '../../shared/types'
import { ipcInvoke, useIpcListener } from './useIpc'

interface AppConfigContextValue {
  config: AppConfig
  loaded: boolean
  setConfig: (patch: Partial<AppConfig>) => Promise<void>
  resetConfig: () => Promise<void>
}

const AppConfigContext = createContext<AppConfigContextValue | null>(null)

/**
 * AppConfigProvider — manages app-wide config state and synchronizes across windows.
 * Registers a single APP_CONFIG_CHANGED listener at the root level so each
 * component doesn't spawn its own listener (which was causing MaxListenersExceeded warnings).
 */
export function AppConfigProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [config, setConfigState] = useState<AppConfig>(DEFAULT_APP_CONFIG)
  const [loaded, setLoaded] = useState(false)

  // Fetch initial config on mount
  useEffect(() => {
    // Test environments may not stub window.api. Stay on DEFAULT_APP_CONFIG
    // rather than throw and force every test that mounts the provider to
    // wire up the IPC bridge.
    if (typeof window === 'undefined' || !window.api) {
      setLoaded(true)
      return
    }
    let cancelled = false
    ipcInvoke(IPC.APP_CONFIG_GET)
      .then((cfg) => {
        if (cancelled) return
        setConfigState(cfg as AppConfig)
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Listen for config changes from other windows — single listener for the entire app
  useIpcListener(IPC.APP_CONFIG_CHANGED, (payload: unknown) => {
    const { config: next } = payload as AppConfigChangedPayload
    setConfigState(next)
  })

  const setConfig = useCallback(async (patch: Partial<AppConfig>): Promise<void> => {
    try {
      const next = (await ipcInvoke(IPC.APP_CONFIG_SET, patch)) as AppConfig
      setConfigState(next)
    } catch (err) {
      console.warn('[AppConfigProvider] APP_CONFIG_SET failed:', err)
    }
  }, [])

  const resetConfig = useCallback(async (): Promise<void> => {
    try {
      const next = (await ipcInvoke(IPC.APP_CONFIG_RESET)) as AppConfig
      setConfigState(next)
    } catch (err) {
      console.warn('[AppConfigProvider] APP_CONFIG_RESET failed:', err)
    }
  }, [])

  return (
    <AppConfigContext.Provider value={{ config, loaded, setConfig, resetConfig }}>
      {children}
    </AppConfigContext.Provider>
  )
}

/**
 * Get the AppConfigContext for useAppConfig fallback.
 * Internal use only.
 */
export function getAppConfigContext(): React.Context<AppConfigContextValue | null> {
  return AppConfigContext
}
