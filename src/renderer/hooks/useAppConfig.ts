import { useCallback, useContext, useEffect, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { AppConfigChangedPayload } from '../../shared/ipc-channels'
import type { AppConfig } from '../../shared/types'
import { DEFAULT_APP_CONFIG } from '../../shared/types'
import { ipcInvoke, useIpcListener } from './useIpc'
import { getAppConfigContext } from './useAppConfigProvider'

/**
 * useAppConfig — React hook for reading and writing the app-wide config.
 *
 * If inside <AppConfigProvider>, uses the centralized context and single listener.
 * Otherwise, falls back to the old behavior (direct listener per hook).
 *
 * The hook seeds with `DEFAULT_APP_CONFIG` so consumers never see `null`
 * during the initial IPC round-trip.
 */
export function useAppConfig(): {
  config: AppConfig
  loaded: boolean
  setConfig: (patch: Partial<AppConfig>) => Promise<void>
  resetConfig: () => Promise<void>
} {
  // Try to get config from context if available
  const AppConfigContext = getAppConfigContext()
  const ctxValue = useContext(AppConfigContext)

  if (ctxValue) {
    // Inside AppConfigProvider, use the centralized state
    return ctxValue
  }

  // Fallback: standalone behavior (one listener per hook)
  const [config, setConfigState] = useState<AppConfig>(DEFAULT_APP_CONFIG)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // Test environments often render components without setting up
    // window.api. Stay on DEFAULT_APP_CONFIG instead of crashing the consumer.
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

  useIpcListener(IPC.APP_CONFIG_CHANGED, (payload: unknown) => {
    const { config: next } = payload as AppConfigChangedPayload
    setConfigState(next)
  })

  const setConfig = useCallback(async (patch: Partial<AppConfig>): Promise<void> => {
    try {
      const next = (await ipcInvoke(IPC.APP_CONFIG_SET, patch)) as AppConfig
      setConfigState(next)
    } catch (err) {
      console.warn('[useAppConfig] APP_CONFIG_SET failed:', err)
    }
  }, [])

  const resetConfig = useCallback(async (): Promise<void> => {
    try {
      const next = (await ipcInvoke(IPC.APP_CONFIG_RESET)) as AppConfig
      setConfigState(next)
    } catch (err) {
      console.warn('[useAppConfig] APP_CONFIG_RESET failed:', err)
    }
  }, [])

  return { config, loaded, setConfig, resetConfig }
}
