import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { IPC } from '../../shared/ipc-channels'
import type { PaneDataPayload } from '../../shared/ipc-channels'
import { ipcSend, useIpcListener } from '../hooks/useIpc'
import { SCROLLBACK_LINES } from '../lib/constants'

// ---------------------------------------------------------------------------
// xterm.js theme objects — dark (§11.1) and light (§11.2)
// ---------------------------------------------------------------------------

// Theme covers only the Claudinha-specific surfaces — background, foreground,
// cursor, selection. The 16 standard ANSI colors are intentionally NOT
// overridden so xterm.js falls back to its built-in defaults, which match
// what Terminal.app and other terminals ship; Claude Code's boot critter and
// other ANSI-colored UI was designed against that conventional palette and
// looked desaturated when we retuned the codes to warm neutrals.
//
// Cursor is locked to Claudinha gold (mirrors --color-brand per theme); the
// PTY can't override it because we consume OSC 10/11/12 in the parser
// (registered after term.open() below). Retune by hand if --color-brand
// changes in globals.css.
const DARK_XTERM_THEME = {
  background:          '#121212',
  foreground:          '#F0EBE0',
  cursor:              '#E8B84B',
  cursorAccent:        '#121212',
  selectionBackground: '#3D7CFF66',
  selectionForeground: undefined
}

const LIGHT_XTERM_THEME = {
  background:          '#FBF7EE',
  foreground:          '#221E16',
  cursor:              '#B8872E',
  cursorAccent:        '#FBF7EE',
  selectionBackground: '#2568E055',
  selectionForeground: undefined
}

function getXTermTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? LIGHT_XTERM_THEME
    : DARK_XTERM_THEME
}

// ---------------------------------------------------------------------------
// Imperative handle — exposed to parent via ref (for pane:move buffer capture)
// ---------------------------------------------------------------------------

export interface XTermViewHandle {
  /** Serialize the current terminal buffer state (B-048) */
  serialize(): string
  /** Focus the terminal so keyboard input routes here */
  focus(): void
  /**
   * Force the renderer to repaint every visible row. Used by Kanban view
   * after a hidden→visible flip in case xterm's draw was throttled while the
   * pane was off-screen (L-028 family). Cheap when nothing changed.
   */
  refresh(): void
}

// ---------------------------------------------------------------------------
// XTermView
// ---------------------------------------------------------------------------

interface XTermViewProps {
  paneId: string
  /** When true, call term.focus() so keyboard input routes to this terminal */
  focused?: boolean
  /**
   * Optional serialized xterm.js buffer to restore when a pane has been moved
   * from another window (B-048). Written once on terminal mount.
   */
  initialSerializedBuffer?: string | null
  /**
   * Fires when xterm's helper textarea gains DOM focus — by user click, Tab,
   * or a programmatic term.focus() call. Parent uses this to mirror xterm's
   * real focus into React's focusedPaneId so the two cannot desynchronize
   * (the click-did-not-move-the-ring bug).
   */
  onFocusRequested?: () => void
}

/**
 * XTermView — renders an xterm.js terminal for a single pane.
 *
 * Requires @xterm/xterm/css/xterm.css to be imported at the application entry
 * point. Without it, the .xterm-viewport element will not scroll and content
 * will overflow invisibly.
 *
 * - Terminal is created once on mount and destroyed on unmount.
 * - PTY output arrives via pane:data IPC events and is written directly to
 *   the terminal (no buffering).
 * - User keyboard input is forwarded via pane:input IPC.
 * - Container resizes are detected via ResizeObserver; FitAddon.fit()
 *   recalculates cols/rows and pane:resize is sent to the PTY.
 * - SerializeAddon supports pane:move buffer capture (B-048).
 */
