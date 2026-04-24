import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type {
  CompletionPolicySetGlobalPayload,
  CompletionPolicySetWorkspacePayload
} from '../../shared/ipc-channels'
import type { CompletionPolicy, MergeStrategy } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { useStrings, type Strings } from '../lib/strings'

// ---------------------------------------------------------------------------
// Preset policies
// ---------------------------------------------------------------------------

type PolicyChoice =
  | { kind: 'ask' }
  | { kind: 'merge'; strategy: MergeStrategy }
  | { kind: 'pr'; draft: boolean }

interface MenuItem {
  label: string
  choice: PolicyChoice
}

// Choice values are stable IPC identifiers; labels are resolved at render
// time inside the component via useStrings.
const CHOICE_DESCRIPTORS: Array<{ key: keyof Strings['policyPopover']; choice: PolicyChoice }> = [
  { key: 'askManualLabel', choice: { kind: 'ask' } },
  { key: 'autoMergeRebase', choice: { kind: 'merge', strategy: 'rebase-ff' } },
  { key: 'autoMergeSquash', choice: { kind: 'merge', strategy: 'squash' } },
  { key: 'autoMergeMergeCommit', choice: { kind: 'merge', strategy: 'merge-commit' } },
  { key: 'autoPrLabel', choice: { kind: 'pr', draft: false } },
  { key: 'autoDraftPrLabel', choice: { kind: 'pr', draft: true } }
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function choiceToPolicy(choice: PolicyChoice, pruneOnMerge: boolean): CompletionPolicy {
  switch (choice.kind) {
    case 'ask':
      return { action: 'ask', mergeStrategy: 'rebase-ff', pruneOnMerge }
    case 'merge':
      return { action: 'auto-merge', mergeStrategy: choice.strategy, pruneOnMerge }
    case 'pr':
      return {
        action: choice.draft ? 'auto-draft-pr' : 'auto-pr',
        mergeStrategy: 'rebase-ff',
        pruneOnMerge
      }
  }
}

function policyLabel(policy: CompletionPolicy | null, t: Strings): string {
  if (!policy) return t.policyPopover.inheritGlobal
  switch (policy.action) {
    case 'ask':           return t.policyPopover.askManual
    case 'auto-merge':    return t.policyPopover.summaryAutoMergeFmt(policy.mergeStrategy)
    case 'auto-pr':       return t.policyPopover.summaryAutoPr
    case 'auto-draft-pr': return t.policyPopover.summaryAutoDraftPr
  }
}

// ---------------------------------------------------------------------------
// PolicyPopover
// ---------------------------------------------------------------------------

interface PolicyPopoverProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  workspacePolicy: CompletionPolicy | null
  globalPolicy: CompletionPolicy
}

type Row =
  | { type: 'header'; label: string }
  | { type: 'workspace'; item: MenuItem; index: number }
  | { type: 'global'; item: MenuItem; index: number }
  | { type: 'clear'; index: number }
  | { type: 'workspace-prune-toggle'; index: number }
  | { type: 'global-prune-toggle'; index: number }

/**
 * PolicyPopover — per-workspace and global completion policy picker.
 *
 * Opens from the pane header's policy indicator. Arrow-key nav, Enter to
 * apply, Esc to close, click-outside to dismiss.
 */
