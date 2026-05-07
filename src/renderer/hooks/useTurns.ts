/**
 * useTurns — subscribes to a pane's turn projection.
 *
 * On mount, fires TURNS_GET to seed the state. After that, listens on
 * TURN_RECORDED (single-turn append), TURNS_UPDATED (full refresh), and
 * TURN_PENDING_ACTION (action-state changes). All three IPCs land on the
 * same window-scoped channel; the hook filters by paneId.
 *
 * Returns a stable shape so consumer components can `useTurns(paneId)`
 * without conditional hook calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type {
  TurnRecordedPayload,
  TurnsUpdatedPayload,
  TurnPendingActionPayload,
  TurnsGetResult
} from '../../shared/ipc-channels'
import type { Turn, TurnPendingAction } from '../../shared/types'
import { ipcInvoke, useIpcListener } from './useIpc'

export interface UseTurnsResult {
  turns: Turn[]
  pendingAction: TurnPendingAction | null
  autoCommitEnabled: boolean
  loading: boolean
  error: string | null
  /** Force a fresh TURNS_GET. Idempotent. */
  refresh: () => void
}

export function useTurns(paneId: string): UseTurnsResult {
  const [turns, setTurns] = useState<Turn[]>([])
  const [pendingAction, setPendingAction] = useState<TurnPendingAction | null>(null)
  const [autoCommitEnabled, setAutoCommitEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchTokenRef = useRef(0)

  const refresh = useCallback(() => {
    const myToken = ++fetchTokenRef.current
    setLoading(true)
    void ipcInvoke(IPC.TURNS_GET, { paneId })
      .then((raw) => {
        // Stale response from a prior pane: ignore.
        if (myToken !== fetchTokenRef.current) return
        const result = raw as TurnsGetResult
        if (result.error) {
          setError(result.error)
        } else {
          setError(null)
          setTurns(result.turns)
          setPendingAction(result.pendingAction)
          setAutoCommitEnabled(result.autoCommitEnabled)
        }
      })
      .catch((err) => {
        if (myToken !== fetchTokenRef.current) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (myToken !== fetchTokenRef.current) return
        setLoading(false)
      })
  }, [paneId])

  // Initial fetch + re-fetch when paneId changes.
  useEffect(() => {
    refresh()
  }, [refresh])

  // Single-turn append: insert at the head if not already present.
  // Note: the projection is "oldest first" but the modal renders newest
  // first, so the renderer flips the order at display time. Here we just
  // keep the canonical projection order.
  useIpcListener(IPC.TURN_RECORDED, (raw) => {
    const payload = raw as TurnRecordedPayload
    if (payload.paneId !== paneId) return
    setTurns((prev) => {
      if (prev.some((t) => t.id === payload.turn.id)) return prev
      return [...prev, payload.turn]
    })
  })

  // Full refresh broadcast: replace local state with the new projection.
  useIpcListener(IPC.TURNS_UPDATED, (raw) => {
    const payload = raw as TurnsUpdatedPayload
    if (payload.paneId !== paneId) return
    setTurns(payload.turns)
    setPendingAction(payload.pendingAction)
    setAutoCommitEnabled(payload.autoCommitEnabled)
    setLoading(false)
    setError(null)
  })

  // Pending-action transitions arrive on their own channel so we can
  // disable surfaces without re-rendering the whole turn list.
  useIpcListener(IPC.TURN_PENDING_ACTION, (raw) => {
    const payload = raw as TurnPendingActionPayload
    if (payload.paneId !== paneId) return
    setPendingAction(payload.pendingAction)
  })

  return { turns, pendingAction, autoCommitEnabled, loading, error, refresh }
}
