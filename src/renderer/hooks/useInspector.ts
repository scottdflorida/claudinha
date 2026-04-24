import { useCallback, useEffect, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type {
  InspectorSummaryPayload,
  InspectorGetSummaryResult,
  InspectorAskLlmResult
} from '../../shared/ipc-channels'
import type { WorkspaceSummary, InspectorReport } from '../../shared/types'
import { ipcInvoke, useIpcListener } from './useIpc'

/**
 * useInspector — subscribe to workspace-level summary updates and drive the
 * on-demand LLM report request for a single workspace window.
 *
 * Seeds by pulling the current summary once on mount, then follows the
 * `INSPECTOR_SUMMARY` broadcast (fires only when inputs change).
 */
export function useInspector(workspaceId: string | null | undefined): {
  summary: WorkspaceSummary | null
  report: InspectorReport | null
  askingLlm: boolean
  askKeeper: () => Promise<void>
  askError: string | null
} {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null)
  const [report, setReport] = useState<InspectorReport | null>(null)
  const [askingLlm, setAskingLlm] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  // Initial pull on mount (and when the workspaceId changes) so the drawer has
  // something to show before the first 30s poll fires.
  useEffect(() => {
    if (!workspaceId) {
      setSummary(null)
      return
    }
    let cancelled = false
    ipcInvoke(IPC.INSPECTOR_GET_SUMMARY, { workspaceId })
      .then((res) => {
        if (cancelled) return
        const result = res as InspectorGetSummaryResult
        if (result.summary) setSummary(result.summary)
      })
      .catch(() => {/* non-fatal — first broadcast will seed */})
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useIpcListener(IPC.INSPECTOR_SUMMARY, (payload: unknown) => {
    const next = payload as InspectorSummaryPayload
    if (!workspaceId || next.workspaceId !== workspaceId) return
    setSummary(next)
  })

  const askKeeper = useCallback(async (): Promise<void> => {
    if (!workspaceId || askingLlm) return
    setAskingLlm(true)
    setAskError(null)
    try {
      const res = await ipcInvoke(IPC.INSPECTOR_ASK_LLM, { workspaceId })
      const result = res as InspectorAskLlmResult
      setReport(result.report)
      if (result.report.error) setAskError(result.report.error)
    } catch (err) {
      setAskError(err instanceof Error ? err.message : String(err))
    } finally {
      setAskingLlm(false)
    }
  }, [workspaceId, askingLlm])

  return { summary, report, askingLlm, askKeeper, askError }
}
