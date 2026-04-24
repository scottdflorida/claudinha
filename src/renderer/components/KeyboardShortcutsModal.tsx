import React from 'react'
import { Dialog, DialogCancel } from './ui/Dialog'
import { useStrings } from '../lib/strings'

interface KeyboardShortcutsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps): React.JSX.Element | null {
  const t = useStrings()
  if (!isOpen) return null

  const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
  const mod = isMac ? '⌘⇧' : 'Ctrl⇧'

  const shortcuts: Array<{ label: string; keys: string }> = [
    { label: t.emptyState.backToClaudinha, keys: `${mod}P` },
    { label: t.keyboardShortcuts.newTerminal, keys: `${mod}N` },
    { label: t.keyboardShortcuts.closeTerminal, keys: `${mod}W` },
    { label: t.keyboardShortcuts.moveTerminal, keys: `${mod}M` },
    { label: t.keyboardShortcuts.prevTerminal, keys: `${mod}[` },
    { label: t.keyboardShortcuts.nextTerminal, keys: `${mod}]` },
    { label: t.keyboardShortcuts.showShortcuts, keys: `${mod}1–9` },
    { label: t.keyboardShortcuts.toggleViewMode, keys: `${mod}K` },
    { label: t.keyboardShortcuts.submitFeedback, keys: `${mod}I` }
  ]

  return (
    <Dialog
      title={t.keyboardShortcuts.title}
      size="sm"
      onClose={onClose}
      footer={<DialogCancel onClick={onClose}>{t.keyboardShortcuts.close}</DialogCancel>}
    >
      <ul className="flex flex-col gap-2">
        {shortcuts.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4">
            <span className="text-sm text-fg-secondary">{s.label}</span>
            <kbd className="text-[10px] font-mono text-fg-muted bg-raised px-1 py-px rounded tabular-nums leading-none shrink-0">
              {s.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
