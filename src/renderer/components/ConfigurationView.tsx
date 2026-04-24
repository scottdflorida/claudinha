import React, { useCallback, useEffect, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { Model } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { useAppConfig } from '../hooks/useAppConfig'
import { useStrings } from '../lib/strings'
import type { ConsentState } from '../../main/analytics/analytics-config'
import { SegmentedControl } from './ui/SegmentedControl'
import { Button } from './ui/Button'
import { Toggle } from './ui/Toggle'

// ---------------------------------------------------------------------------
// ConfigurationView — app-wide preferences surfaced in the Manager sidebar.
// ---------------------------------------------------------------------------

type ModelChoice = 'none' | Model

// Volume slider levels — values are stable IPC identifiers, labels are
// resolved from the active locale inside the component.
const VOLUME_VALUES: { value: string; volume: number }[] = [
  { value: 'off', volume: 0 },
  { value: 'low', volume: 0.25 },
  { value: 'med', volume: 0.5 },
  { value: 'high', volume: 0.75 },
  { value: 'max', volume: 1 }
]

export function ConfigurationView(): React.JSX.Element {
  const { config, loaded, setConfig, resetConfig } = useAppConfig()
  const t = useStrings()
  const [consent, setConsent] = useState<ConsentState>('pending')

  useEffect(() => {
    let cancelled = false
    ipcInvoke(IPC.ANALYTICS_GET_CONSENT)
      .then((state) => { if (!cancelled) setConsent(state as ConsentState) })
      .catch(() => {/* non-fatal */})
    return () => { cancelled = true }
  }, [])

  const setAnalytics = useCallback((next: 'granted' | 'denied') => {
    setConsent(next)
    ipcInvoke(IPC.ANALYTICS_SET_CONSENT, next).catch(() => {})
  }, [])

  const handleReset = useCallback((): void => {
    const ok = window.confirm(t.configuration.resetConfirm)
    if (!ok) return
    void resetConfig()
  }, [resetConfig, t])

  const modelSelection: ModelChoice = config.defaultModel ?? 'none'

  const MODEL_OPTIONS: { value: ModelChoice; label: string }[] = [
    { value: 'none', label: t.configuration.modelNone },
    { value: 'opus', label: 'Opus' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku' }
  ]

  const volumeLabelFor = (id: string): string => {
    switch (id) {
      case 'off': return t.configuration.volumeMute
      case 'low': return t.configuration.volumeLow
      case 'med': return t.configuration.volumeMed
      case 'high': return t.configuration.volumeHigh
      case 'max': return t.configuration.volumeMax
      default: return id
    }
  }

  const closestVolumeId = VOLUME_VALUES.reduce((best, lvl) =>
    Math.abs(lvl.volume - config.soundVolume) < Math.abs(best.volume - config.soundVolume) ? lvl : best
  , VOLUME_VALUES[0]).value

  return (
    <div className="flex-1 min-h-0 overflow-y-auto w-full">
      <div className="px-5 py-4 max-w-2xl text-sm text-fg-secondary">
      <h1 className="text-lg font-[600] text-fg-primary mb-5">{t.configuration.title}</h1>

      {!loaded && (
        <p className="text-fg-muted italic mb-4">{t.configuration.loading}</p>
      )}

      {/* Analytics */}
      <Section title={t.configuration.sectionAnalytics}>
        <Row label={t.configuration.telemetryLabel} hint={t.configuration.telemetryHint}>
          <SegmentedControl
            size="sm"
            options={[
              { value: 'granted', label: t.configuration.on },
              { value: 'denied', label: t.configuration.off }
            ]}
            value={consent === 'granted' ? 'granted' : 'denied'}
            onChange={(v) => setAnalytics(v as 'granted' | 'denied')}
          />
        </Row>
      </Section>

      {/* Startup */}
      <Section title={t.configuration.sectionStartup}>
        <Row label={t.configuration.autoRestoreLabel} hint={t.configuration.autoRestoreHint}>
          <OnOffControl
            value={config.autoRestoreLastSession}
            onChange={(v) => void setConfig({ autoRestoreLastSession: v })}
          />
        </Row>
      </Section>

      {/* Notifications */}
      <Section title={t.configuration.sectionNotifications}>
        <Row label={t.configuration.playSoundsLabel} hint={t.configuration.playSoundsHint}>
          <OnOffControl
            value={config.soundsEnabled}
            onChange={(v) => void setConfig({ soundsEnabled: v })}
          />
        </Row>
        <Row label={t.configuration.volumeLabel} hint={`${Math.round(config.soundVolume * 100)}%`}>
          <SegmentedControl
            size="sm"
            options={VOLUME_VALUES.map((l) => ({
              value: l.value,
              label: volumeLabelFor(l.value),
              disabled: !config.soundsEnabled
            }))}
            value={closestVolumeId}
            onChange={(id) => {
              const lvl = VOLUME_VALUES.find((l) => l.value === id)
              if (lvl) void setConfig({ soundVolume: lvl.volume })
            }}
          />
        </Row>
        <Row label={t.configuration.soundOnNeedsInputLabel}>
          <OnOffControl
            value={config.soundOnNeedsInput}
            disabled={!config.soundsEnabled}
            onChange={(v) => void setConfig({ soundOnNeedsInput: v })}
          />
        </Row>
        <Row label={t.configuration.soundOnDoneLabel}>
          <OnOffControl
            value={config.soundOnDone}
            disabled={!config.soundsEnabled}
            onChange={(v) => void setConfig({ soundOnDone: v })}
          />
        </Row>
      </Section>

      {/* Panes */}
      <Section title={t.configuration.sectionPanes}>
        <Row label={t.configuration.showToolCountsLabel} hint={t.configuration.showToolCountsHint}>
          <OnOffControl
            value={config.showToolCountsBar}
            onChange={(v) => void setConfig({ showToolCountsBar: v })}
          />
        </Row>
      </Section>

      {/* Defaults */}
      <Section title={t.configuration.sectionDefaults}>
        <Row
          label={t.configuration.defaultModelShortLabel}
          hint={t.configuration.defaultModelShortHint}
        >
          <SegmentedControl
            size="sm"
            options={MODEL_OPTIONS}
            value={modelSelection}
            onChange={(v) => void setConfig({ defaultModel: v === 'none' ? null : v as Model })}
          />
        </Row>
        <Row
          label={t.configuration.defaultViewModeLabel}
          hint={t.configuration.defaultViewModeHint}
        >
          <SegmentedControl<'wall' | 'kanban'>
            size="sm"
            options={[
              { value: 'wall', label: t.configuration.viewModeWall },
              { value: 'kanban', label: t.configuration.viewModeKanban }
            ]}
            value={config.defaultViewMode ?? 'wall'}
            onChange={(v) => void setConfig({ defaultViewMode: v })}
          />
        </Row>
      </Section>

      {/* Language */}
      <Section title={t.configuration.sectionLanguage}>
        <Row label={t.configuration.sectionLanguage} hint={t.configuration.languageHint}>
          <SegmentedControl<'en' | 'pt-BR'>
            size="sm"
            options={[
              { value: 'en', label: t.configuration.languageEnglish },
              { value: 'pt-BR', label: t.configuration.languagePortuguese }
            ]}
            value={config.language}
            onChange={(v) => void setConfig({ language: v })}
          />
        </Row>
      </Section>

      {/* Reset */}
      <div className="mt-6 pt-4 border-t border-subtle">
        <Button variant="secondary" size="sm" onClick={handleReset}>
          {t.configuration.resetButton}
        </Button>
      </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mb-5 pb-4 border-b border-subtle">
      <h2 className="text-xs font-[500] text-fg-muted uppercase tracking-wide mb-3">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-fg-primary">{label}</p>
        {hint && <p className="text-xs text-fg-muted mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function OnOffControl({
  value,
  onChange,
  disabled
}: {
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return <Toggle checked={value} onChange={onChange} disabled={disabled} />
}
