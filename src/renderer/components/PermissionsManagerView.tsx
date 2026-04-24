import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type {
  PermissionsGetEffectiveResult,
  PermissionsDefaultsResult,
  PermissionsKnownRulesResult
} from '../../shared/ipc-channels'
import type { PermissionOverrides } from '../../shared/types'
import { validatePermissionRule } from '../../shared/permission-rule'
import { ipcInvoke } from '../hooks/useIpc'
import { PermissionRemoveConfirmModal } from './PermissionRemoveConfirmModal'
import { Dialog, DialogCancel, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { SegmentedControl } from './ui/SegmentedControl'
import { TextInput } from './ui/TextInput'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// PermissionsManagerView — full-panel view for managing permission rules
// ---------------------------------------------------------------------------

interface PermissionsManagerViewProps {
  onClose: () => void
}

type ListName = 'allow' | 'deny'

interface DisplayEntry {
  value: string
  source: 'default' | 'user'
}

interface RemoveTarget {
  value: string
  source: 'default' | 'user'
  list: ListName
}

const MAX_SUGGESTIONS = 10

export function PermissionsManagerView({ onClose: _onClose }: PermissionsManagerViewProps): React.JSX.Element {
  const t = useStrings()
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [projectPath, setProjectPath] = useState('')
  const [addingPanel, setAddingPanel] = useState<ListName | null>(null)
  const [addValue, setAddValue] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const [defaults, setDefaults] = useState<{ allow: readonly string[]; deny: readonly string[] } | null>(null)
  const [overrides, setOverrides] = useState<PermissionOverrides>({
    allow: [], deny: [], removedAllow: [], removedDeny: []
  })
  const [knownRules, setKnownRules] = useState<string[]>([])

  // Scroll-indicator state per list
  const [allowHasMore, setAllowHasMore] = useState(false)
  const [denyHasMore, setDenyHasMore] = useState(false)
  const allowListRef = useRef<HTMLDivElement>(null)
  const denyListRef = useRef<HTMLDivElement>(null)

  const addInputRef = useRef<HTMLInputElement>(null)

  // Compute display lists from defaults + overrides
  const allowEntries: DisplayEntry[] = []
  const denyEntries: DisplayEntry[] = []

  if (defaults) {
    for (const a of defaults.allow) {
      if (!overrides.removedAllow.includes(a)) {
        allowEntries.push({ value: a, source: 'default' })
      }
    }
    for (const d of defaults.deny) {
      if (!overrides.removedDeny.includes(d)) {
        denyEntries.push({ value: d, source: 'default' })
      }
    }
  }
  for (const a of overrides.allow) {
    if (!allowEntries.some((e) => e.value === a)) {
      allowEntries.push({ value: a, source: 'user' })
    }
  }
  for (const d of overrides.deny) {
    if (!denyEntries.some((e) => e.value === d)) {
      denyEntries.push({ value: d, source: 'user' })
    }
  }

  // Fetch defaults once on mount
  useEffect(() => {
    ipcInvoke(IPC.PERMISSIONS_GET_DEFAULTS)
      .then((result) => {
        const r = result as PermissionsDefaultsResult
        setDefaults({ allow: r.allow, deny: r.deny })
      })
      .catch(() => setError(t.permissionsManager.failedLoadDefaults))
  }, [])

  // Fetch effective permissions when scope or project path changes
  const loadEffective = useCallback(() => {
    const payload = scope === 'project' && projectPath.trim()
      ? { scope: 'project' as const, projectPath: projectPath.trim() }
      : { scope: 'global' as const }

    ipcInvoke(IPC.PERMISSIONS_GET_EFFECTIVE, payload)
      .then((result) => {
        const r = result as PermissionsGetEffectiveResult
        setOverrides(r.overrides)
        setError(null)
      })
      .catch(() => setError(t.permissionsManager.failedLoadPermissions))
  }, [scope, projectPath])

  useEffect(() => {
    loadEffective()
  }, [loadEffective])

  // Fetch the known-rules library on mount and refresh after each save
  const loadKnownRules = useCallback(() => {
    ipcInvoke(IPC.PERMISSIONS_GET_KNOWN_RULES)
      .then((result) => {
        const r = result as PermissionsKnownRulesResult
        setKnownRules(r.rules)
      })
      .catch(() => {
        // Non-fatal — autocomplete just becomes empty
      })
  }, [])

  useEffect(() => {
    loadKnownRules()
  }, [loadKnownRules])

  // Scroll indicator tracking
  const updateAllowScroll = useCallback(() => {
    const el = allowListRef.current
    if (!el) return
    setAllowHasMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
  }, [])

  const updateDenyScroll = useCallback(() => {
    const el = denyListRef.current
    if (!el) return
    setDenyHasMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
  }, [])

  useEffect(() => {
    const el = allowListRef.current
    if (!el) return
    updateAllowScroll()
    el.addEventListener('scroll', updateAllowScroll)
    return () => el.removeEventListener('scroll', updateAllowScroll)
  }, [updateAllowScroll, allowEntries.length])

  useEffect(() => {
    const el = denyListRef.current
    if (!el) return
    updateDenyScroll()
    el.addEventListener('scroll', updateDenyScroll)
    return () => el.removeEventListener('scroll', updateDenyScroll)
  }, [updateDenyScroll, denyEntries.length])

  // Save overrides to main process and refresh the known-rules library
  const saveOverrides = useCallback((newOverrides: PermissionOverrides) => {
    const payload = {
      scope,
      projectPath: scope === 'project' ? projectPath.trim() : undefined,
      overrides: newOverrides
    }
    ipcInvoke(IPC.PERMISSIONS_SET_SCOPE, payload)
      .then(() => loadKnownRules())
      .catch(() => setError(t.permissionsManager.failedSavePermissions))
    setOverrides(newOverrides)
  }, [scope, projectPath, loadKnownRules])

  // Move an entry to the other list
  const handleMove = useCallback((entry: DisplayEntry, fromList: ListName) => {
    const toList: ListName = fromList === 'allow' ? 'deny' : 'allow'
    const next: PermissionOverrides = {
      allow: [...overrides.allow],
      deny: [...overrides.deny],
      removedAllow: [...overrides.removedAllow],
      removedDeny: [...overrides.removedDeny]
    }

    if (fromList === 'allow') {
      if (entry.source === 'default') {
        if (!next.removedAllow.includes(entry.value)) next.removedAllow.push(entry.value)
      } else {
        next.allow = next.allow.filter((x) => x !== entry.value)
      }
    } else {
      if (entry.source === 'default') {
        if (!next.removedDeny.includes(entry.value)) next.removedDeny.push(entry.value)
      } else {
        next.deny = next.deny.filter((x) => x !== entry.value)
      }
    }

    const isDefaultOnDest = toList === 'allow'
      ? defaults?.allow.includes(entry.value) ?? false
      : defaults?.deny.includes(entry.value) ?? false
    const removedKey = toList === 'allow' ? 'removedAllow' : 'removedDeny'

    if (isDefaultOnDest && next[removedKey].includes(entry.value)) {
      next[removedKey] = next[removedKey].filter((x) => x !== entry.value)
    } else {
      const targetUserList = toList === 'allow' ? 'allow' : 'deny'
      if (!next[targetUserList].includes(entry.value)) {
        next[targetUserList] = [...next[targetUserList], entry.value]
      }
    }

    saveOverrides(next)
  }, [overrides, defaults, saveOverrides])

  // Commit a new entry to the active panel's list
  const handleNewCommit = useCallback((rawValue: string) => {
    const result = validatePermissionRule(rawValue)
    if (!result.valid || !result.normalized) {
      setAddError(result.error ?? t.permissionsManager.invalidRule)
      return
    }
    const v = result.normalized
    const targetList: ListName = addingPanel ?? 'allow'

    const next: PermissionOverrides = {
      allow: [...overrides.allow],
      deny: [...overrides.deny],
      removedAllow: [...overrides.removedAllow],
      removedDeny: [...overrides.removedDeny]
    }

    if (targetList === 'allow') {
      if (next.removedAllow.includes(v)) {
        next.removedAllow = next.removedAllow.filter((x) => x !== v)
      } else if (!next.allow.includes(v) && !(defaults?.allow.includes(v) ?? false)) {
        next.allow = [...next.allow, v]
      }
    } else {
      if (next.removedDeny.includes(v)) {
        next.removedDeny = next.removedDeny.filter((x) => x !== v)
      } else if (!next.deny.includes(v) && !(defaults?.deny.includes(v) ?? false)) {
        next.deny = [...next.deny, v]
      }
    }

    saveOverrides(next)
    setAddingPanel(null)
    setAddValue('')
    setAddError(null)
    setSuggestionIndex(0)
  }, [addingPanel, overrides, defaults, saveOverrides])

  // Apply a remove (after the confirmation modal returns)
  const handleRemoveConfirmed = useCallback(() => {
    if (!removeTarget) return
    const next: PermissionOverrides = {
      allow: [...overrides.allow],
      deny: [...overrides.deny],
      removedAllow: [...overrides.removedAllow],
      removedDeny: [...overrides.removedDeny]
    }

    if (removeTarget.list === 'allow') {
      if (removeTarget.source === 'default') {
        if (!next.removedAllow.includes(removeTarget.value)) next.removedAllow.push(removeTarget.value)
      } else {
        next.allow = next.allow.filter((x) => x !== removeTarget.value)
      }
    } else {
      if (removeTarget.source === 'default') {
        if (!next.removedDeny.includes(removeTarget.value)) next.removedDeny.push(removeTarget.value)
      } else {
        next.deny = next.deny.filter((x) => x !== removeTarget.value)
      }
    }

    saveOverrides(next)
    setRemoveTarget(null)
  }, [removeTarget, overrides, saveOverrides])

  // Reset (executes after confirmation)
  const handleReset = useCallback(() => {
    const payload = {
      scope,
      projectPath: scope === 'project' ? projectPath.trim() : undefined
    }
    ipcInvoke(IPC.PERMISSIONS_RESET_SCOPE, payload)
      .then(() => {
        loadEffective()
        loadKnownRules()
      })
      .catch(() => setError(t.permissionsManager.failedResetPermissions))
    setShowResetConfirm(false)
  }, [scope, projectPath, loadEffective, loadKnownRules])

  // Browse for project path
  const handleBrowse = useCallback(async () => {
    try {
      const result = await ipcInvoke(IPC.FOLDER_BROWSE)
      if (result) setProjectPath(result as string)
    } catch {
      setError(t.permissionsManager.failedFolderPicker)
    }
  }, [])

  // Autocomplete suggestions
  const presentRules = useMemo(() => {
    const set = new Set<string>()
    for (const e of allowEntries) set.add(e.value)
    for (const e of denyEntries) set.add(e.value)
    return set
  }, [allowEntries, denyEntries])

  const suggestions = useMemo<string[]>(() => {
    if (addingPanel === null) return []
    const q = addValue.trim().toLowerCase()
    const pool = knownRules.filter((r) => !presentRules.has(r))
    if (!q) return pool.slice(0, MAX_SUGGESTIONS)
    return pool
      .filter((r) => r.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
  }, [addingPanel, addValue, knownRules, presentRules])

  // Clamp suggestion index when the suggestion list changes
  useEffect(() => {
    if (suggestionIndex >= suggestions.length) {
      setSuggestionIndex(suggestions.length === 0 ? 0 : suggestions.length - 1)
    }
  }, [suggestions.length, suggestionIndex])

  // ---------------------------------------------------------------------------
  // Render a single allow/deny panel
  // ---------------------------------------------------------------------------
  const renderList = (list: ListName, entries: DisplayEntry[]) => {
    const isAdding = addingPanel === list
    const listRef = list === 'allow' ? allowListRef : denyListRef
    const hasMore = list === 'allow' ? allowHasMore : denyHasMore
    const livePreview = addValue.trim() ? validatePermissionRule(addValue) : null

    return (
      <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded border border-[var(--color-border-subtle)] overflow-hidden">
        {/* Section header */}
        <div className="flex items-center justify-between px-3 py-2 bg-raised border-b border-[var(--color-border-subtle)] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-[600] uppercase tracking-wide text-fg-secondary">
              {list === 'allow' ? t.permissionsManager.listAllow : t.permissionsManager.listDeny}
            </span>
            <span className="bg-overlay text-fg-muted text-xs px-1.5 py-0.5 rounded tabular-nums">
              {entries.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus size={13} />}
            disabled={isAdding}
            onClick={() => {
              setAddingPanel(list)
              setAddValue('')
              setAddError(null)
              setSuggestionIndex(0)
              setTimeout(() => addInputRef.current?.focus(), 0)
            }}
          >
            {t.permissionsManager.addButton}
          </Button>
        </div>

        {/* Entry list — flex-1 fills remaining height of the panel */}
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto relative"
        >
          {entries.length === 0 && !isAdding && (
            <p className="px-3 py-3 text-xs text-fg-subtle italic">{t.permissionsManager.noEntries}</p>
          )}

          {entries.map((entry) => (
            <div
              key={`${entry.value}-${entry.source}`}
              className="group flex items-center gap-2 px-3 py-1.5 hover:bg-raised"
            >
              <span className="flex-1 min-w-0 text-xs text-fg-primary truncate">
                {entry.value}
                <span className="text-fg-subtle ml-1.5">({entry.source})</span>
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-[80ms] shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleMove(entry, list)}
                  className="h-6 px-2 text-xs hover:!bg-overlay"
                >
                  {list === 'allow' ? t.permissionsManager.moveToDeny : t.permissionsManager.moveToAllow}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  destructive
                  onClick={() => setRemoveTarget({ value: entry.value, source: entry.source, list })}
                  className="h-6 px-2 text-xs"
                >
                  {t.permissionsManager.removeAction}
                </Button>
              </div>
            </div>
          ))}

          {/* Inline add form */}
          {isAdding && (
            <div className="px-3 py-2 border-t border-[var(--color-border-subtle)]">
              <input
                ref={addInputRef}
                type="text"
                value={addValue}
                onChange={(e) => { setAddValue(e.target.value); setAddError(null); setSuggestionIndex(0) }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setAddingPanel(null); setAddValue(''); setAddError(null) }
                  if (e.key === 'Enter') { e.preventDefault(); handleNewCommit(suggestions[suggestionIndex] ?? addValue) }
                  if (e.key === 'ArrowDown') { e.preventDefault(); if (suggestions.length > 0) setSuggestionIndex((i) => (i + 1) % suggestions.length) }
                  if (e.key === 'ArrowUp') { e.preventDefault(); if (suggestions.length > 0) setSuggestionIndex((i) => (i - 1 + suggestions.length) % suggestions.length) }
                  if (e.key === 'Tab' && suggestions.length > 0) { e.preventDefault(); setAddValue(suggestions[suggestionIndex] ?? '') }
                }}
                placeholder={list === 'allow' ? t.permissionsManager.addPlaceholderAllow : t.permissionsManager.addPlaceholderDeny}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-transparent text-xs text-fg-primary outline-none placeholder-fg-subtle"
              />

              {addError && (
                <p className="text-xs text-danger-fg mt-1">{addError}</p>
              )}
              {!addError && livePreview?.valid && livePreview.autoFixed && (
                <p className="text-xs text-fg-subtle mt-1 italic">{t.permissionsManager.autoFixHint(livePreview.normalized)}</p>
              )}
              {!addError && livePreview && !livePreview.valid && (
                <p className="text-xs text-danger-fg mt-1">{livePreview.error}</p>
              )}

              {suggestions.length > 0 && (
                <div className="mt-1 rounded border border-[var(--color-border-subtle)] bg-sunken max-h-[160px] overflow-y-auto">
                  {suggestions.map((s, i) => (
                    <div
                      key={s}
                      onClick={() => handleNewCommit(s)}
                      onMouseEnter={() => setSuggestionIndex(i)}
                      className={`px-2 py-1 text-xs cursor-pointer truncate ${
                        i === suggestionIndex
                          ? 'bg-raised text-fg-primary'
                          : 'text-fg-muted hover:bg-raised hover:text-fg-primary'
                      }`}
                    >
                      {s}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 mt-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!addValue.trim()}
                  onClick={() => handleNewCommit(addValue)}
                >
                  {t.permissionsManager.addButton}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setAddingPanel(null); setAddValue(''); setAddError(null) }}
                >
                  {t.permissionsManager.cancelButton}
                </Button>
              </div>
            </div>
          )}

          {/* Scroll-more indicator */}
          {hasMore && (
            <div
              className="sticky bottom-0 h-7 pointer-events-none flex items-end justify-center pb-1"
              style={{ background: 'linear-gradient(transparent, var(--color-bg-canvas))' }}
            >
              <span className="text-fg-subtle text-xs">↓</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">

      {/* Header */}
      <div className="shrink-0">
        <h2 className="text-lg font-[600] text-fg-primary">{t.permissionsManager.title}</h2>
        <p className="text-sm text-fg-secondary mt-1">
          {t.permissionsManager.description}
        </p>
      </div>

      {/* Scope selector */}
      <div className="shrink-0">
        <SegmentedControl
          label={t.permissionsManager.scopeLabel}
          options={[
            { value: 'global', label: t.permissionsManager.scopeGlobal },
            { value: 'project', label: t.permissionsManager.scopeProject }
          ]}
          value={scope}
          onChange={(v) => setScope(v as 'global' | 'project')}
        />
      </div>

      {/* Project path (only when project scope) */}
      {scope === 'project' && (
        <div className="flex flex-col gap-1.5 shrink-0">
          <label className="text-sm font-[500] text-fg-primary">{t.permissionsManager.projectPathLabel}</label>
          <div className="flex items-center gap-2">
            <TextInput
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder={t.permissionsManager.projectPathPlaceholder}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="flex-1"
            />
            <Button variant="secondary" size="sm" type="button" onClick={handleBrowse}>
              {t.permissionsManager.browse}
            </Button>
          </div>
        </div>
      )}

      {/* Allow / Deny lists — flex-1 fills remaining vertical space */}
      <div className="flex gap-4 flex-1 min-h-0">
        {renderList('allow', allowEntries)}
        {renderList('deny', denyEntries)}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-danger-fg shrink-0">{error}</p>
      )}

      {/* Reset */}
      <div className="shrink-0 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          destructive
          onClick={() => setShowResetConfirm(true)}
        >
          {t.permissionsManager.resetAll}
        </Button>
      </div>

      {/* Remove confirmation modal */}
      {removeTarget && (
        <PermissionRemoveConfirmModal
          ruleValue={removeTarget.value}
          list={removeTarget.list}
          source={removeTarget.source}
          onConfirm={handleRemoveConfirmed}
          onCancel={() => setRemoveTarget(null)}
        />
      )}

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <ResetConfirmModal
          scope={scope}
          onConfirm={handleReset}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResetConfirmModal
// ---------------------------------------------------------------------------

interface ResetConfirmModalProps {
  scope: 'global' | 'project'
  onConfirm: () => void
  onCancel: () => void
}

function ResetConfirmModal({ scope, onConfirm, onCancel }: ResetConfirmModalProps): React.JSX.Element {
  const t = useStrings()
  const scopeLabel = scope === 'global' ? t.permissionsManager.scopeGlobal.toLowerCase() : t.permissionsManager.scopeProject.toLowerCase()

  return (
    <Dialog
      title={t.permissionsManager.resetTitle}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <DialogCancel onClick={onCancel}>{t.permissionsManager.resetCancel}</DialogCancel>
          <DialogActions>
            <Button variant="primary" destructive onClick={onConfirm}>{t.permissionsManager.resetConfirm}</Button>
          </DialogActions>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm text-fg-primary">
          {t.permissionsManager.resetBodyFmt(scopeLabel)}
        </p>
        <p className="text-sm text-fg-secondary">
          {t.permissionsManager.resetBodyDetail}
        </p>
      </div>
    </Dialog>
  )
}
