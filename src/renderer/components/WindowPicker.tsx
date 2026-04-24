import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { WindowEntry } from '../../shared/ipc-channels'
import { ipcInvoke } from '../hooks/useIpc'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// WindowPicker
// ---------------------------------------------------------------------------

interface WindowPickerProps {
  paneId: string
  isOpen: boolean
  onClose: () => void
  /** Called with the selected target windowId to execute the move */
  onMoveToWindow: (targetWindowId: string) => void
  /** Called when "New Workspace" is selected — caller provides serialized buffer */
  onMoveToNewWindow: () => void
}

/**
 * WindowPicker — popover for selecting which window to move a pane to (PRD F4, B-049).
 *
 * Arrow-key nav, Enter to select, Esc to close, click-outside to dismiss.
 * Lists all open windows plus a "+ New workspace" option.
 */
export function WindowPicker({
  paneId: _paneId,
  isOpen,
  onClose,
  onMoveToWindow,
  onMoveToNewWindow
}: WindowPickerProps): React.JSX.Element | null {
  const t = useStrings()
  const [windows, setWindows] = useState<WindowEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const totalItems = windows.length + 1
  const newHiveIndex = windows.length

  // Load window list each time picker opens
  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setSelectedIndex(0)
    ipcInvoke(IPC.WINDOW_LIST)
      .then((result) => setWindows(result as WindowEntry[]))
      .catch(() => setWindows([]))
      .finally(() => setLoading(false))
  }, [isOpen])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        setSelectedIndex((i) => (i + dir + totalItems) % totalItems)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (selectedIndex === newHiveIndex) {
          onMoveToNewWindow()
        } else {
          onMoveToWindow(windows[selectedIndex].id)
        }
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose, selectedIndex, totalItems, newHiveIndex, windows, onMoveToWindow, onMoveToNewWindow])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [isOpen, onClose])

  const handleSelect = useCallback(
    (windowId: string) => { onMoveToWindow(windowId); onClose() },
    [onMoveToWindow, onClose]
  )

  const handleNewWindow = useCallback(() => {
    onMoveToNewWindow(); onClose()
  }, [onMoveToNewWindow, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={containerRef}
      className="absolute z-popover right-0 mt-1 min-w-[200px] bg-overlay border border-subtle rounded-md shadow-md py-1"
      style={{ top: '100%' }}
    >
      <div className="px-3 py-1 text-xs font-[500] text-fg-muted uppercase tracking-wide">
        {t.windowPicker.headerLabel}
      </div>

      {loading ? (
        <div className="px-3 py-1.5 text-sm text-fg-muted">{t.windowPicker.loading}</div>
      ) : (
        <>
          {windows.map((win, i) => {
            const label = win.label
            const isSelected = i === selectedIndex
            return (
              <button
                key={win.id}
                type="button"
                onClick={() => handleSelect(win.id)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`ui-btn w-full text-left px-3 h-7 text-sm flex items-center transition-colors duration-[80ms]
                  ${isSelected
                    ? 'bg-raised text-fg-primary'
                    : 'text-fg-secondary hover:bg-raised hover:text-fg-primary'
                  }`}
              >
                {label}
              </button>
            )
          })}

          {windows.length > 0 && <div className="h-px bg-border-subtle mx-2 my-1" />}

          <button
            type="button"
            onClick={handleNewWindow}
            onMouseEnter={() => setSelectedIndex(newHiveIndex)}
            className={`ui-btn w-full text-left px-3 h-7 text-sm flex items-center gap-2 transition-colors duration-[80ms]
              ${selectedIndex === newHiveIndex
                ? 'bg-raised text-fg-primary'
                : 'text-fg-secondary hover:bg-raised hover:text-fg-primary'
              }`}
          >
            <Plus size={13} />
            {t.windowPicker.newWindowOption}
          </button>
        </>
      )}
    </div>
  )
}
