import { app, ipcMain } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { IPC } from '../../shared/ipc-channels'
import type { ConsentState } from '../../shared/types'
import { makeEvent } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'
import { trackEvent } from './analytics-bus'

// ---------------------------------------------------------------------------
// Analytics consent and configuration (B-076)
//
// ConsentState lives in shared/types.ts so the renderer's consent dialog can
// import it without pulling in Electron main-process code. Re-exported here
// for backward compat with existing main-process imports.
// ---------------------------------------------------------------------------

export type { ConsentState }

interface AnalyticsStore {
  'analytics.consent': ConsentState
  'analytics.installationId': string
}

const store = new Store<AnalyticsStore>()

// ---------------------------------------------------------------------------
// Installation ID — generated once, stable across sessions, anonymous
// ---------------------------------------------------------------------------

function getOrCreateInstallationId(): string {
  const existing = store.get('analytics.installationId')
  if (existing) return existing
  const id = randomUUID()
  store.set('analytics.installationId', id)
  return id
}

// ---------------------------------------------------------------------------
// Consent state
// ---------------------------------------------------------------------------

function getConsent(): ConsentState {
  return store.get('analytics.consent', 'pending')
}

function setConsent(state: ConsentState, source: 'firstrun' | 'settings' = 'settings'): void {
  store.set('analytics.consent', state)
  // Emit `analytics_consent_set` after persistence. The bus gate
  // (`isAnalyticsEnabled`) drops the event when the user denies consent, so a
  // denial never leaks — the grant/denial distribution we observe only covers
  // users who landed on "granted".
  if (state === 'granted' || state === 'denied') {
    try {
      const ctx: EventContext = {
        installation_id: getOrCreateInstallationId(),
        app_version: app.getVersion(),
        platform: process.platform
      }
      trackEvent(
        makeEvent(ctx, {
          event_name: 'analytics_consent_set',
          consent: state,
          mode: source
        })
      )
    } catch {
      // Never throw from instrumentation
    }
  }
}

/**
 * Returns true only when the user has explicitly granted consent.
 * All analytics instrumentation must gate on this check.
 */
export function isAnalyticsEnabled(): boolean {
  return getConsent() === 'granted'
}

export function getConsentState(): ConsentState {
  return getConsent()
}

export function getInstallationId(): string {
  return getOrCreateInstallationId()
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

export function registerAnalyticsIpc(): void {
  // Renderer can read current consent state
  ipcMain.handle(IPC.ANALYTICS_GET_CONSENT, (): ConsentState => {
    return getConsent()
  })

  // Renderer can update consent (e.g. from Settings UI). The dialog-vs-settings
  // distinction comes from whether consent was still 'pending' at the time of
  // the call — pending means this is the first-run consent dialog resolving.
  ipcMain.handle(IPC.ANALYTICS_SET_CONSENT, (_event, state: ConsentState): void => {
    if (state !== 'granted' && state !== 'denied' && state !== 'pending') {
      throw new Error(`Invalid consent state: ${state}`)
    }
    const source: 'firstrun' | 'settings' = getConsent() === 'pending' ? 'firstrun' : 'settings'
    setConsent(state, source)
  })
}

// ---------------------------------------------------------------------------
// First-launch detection
// Caller (index.ts) should show the consent dialog (B-084) when this is true.
// ---------------------------------------------------------------------------

export function isFirstLaunch(): boolean {
  return getConsent() === 'pending'
}
