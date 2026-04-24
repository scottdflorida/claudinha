import React, { useCallback, useEffect, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import { ipcInvoke } from '../hooks/useIpc'
import type { ConsentState } from '../../shared/types'
import { Dialog, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { RadioGroup } from './ui/RadioGroup'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// AnalyticsConsentDialog (B-084)
// ---------------------------------------------------------------------------

interface ConsentDialogProps {
  /** 'consent' — first-run dialog shown when consent is 'pending'.
   *  'settings' — opened from Help > Analytics… to view/change current state. */
  mode: 'consent' | 'settings'
  /** Current consent state (used in settings mode to show the selector). */
  currentConsent: ConsentState
  onClose: () => void
  onConsentChange: (state: ConsentState) => void
}

async function setConsent(state: ConsentState): Promise<void> {
  await ipcInvoke(IPC.ANALYTICS_SET_CONSENT, state)
}

// Option values are stable IPC identifiers; labels/descriptions are resolved
// at render time from the active locale.
const SETTINGS_VALUES: ConsentState[] = ['granted', 'denied']

/**
 * AnalyticsConsentDialog — analytics opt-in UI (PRD F10 / B-084).
 *
 * Two modes:
 *   - 'consent': First-run dialog. Dismissing defaults to 'denied'.
 *   - 'settings': Opened from Help > Analytics…. Shows current state with radio.
 */
export function AnalyticsConsentDialog({
  mode,
  currentConsent,
  onClose,
  onConsentChange
}: ConsentDialogProps): React.JSX.Element | null {
  const t = useStrings()
  const SETTINGS_OPTIONS = SETTINGS_VALUES.map((value) => ({
    value,
    label: value === 'granted' ? t.analyticsConsent.granted : t.analyticsConsent.denied,
    description:
      value === 'granted' ? t.analyticsConsent.grantedDescription : t.analyticsConsent.deniedDescription
  }))
  const [selected, setSelected] = useState<ConsentState>(() =>
    mode === 'consent' ? 'granted' : currentConsent
  )

  useEffect(() => {
    if (mode === 'settings') {
      setSelected(currentConsent)
    }
  }, [mode, currentConsent])

  const handleDismiss = useCallback(() => {
    if (mode === 'consent') {
      setConsent('denied').catch(() => {})
      onConsentChange('denied')
    }
    onClose()
  }, [mode, onClose, onConsentChange])

  const handleDecline = useCallback(() => {
    setConsent('denied').catch(() => {})
    onConsentChange('denied')
    onClose()
  }, [onClose, onConsentChange])

  const handleAccept = useCallback(() => {
    setConsent('granted').catch(() => {})
    onConsentChange('granted')
    onClose()
  }, [onClose, onConsentChange])

  const handleSave = useCallback(() => {
    setConsent(selected).catch(() => {})
    onConsentChange(selected)
    onClose()
  }, [selected, onClose, onConsentChange])

  if (mode === 'consent') {
    return (
      <Dialog
        title={t.analyticsConsent.titlePending}
        subtitle={t.analyticsConsent.subtitleConsent}
        size="sm"
        showClose={false}
        onClose={handleDismiss}
        footer={
          <DialogActions>
            <Button variant="ghost" onClick={handleDecline}>{t.analyticsConsent.optOut}</Button>
            <Button variant="primary" onClick={handleAccept}>{t.analyticsConsent.enableAnalytics}</Button>
          </DialogActions>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-[500] text-fg-muted uppercase tracking-wide">{t.analyticsConsent.whatIsCollected}</p>
            <ul className="flex flex-col gap-0.5 text-sm text-fg-secondary">
              <li>{t.analyticsConsent.featureUsage}</li>
              <li>{t.analyticsConsent.performanceMetrics}</li>
              <li>{t.analyticsConsent.errorReports}</li>
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-[500] text-fg-muted uppercase tracking-wide">{t.analyticsConsent.whatIsNot}</p>
            <ul className="flex flex-col gap-0.5 text-sm text-fg-secondary">
              <li>{t.analyticsConsent.codeContents}</li>
              <li>{t.analyticsConsent.filePaths}</li>
              <li>{t.analyticsConsent.apiKeys}</li>
              <li>{t.analyticsConsent.personalInfo}</li>
            </ul>
          </div>
          <p className="text-xs text-fg-muted">{t.analyticsConsent.changeLater}</p>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      title={t.analyticsConsent.titleSettings}
      subtitle={currentConsent === 'granted' ? t.analyticsConsent.subtitleOn : t.analyticsConsent.subtitleOff}
      size="sm"
      onClose={onClose}
      footer={
        <DialogActions>
          <Button variant="ghost" onClick={onClose}>{t.analyticsConsent.cancel}</Button>
          <Button variant="primary" onClick={handleSave}>{t.analyticsConsent.save}</Button>
        </DialogActions>
      }
    >
      <RadioGroup<ConsentState>
        options={SETTINGS_OPTIONS}
        value={selected}
        onChange={setSelected}
      />
    </Dialog>
  )
}
