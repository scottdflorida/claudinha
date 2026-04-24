import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type {
  RepoClaudeMdReadPayload,
  RepoClaudeMdReadResult,
  RepoClaudeMdSavePayload,
  RepoClaudeMdSaveResult
} from '../../shared/ipc-channels'
import { ipcInvoke } from '../hooks/useIpc'
import { useAppConfig } from '../hooks/useAppConfig'
import { Button } from './ui/Button'
import { useStrings } from '../lib/strings'

interface ClaudeMdEditorModalProps {
  workspaceId: string
  /** Inspector groupKey for the repo. Same value the rail uses. */
  repoPath: string
  repoLabel: string
  onClose: () => void
}

/**
 * ClaudeMdEditorModal — edits `<repoRoot>/CLAUDE.md` for a repo in the Kanban
 * rail. Save commits on the base branch and, if the per-repo push checkbox is
 * checked, pushes to origin.
 *
 * Safeties:
 *   - Refuses to silently stomp external modifications. If the file has
 *     changed between open and save, shows a banner with a reload button.
 *   - Push failures are surfaced inline without discarding the commit.
 *   - Per-repo push preference persists in AppConfig.claudeMdPushDefaults
 *     so a user who always pushes only toggles once.
 */
export function ClaudeMdEditorModal({
  workspaceId,
  repoPath,
  repoLabel,
  onClose
}: ClaudeMdEditorModalProps): React.JSX.Element {
  const t = useStrings()
  const { config: appConfig, setConfig: setAppConfig } = useAppConfig()
  const [content, setContent] = useState('')
  const [expectedMtimeMs, setExpectedMtimeMs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ freshContent: string; freshMtimeMs: number } | null>(null)

  const pushDefault = appConfig.claudeMdPushDefaults?.[repoPath] ?? false
  const [pushChecked, setPushChecked] = useState(pushDefault)
  useEffect(() => {
    setPushChecked(appConfig.claudeMdPushDefaults?.[repoPath] ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load on mount (and when repoPath changes).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setSaveError(null)
    setPushError(null)
    setConflict(null)
    const payload: RepoClaudeMdReadPayload = { workspaceId, repoPath }
    ipcInvoke(IPC.REPO_CLAUDE_MD_READ, payload)
      .then((res) => {
        if (cancelled) return
        const result = res as RepoClaudeMdReadResult
        if (result.error) {
          setLoadError(result.error)
          return
        }
        setContent(result.content)
        setExpectedMtimeMs(result.mtimeMs)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, repoPath])

  useEffect(() => {
    if (!loading) textareaRef.current?.focus()
  }, [loading])

  const rememberPushPreference = useCallback(async (next: boolean) => {
    const current = appConfig.claudeMdPushDefaults ?? {}
    if (current[repoPath] === next) return
    await setAppConfig({
      claudeMdPushDefaults: { ...current, [repoPath]: next }
    })
  }, [appConfig.claudeMdPushDefaults, repoPath, setAppConfig])

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    setPushError(null)
    try {
      const payload: RepoClaudeMdSavePayload = {
        workspaceId,
        repoPath,
        content,
        expectedMtimeMs,
        push: pushChecked
      }
      const result = (await ipcInvoke(IPC.REPO_CLAUDE_MD_SAVE, payload)) as RepoClaudeMdSaveResult
      if (result.error === 'modified-externally') {
        setConflict({
          freshContent: result.freshContent ?? '',
          freshMtimeMs: result.freshMtimeMs ?? 0
        })
        return
      }
      if (result.error) {
        setSaveError(result.error)
        return
      }
      if (result.pushError) {
        setPushError(result.pushError)
        // Do NOT close — user should see that the commit succeeded but push failed.
        return
      }
      // Success — persist push preference (if flipped) and close.
      await rememberPushPreference(pushChecked)
      onClose()
    } finally {
      setSaving(false)
    }
  }, [saving, workspaceId, repoPath, content, expectedMtimeMs, pushChecked, onClose, rememberPushPreference])

  const handleReload = useCallback(() => {
    if (!conflict) return
    setContent(conflict.freshContent)
    setExpectedMtimeMs(conflict.freshMtimeMs)
    setConflict(null)
  }, [conflict])

  // ESC closes (unless saving).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saving, onClose])

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={t.claudeMdEditor.ariaLabelFmt(repoLabel)}
    >
      <div
        className="w-[720px] max-w-[92vw] max-h-[85vh] bg-surface border border-[var(--color-border-strong)] rounded-md shadow-xl flex flex-col"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-[600] text-fg-primary truncate">{t.claudeMdEditor.title}</span>
            <span className="text-[11px] text-fg-muted truncate">{repoLabel}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.claudeMdEditor.closeAria}
            className="text-fg-muted hover:text-fg-primary"
          >
            ✕
          </button>
        </div>

        {/* External-modification banner */}
        {conflict && (
          <div className="shrink-0 px-4 py-2 bg-warning-fg/10 border-b border-[var(--color-border-subtle)] flex items-center justify-between gap-3">
            <span className="text-xs text-warning-fg">
              {t.claudeMdEditor.conflictBanner}
            </span>
            <button
              type="button"
              onClick={handleReload}
              className="text-xs px-2 py-1 rounded-sm border border-[var(--color-border-subtle)] text-fg-primary hover:bg-overlay shrink-0"
            >
              {t.claudeMdEditor.reload}
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 p-3">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-fg-muted">
              {t.claudeMdEditor.loading}
            </div>
          ) : loadError ? (
            <div className="h-full flex items-center justify-center text-sm text-danger-fg">
              {loadError}
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="w-full h-full text-sm font-mono text-fg-primary bg-canvas rounded-sm p-3 border border-[var(--color-border-subtle)] outline-none focus:ring-1 focus:ring-accent resize-none"
              placeholder={t.claudeMdEditor.placeholder}
            />
          )}
        </div>

        {/* Inline errors */}
        {(saveError || pushError) && (
          <div className="shrink-0 px-4 pt-2 pb-1 text-xs text-danger-fg">
            {saveError && <div>{t.claudeMdEditor.saveFailed(saveError)}</div>}
            {pushError && <div>{t.claudeMdEditor.commitOkPushFailed(pushError)}</div>}
          </div>
        )}

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-[var(--color-border-subtle)] flex items-center justify-between gap-3">
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary select-none">
            <input
              type="checkbox"
              checked={pushChecked}
              onChange={(e) => setPushChecked(e.target.checked)}
              disabled={saving}
            />
            {t.claudeMdEditor.pushToGithub}
          </label>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={onClose}
              disabled={saving}
            >
              {t.claudeMdEditor.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={handleSave}
              disabled={loading || saving || !!loadError || !!conflict}
            >
              {saving ? t.claudeMdEditor.saving : t.claudeMdEditor.save}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