export const XTermView = forwardRef<XTermViewHandle, XTermViewProps>(
  function XTermView({ paneId, focused, initialSerializedBuffer, onFocusRequested }, ref) {
    const onFocusRequestedRef = useRef(onFocusRequested)
    useEffect(() => {
      onFocusRequestedRef.current = onFocusRequested
    }, [onFocusRequested])

    const containerRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const serializeAddonRef = useRef<SerializeAddon | null>(null)

    // Capture initialSerializedBuffer in a ref so the lifecycle effect can
    // read it on mount without depending on it (L-008: avoid terminal
    // recreation from prop reference identity changes).
    const initialBufferRef = useRef(initialSerializedBuffer)

    // Expose serialize(), focus(), and refresh() to parent
    useImperativeHandle(ref, () => ({
      serialize() {
        return serializeAddonRef.current?.serialize() ?? ''
      },
      focus() {
        termRef.current?.focus()
      },
      refresh() {
        const term = termRef.current
        if (!term) return
        // Refresh the entire visible region. Cheap if everything is already
        // in sync; recovers from any draw throttled while the pane was hidden.
        term.refresh(0, Math.max(0, term.rows - 1))
      }
    }))

    // ---------------------------------------------------------------------------
    // Terminal lifecycle — create once, destroy on unmount
    // ---------------------------------------------------------------------------

    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const term = new Terminal({
        scrollback: SCROLLBACK_LINES,
        theme: getXTermTheme(),
        allowTransparency: true,
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Cascadia Mono", "Courier New", monospace',
        convertEol: false
      })

      const fitAddon = new FitAddon()
      const serializeAddon = new SerializeAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(serializeAddon)
      term.open(container)

      // Lock cursor / foreground / background colors to our theme. Claude
      // Code emits OSC 12 (cursor color) on startup which would otherwise
      // override our brand-gold cursor. Returning true from the handler
      // consumes the sequence so xterm's default OSC handler never runs.
      // OSC 10 (foreground) and OSC 11 (background) are locked too so
      // future TUI updates can't desync the terminal from our chrome.
      const oscDisposables = [
        term.parser.registerOscHandler(10, () => true),
        term.parser.registerOscHandler(11, () => true),
        term.parser.registerOscHandler(12, () => true)
      ]

      termRef.current = term
      fitAddonRef.current = fitAddon
      serializeAddonRef.current = serializeAddon

      // Initial fit — setTimeout(0) lets the DOM settle so the container has
      // its real dimensions. The ResizeObserver handles all subsequent resizes.
      const initialFitTimer = setTimeout(() => {
        try {
          fitAddon.fit()
        } catch {
          // Terminal may not be fully attached yet
        }
        ipcSend(IPC.PANE_RESIZE, { paneId, cols: term.cols, rows: term.rows })

        // Restore serialized buffer for moved panes (B-048)
        if (initialBufferRef.current) {
          term.write(initialBufferRef.current)
        }

        // Signal main that this pane's pane:data listener is live. Main has
        // been buffering PTY output since spawn — flushing now delivers any
        // bytes emitted before React mounted this XTermView. Without this the
        // first pane in a multi-pane workspace loses its startup banner.
        ipcSend(IPC.PANE_READY, { paneId })
      }, 0)

      // Forward user keyboard input to the PTY
      const inputDisposable = term.onData((data) => {
        ipcSend(IPC.PANE_INPUT, { paneId, data })
      })

      // Mirror xterm's real DOM focus into React state. The helper textarea
      // is what actually receives keyboard focus; subscribing to its focus
      // event makes it the single source of truth for which pane is active,
      // so the focus ring and keyboard routing cannot desynchronize.
      const textarea = term.textarea
      const handleTextareaFocus = () => {
        onFocusRequestedRef.current?.()
      }
      textarea?.addEventListener('focus', handleTextareaFocus)

      // Copy/paste keyboard shortcuts (B-065)
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.type !== 'keydown') return true
        const isMac = navigator.platform.startsWith('Mac')
        const isCmd = isMac ? e.metaKey : e.ctrlKey

        // Cmd+C / Ctrl+C — copy selection if text is selected; otherwise pass
        // through (unselected Ctrl+C is the terminal kill signal)
        if (isCmd && e.key === 'c' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {})
          return false
        }

        // Cmd+V / Ctrl+V — paste from clipboard
        if (isCmd && e.key === 'v') {
          navigator.clipboard.readText().then((text) => {
            if (text) term.paste(text)
          }).catch(() => {})
          return false
        }

        // Cmd+A / Ctrl+A — select all terminal content
        if (isCmd && e.key === 'a') {
          term.selectAll()
          return false
        }

        return true
      })

      return () => {
        clearTimeout(initialFitTimer)
        inputDisposable.dispose()
        for (const d of oscDisposables) d.dispose()
        textarea?.removeEventListener('focus', handleTextareaFocus)
        term.dispose()
        termRef.current = null
        fitAddonRef.current = null
        serializeAddonRef.current = null
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialSerializedBuffer
    // is captured in initialBufferRef on mount. Adding it here would destroy and
    // recreate the terminal if the prop's reference identity changes.
    }, [paneId])

    // ---------------------------------------------------------------------------
    // Focus — call term.focus() when this pane becomes the active pane
    // ---------------------------------------------------------------------------

    useEffect(() => {
      if (focused) {
        termRef.current?.focus()
      }
    }, [focused])

    // ---------------------------------------------------------------------------
    // Theme — observe data-theme attribute changes and update xterm theme
    // ---------------------------------------------------------------------------

    useEffect(() => {
      const observer = new MutationObserver(() => {
        if (termRef.current) {
          termRef.current.options.theme = getXTermTheme()
        }
      })
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
      })
      return () => observer.disconnect()
    }, [])

    // ---------------------------------------------------------------------------
    // Resize — observe container, re-fit via FitAddon when size changes
    // ---------------------------------------------------------------------------

    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      let debounceId: ReturnType<typeof setTimeout> | null = null

      // Trail fit() + SIGWINCH behind a short idle window. Without this, an
      // active drag fires ResizeObserver every frame — each iteration calls
      // fitAddon.fit() (reflowing the xterm buffer) and sends PANE_RESIZE
      // (triggering SIGWINCH). Claude Code's TUI redraws message history via
      // cursor addressing on every SIGWINCH; at 60Hz its cursor math lands on
      // rows that have already been reflowed to a different width, producing
      // overlapping text and stranded SGR fragments (e.g. "[39m" with no ESC).
      // Debouncing gives Claude Code a single SIGWINCH at the final width.
      const RESIZE_DEBOUNCE_MS = 120

      const observer = new ResizeObserver(() => {
        if (debounceId !== null) clearTimeout(debounceId)
        debounceId = setTimeout(() => {
          debounceId = null
          const term = termRef.current
          const fitAddon = fitAddonRef.current
          if (!term || !fitAddon) return

          try {
            fitAddon.fit()
            ipcSend(IPC.PANE_RESIZE, { paneId, cols: term.cols, rows: term.rows })
          } catch {
            // Terminal may not be fully initialized
          }
        }, RESIZE_DEBOUNCE_MS)
      })

      observer.observe(container)
      return () => {
        if (debounceId !== null) clearTimeout(debounceId)
        observer.disconnect()
      }
    }, [paneId])

    // ---------------------------------------------------------------------------
    // Window focus recovery — refresh terminal canvas when window regains focus
    // ---------------------------------------------------------------------------

    useEffect(() => {
      const handleVisibility = (): void => {
        if (document.visibilityState !== 'visible') return
        try { termRef.current?.clearTextureAtlas() } catch {}
      }

      const handleFocus = (): void => {
        try { termRef.current?.clearTextureAtlas() } catch {}
      }

      document.addEventListener('visibilitychange', handleVisibility)
      window.addEventListener('focus', handleFocus)
      return () => {
        document.removeEventListener('visibilitychange', handleVisibility)
        window.removeEventListener('focus', handleFocus)
      }
    }, [paneId])

    // ---------------------------------------------------------------------------
    // PTY output — receive pane:data and write directly to terminal
    // ---------------------------------------------------------------------------

    useIpcListener(IPC.PANE_DATA, (payload) => {
      const { paneId: dataPaneId, data } = payload as PaneDataPayload
      if (dataPaneId !== paneId) return
      termRef.current?.write(data)
    })

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ background: '#121212' }}
      />
    )
  }
)
