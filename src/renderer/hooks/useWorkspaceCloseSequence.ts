import { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type {
  CloseSequencePaneDescriptor,
  CloseWorkspaceSequenceStartPayload,
  CloseWorkspaceSequenceResponsePayload
} from '../../shared/ipc-channels'
import { ipcSend, useIpcListener } from './useIpc'

// ---------------------------------------------------------------------------
// useWorkspaceCloseSequence — renderer-side driver for the main-process
// CLOSE_WORKSPACE_SEQUENCE_{START,ACK,RESPONSE} dance.
//
// On sequence start it also filters out panes whose resolution would bypass
// the modal, silently reports them back as "already handled" so main can
// just destroy the window at the end, and streams the remaining ones one
// at a time through `currentPane`.
// ---------------------------------------------------------------------------

export interface WorkspaceCloseSequenceState {
  /** The payload from main, or null when no sequence is active. */
  sequence: CloseWorkspaceSequenceStartPayload | null
  /** Ordered list of panes that still need user confirmation. */
  queue: CloseSequencePaneDescriptor[]
  /** Index within `queue` of the pane currently being confirmed. */
  currentIndex: number
  /** Panes that bypassed the modal — reported back to main so it knows
   *  they're already closed (or eligible for silent close). Closing the
   *  bypass panes is the caller's responsibility via onBypass. */
  bypassed: CloseSequencePaneDescriptor[]
}

export interface UseWorkspaceCloseSequence extends WorkspaceCloseSequenceState {
  /** Move to the next pane. When already at the last pane, emits 'complete'
   *  and clears the sequence. */
  advance: () => void
  /** User cancelled at any point — sequence ends, main keeps everything. */
  cancel: () => void
  /** User hit the "close all remaining without asking" escape hatch. */
  overrideAll: () => void
}

/**
 * Caller supplies the bypass resolver so this hook stays UI-agnostic. The
 * resolver receives a pane descriptor and returns either 'needs-modal'
 * (keep in the queue) or a PaneCloseAction to perform silently. The caller
 * is responsible for actually executing the bypass action on its side.
 */
export type BypassResolver = (pane: CloseSequencePaneDescriptor) =>
  | { kind: 'needs-modal' }
  | { kind: 'bypass'; action: 'keep-close' | 'prune-close' | 'close-non-worktree' }

const EMPTY_STATE: WorkspaceCloseSequenceState = {
  sequence: null,
  queue: [],
  currentIndex: 0,
  bypassed: []
}

export function useWorkspaceCloseSequence(opts: {
  resolveBypass: BypassResolver
  /** Called once per bypass pane as the sequence is received. Caller should
   *  fire the appropriate close IPC immediately so main's final destroy path
   *  doesn't race with still-alive panes. */
  onBypass: (pane: CloseSequencePaneDescriptor, action: 'keep-close' | 'prune-close' | 'close-non-worktree') => void
}): UseWorkspaceCloseSequence {
  const [state, setState] = useState<WorkspaceCloseSequenceState>(EMPTY_STATE)
  // Keep the resolver refs stable so the IPC listener doesn't rebind on
  // every render (the useIpcListener infra re-registers when deps change).
  const resolveRef = useRef(opts.resolveBypass)
  const bypassRef = useRef(opts.onBypass)
  resolveRef.current = opts.resolveBypass
  bypassRef.current = opts.onBypass

  useIpcListener(IPC.CLOSE_WORKSPACE_SEQUENCE_START, (payload: unknown) => {
    const incoming = payload as CloseWorkspaceSequenceStartPayload
    const queue: CloseSequencePaneDescriptor[] = []
    const bypassed: CloseSequencePaneDescriptor[] = []
    for (const pane of incoming.panes) {
      const decision = resolveRef.current(pane)
      if (decision.kind === 'bypass') {
        bypassed.push(pane)
        bypassRef.current(pane, decision.action)
      } else {
        queue.push(pane)
      }
    }
    setState({ sequence: incoming, queue, currentIndex: 0, bypassed })
    // Ack so main cancels its native-dialog fallback timer.
    ipcSend(IPC.CLOSE_WORKSPACE_SEQUENCE_ACK, { workspaceId: incoming.workspaceId })
    // If every pane bypassed, there's nothing to confirm — close immediately.
    if (queue.length === 0) {
      const response: CloseWorkspaceSequenceResponsePayload = {
        workspaceId: incoming.workspaceId,
        action: 'complete'
      }
      ipcSend(IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE, response)
      setState(EMPTY_STATE)
    }
  })

  const advance = useCallback(() => {
    setState((prev) => {
      if (!prev.sequence) return prev
      const next = prev.currentIndex + 1
      if (next >= prev.queue.length) {
        const response: CloseWorkspaceSequenceResponsePayload = {
          workspaceId: prev.sequence.workspaceId,
          action: 'complete'
        }
        ipcSend(IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE, response)
        return EMPTY_STATE
      }
      return { ...prev, currentIndex: next }
    })
  }, [])

  const cancel = useCallback(() => {
    setState((prev) => {
      if (prev.sequence) {
        const response: CloseWorkspaceSequenceResponsePayload = {
          workspaceId: prev.sequence.workspaceId,
          action: 'cancel'
        }
        ipcSend(IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE, response)
      }
      return EMPTY_STATE
    })
  }, [])

  const overrideAll = useCallback(() => {
    setState((prev) => {
      if (prev.sequence) {
        const response: CloseWorkspaceSequenceResponsePayload = {
          workspaceId: prev.sequence.workspaceId,
          action: 'override-all'
        }
        ipcSend(IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE, response)
      }
      return EMPTY_STATE
    })
  }, [])

  // Defensive: if the sequence ends because the host unmounted while
  // something was in flight, main should know. Using a ref to avoid the
  // effect firing every render.
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  return { ...state, advance, cancel, overrideAll }
}
