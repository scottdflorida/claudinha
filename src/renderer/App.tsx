import React, { useEffect, useRef, useState } from 'react'
import { IPC } from '../shared/ipc-channels'
import type { WindowInitPayload, AppConfigChangedPayload } from '../shared/ipc-channels'
import type { AppConfig } from '../shared/types'
import { WindowShell } from './components/WindowShell'
import { ManagerWindow } from './components/ManagerWindow'
import { PaneStateProvider } from './hooks/usePaneState'
import { AppConfigProvider } from './hooks/useAppConfigProvider'
import { useIpcListener, ipcSend, ipcInvoke } from './hooks/useIpc'
import { applySoundConfig } from './lib/sound'
import { migrateLegacyLocalStorage } from './lib/migrate-legacy-local-storage'

// Runs once at module load — before any component reads a claudinha:* key.
// Copies legacy claudio:* values across on first launch after the rename.
migrateLegacyLocalStorage()

/**
 * App — renderer root component.
 *
 * Listens for WINDOW_INIT, then sends RENDERER_READY to trigger the main
 * process to deliver the init payload. This determines whether this window
 * is the Claudinha Manager or a Workspace window. The workspace close
 * sequence (CLOSE_WORKSPACE_SEQUENCE_START) is handled inside WindowShell.
 */
function App(): React.JSX.Element {
  const [windowInit, setWindowInit] = useState<WindowInitPayload | null>(null)

  // Listen for WINDOW_INIT — sent by main process after RENDERER_READY
  useIpcListener(IPC.WINDOW_INIT, (payload: unknown) => {
    setWindowInit(payload as WindowInitPayload)
  })

  // Listen for app-config changes and apply them to the sound module. The
  // listener is registered on App (the root component) so it fires BEFORE
  // RENDERER_READY (see L-014), guaranteeing broadcasts aren't dropped.
  useIpcListener(IPC.APP_CONFIG_CHANGED, (payload: unknown) => {
    const { config } = payload as AppConfigChangedPayload
    applySoundConfig(config)
  })

  // Send RENDERER_READY to trigger WINDOW_INIT delivery.
  // This must fire AFTER the WINDOW_INIT listener is registered above.
  // useEffect hooks run in declaration order, so this is safe.
  const readySent = useRef(false)
  useEffect(() => {
    if (!readySent.current) {
      readySent.current = true
      ipcSend(IPC.RENDERER_READY)
    }
  }, [])

  // Bootstrap sound config from persisted AppConfig. Invoke-based so the
  // response lands in our own Promise handler rather than relying on any
  // broadcast timing (L-014).
  useEffect(() => {
    ipcInvoke(IPC.APP_CONFIG_GET)
      .then((cfg) => applySoundConfig(cfg as AppConfig))
      .catch(() => {
        /* non-fatal — sound.ts falls back to DEFAULT_APP_CONFIG */
      })
  }, [])

  // While waiting for init, show empty black screen (brief flash)
  if (!windowInit) {
    return <div className="w-screen h-screen bg-terminal-bg" />
  }

  // Wrap the entire app in AppConfigProvider so config listeners are centralized
  const innerContent =
    windowInit.windowType === 'manager' ? (
      <ManagerWindow claudeFound={windowInit.claudeFound ?? true} />
    ) : (
      // Workspace window — wrap in PaneStateProvider for pane management.
      // Thread WINDOW_INIT fields through as props: PaneStateProvider mounts
      // AFTER App has consumed WINDOW_INIT, and the main process only delivers
      // that payload once (see L-014), so an in-provider IPC listener would
      // never fire. Seed its state from props instead.
      <PaneStateProvider
        initialHiveId={windowInit.workspaceId ?? null}
        initialGlobalPolicy={windowInit.globalCompletionPolicy}
        initialHivePolicy={windowInit.workspaceCompletionPolicy ?? null}
      >
        <WindowShell
          workspaceId={windowInit.workspaceId}
          workspaceName={windowInit.workspaceName}
          workspaceType={windowInit.workspaceType}
          workspaceConstraint={windowInit.workspaceConstraint}
          terminalsToResume={windowInit.terminalsToResume}
          initialViewMode={windowInit.workspaceViewMode ?? 'kanban'}
          initialActivePaneId={windowInit.workspaceActivePaneId ?? null}
        />
      </PaneStateProvider>
    )

  return (
    <AppConfigProvider>
      <ThemeApplier />
      {innerContent}
    </AppConfigProvider>
  )
}

/**
 * ThemeApplier — drives the html[data-theme] attribute. The toggle is
 * temporarily removed and the app is locked to dark mode; the rest of the
 * theme infrastructure (AppConfig.theme, light-mode CSS) is intentionally kept
 * so the toggle can be reinstated later.
 */
function ThemeApplier(): null {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  }, [])
  return null
}

export default App