export function PolicyPopover({
  isOpen,
  onClose,
  workspaceId,
  workspacePolicy,
  globalPolicy
}: PolicyPopoverProps): React.JSX.Element | null {
  const t = useStrings()
  const CHOICES: MenuItem[] = CHOICE_DESCRIPTORS.map((d) => ({
    label: t.policyPopover[d.key] as string,
    choice: d.choice
  }))

  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const workspacePruneOnMerge = workspacePolicy?.pruneOnMerge ?? globalPolicy.pruneOnMerge
  const globalPruneOnMerge = globalPolicy.pruneOnMerge

  const rows: Row[] = []
  let idx = 0
  rows.push({ type: 'header', label: t.policyPopover.headerThisWorkspace })
  for (const item of CHOICES) rows.push({ type: 'workspace', item, index: idx++ })
  rows.push({ type: 'workspace-prune-toggle', index: idx++ })
  if (workspacePolicy !== null) rows.push({ type: 'clear', index: idx++ })
  rows.push({ type: 'header', label: t.policyPopover.headerGlobalDefault })
  for (const item of CHOICES) rows.push({ type: 'global', item, index: idx++ })
  rows.push({ type: 'global-prune-toggle', index: idx++ })

  const totalSelectable = idx

  useEffect(() => {
    if (isOpen) setSelectedIndex(0)
  }, [isOpen])

  const setWorkspacePolicy = useCallback(
    async (policy: CompletionPolicy | null): Promise<void> => {
      const payload: CompletionPolicySetWorkspacePayload = { workspaceId, policy }
      await ipcInvoke(IPC.COMPLETION_POLICY_SET_WORKSPACE, payload)
    },
    [workspaceId]
  )

  const setGlobalPolicyAsync = useCallback(
    async (policy: CompletionPolicy): Promise<void> => {
      const payload: CompletionPolicySetGlobalPayload = { policy }
      await ipcInvoke(IPC.COMPLETION_POLICY_SET_GLOBAL, payload)
    },
    []
  )

  const handleWorkspaceChoice = useCallback(
    async (choice: PolicyChoice) => {
      await setWorkspacePolicy(choiceToPolicy(choice, workspacePruneOnMerge))
      onClose()
    },
    [setWorkspacePolicy, workspacePruneOnMerge, onClose]
  )

  const handleGlobalChoice = useCallback(
    async (choice: PolicyChoice) => {
      await setGlobalPolicyAsync(choiceToPolicy(choice, globalPruneOnMerge))
      onClose()
    },
    [setGlobalPolicyAsync, globalPruneOnMerge, onClose]
  )

  const handleClearWorkspace = useCallback(async () => {
    await setWorkspacePolicy(null)
    onClose()
  }, [setWorkspacePolicy, onClose])

  const handleWorkspacePruneToggle = useCallback(async () => {
    const base = workspacePolicy ?? globalPolicy
    const next: CompletionPolicy = { ...base, pruneOnMerge: !workspacePruneOnMerge }
    await setWorkspacePolicy(next)
  }, [workspacePolicy, globalPolicy, workspacePruneOnMerge, setWorkspacePolicy])

  const handleGlobalPruneToggle = useCallback(async () => {
    const next: CompletionPolicy = { ...globalPolicy, pruneOnMerge: !globalPruneOnMerge }
    await setGlobalPolicyAsync(next)
  }, [globalPolicy, globalPruneOnMerge, setGlobalPolicyAsync])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        setSelectedIndex((i) => (i + dir + totalSelectable) % totalSelectable)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        for (const row of rows) {
          if (row.type === 'header') continue
          if ('index' in row && row.index === selectedIndex) {
            if (row.type === 'clear') void handleClearWorkspace()
            else if (row.type === 'workspace-prune-toggle') void handleWorkspacePruneToggle()
            else if (row.type === 'global-prune-toggle') void handleGlobalPruneToggle()
            else if (row.type === 'workspace') void handleWorkspaceChoice(row.item.choice)
            else if (row.type === 'global') void handleGlobalChoice(row.item.choice)
            return
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    isOpen, totalSelectable, selectedIndex, rows, onClose,
    handleClearWorkspace, handleWorkspacePruneToggle, handleGlobalPruneToggle,
    handleWorkspaceChoice, handleGlobalChoice
  ])

  // Click-outside close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={containerRef}
      className="absolute z-popover right-0 mt-1 min-w-[320px] bg-overlay border border-subtle rounded-md shadow-md py-1"
      style={{ top: '100%' }}
    >
      {/* Summary */}
      <div className="px-3 py-2 border-b border-subtle">
        <div className="text-xs text-fg-muted">
          <span>{t.policyPopover.workspaceLabel}</span>
          <span className="text-fg-secondary">{policyLabel(workspacePolicy, t)}</span>
        </div>
        <div className="text-xs text-fg-muted">
          <span>{t.policyPopover.globalLabel}</span>
          <span className="text-fg-secondary">{policyLabel(globalPolicy, t)}</span>
        </div>
      </div>

      {rows.map((row, i) => {
        if (row.type === 'header') {
          return (
            <div
              key={`h-${i}`}
              className="px-3 pt-2 pb-0.5 text-xs font-[500] text-fg-muted uppercase tracking-wide"
            >
              {row.label}
            </div>
          )
        }

        const isSelected = row.index === selectedIndex

        let label: string
        let onClick: () => void
        let icon: React.ReactNode = null

        if (row.type === 'clear') {
          label = t.policyPopover.clearOverride
          onClick = () => void handleClearWorkspace()
          icon = <RotateCcw size={12} className="text-fg-muted flex-shrink-0" />
        } else if (row.type === 'workspace-prune-toggle') {
          label = t.policyPopover.pruneOnMergeRow
          onClick = () => void handleWorkspacePruneToggle()
          icon = (
            <span className={`flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-sm border transition-colors duration-[80ms]
              ${workspacePruneOnMerge ? 'bg-accent border-accent' : 'border-subtle'}`}>
              {workspacePruneOnMerge && <Check size={9} className="text-white" />}
            </span>
          )
        } else if (row.type === 'global-prune-toggle') {
          label = t.policyPopover.pruneOnMergeRow
          onClick = () => void handleGlobalPruneToggle()
          icon = (
            <span className={`flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-sm border transition-colors duration-[80ms]
              ${globalPruneOnMerge ? 'bg-accent border-accent' : 'border-subtle'}`}>
              {globalPruneOnMerge && <Check size={9} className="text-white" />}
            </span>
          )
        } else if (row.type === 'workspace') {
          label = row.item.label
          onClick = () => void handleWorkspaceChoice(row.item.choice)
        } else {
          label = row.item.label
          onClick = () => void handleGlobalChoice(row.item.choice)
        }

        return (
          <button
            key={`r-${i}`}
            type="button"
            onClick={onClick}
            onMouseEnter={() => setSelectedIndex(row.index)}
            className={`ui-btn w-full text-left px-3 h-7 text-sm flex items-center gap-2 transition-colors duration-[80ms]
              ${isSelected
                ? 'bg-raised text-fg-primary'
                : 'text-fg-secondary hover:bg-raised hover:text-fg-primary'
              }`}
          >
            {icon}
            <span className="flex-1 truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
