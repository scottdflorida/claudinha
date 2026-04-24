import { ipcMain } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { IPC } from '../../shared/ipc-channels'

// ---------------------------------------------------------------------------
// Analytics consent and configuration (B-076)
// ---------------------------------------------------------------------------

export type ConsentState = 'granted' | 'denied' | 'pending'

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

function setConsent(state: ConsentState): void {
  store.set('analytics.consent', state)
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

  // Renderer can update consent (e.g. from Settings UI)
  ipcMain.handle(IPC.ANALYTICS_SET_CONSENT, (_event, state: ConsentState): void => {
    if (state !== 'granted' && state !== 'denied' && state !== 'pending') {
      throw new Error(`Invalid consent state: ${state}`)
    }
    setConsent(state)
  })
}

// ---------------------------------------------------------------------------
// First-launch detection
// Caller (index.ts) should show the consent dialog (B-084) when this is true.
// ---------------------------------------------------------------------------

export function isFirstLaunch(): boolean {
  return getConsent() === 'pending'
}
