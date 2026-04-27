import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Pin, PinOff, X, Sparkles, GitMerge, GitPullRequest } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type {
  CompletionMergeAllPayload,
  CompletionMergeAllResult,
  CompletionPrAllPayload,
  CompletionPrAllResult
} from '../../shared/ipc-channels'
import type { WorkspaceSummary, ReadyPaneEntry, RepoRollup, TestHint } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { useAppConfig } from '../hooks/useAppConfig'
import { useInspector } from '../hooks/useInspector'
import { useStrings, type Strings } from '../lib/strings'

interface InspectorDrawerProps {
  workspaceId: string
  displayName: string
}

/**
 * InspectorDrawer — workspace-level summary + test hints + bulk-merge drawer.
 *
 * Two visual modes:
 *  - Floating (default): absolutely positioned overlay; panes do not reflow.
 *  - Pinned: inline flex child; parent retiles PaneGrid to share width.
 *
 * Width is clamped to 200..500; default 350. Width + open + pinned state is
 * persisted via AppConfig so every workspace window picks up the user's choice.
 *
 * Follows L-005 / L-008 / L-030 constraints:
 *  - The drawer owns no external long-lived resources; conditional content
 *    rendering inside is safe.
 *  - The drawer's own mount does NOT change PaneGrid's direct parent element,
 *    so panes are never unmounted by drawer toggles.
 *  - During pinned-mode resize, the persisted widthPx is only written on
 *    mouseup; visible width tracks the drag in local state so we don't
 *    force a firehose of APP_CONFIG_SET round-trips.
 */
export function InspectorDrawer({ workspaceId, displayName }: InspectorDrawerProps): React.JSX.Element {
  const t = useStrings()
  const { config, setConfig } = useAppConfig()
  const keeperCfg = config.inspector
  const open = keeperCfg.open
  const pinned = keeperCfg.pinned
  const persistedWidth = clamp(keeperCfg.widthPx, 200, 500)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const widthPx = dragWidth ?? persistedWidth

  const { summary, report, askingLlm, askKeeper, askError } = useInspector(open ? workspaceId : null)

  const togglePin = useCallback(() => {
    void setConfig({ inspector: { ...keeperCfg, pinned: !pinned } })
  }, [setConfig, keeperCfg, pinned])

  const close = useCallback(() => {
    void setConfig({ inspector: { ...keeperCfg, open: false } })
  }, [setConfig, keeperCfg])

  // Drag-to-resize left-edge handle. During drag we track the width locally
  // so the parent layout responds at native cadence; we only persist on
  // mouseup so we don't firehose APP_CONFIG_SET. The xterm resize observer
  // already debounces its fit() → SIGWINCH chain (L-030), so a normal drag
  // in pinned mode is fine for the panes.
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = persistedWidth
      let latest = startWidth
      const handleMove = (evt: MouseEvent): void => {
        const dx = startX - evt.clientX
        latest = clamp(startWidth + dx, 200, 500)
        setDragWidth(latest)
      }
      const handleUp = (): void => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
        setDragWidth(null)
        if (latest !== startWidth) {
          void setConfig({ inspector: { ...keeperCfg, widthPx: latest } })
        }
      }
      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [persistedWidth, setConfig, keeperCfg]
  )

  // When switching from pinned to floating or closing, clear any in-flight
  // drag state so a stale width doesn't apply after the drawer is hidden.
  useEffect(() => {
    if (!open) setDragWidth(null)
  }, [open])

  // ----- visual layout -----

  const visibleWidth = open ? widthPx : 0
  const containerStyle: React.CSSProperties = pinned
    ? { flex: `0 0 ${visibleWidth}px`, width: visibleWidth, overflow: 'hidden' }
    : {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: visibleWidth,
        overflow: 'hidden',
        zIndex: 20,
        pointerEvents: open ? 'auto' : 'none'
      }

  return (
    <aside
      aria-label={t.inspectorDrawer.title}
      aria-hidden={!open}
      style={containerStyle}
      className={`bg-surface border-l border-[var(--color-border-subtle)] shadow-lg transition-[width,flex-basis] duration-150 ease-out flex flex-col`}
    >
      {/* Left-edge resize handle (only hit-testable when open) */}
      {open && (
        <div
          onMouseDown={onResizeStart}
          title={t.inspectorDrawer.resizeTitle}
          aria-label={t.inspectorDrawer.resizeAria}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            cursor: 'ew-resize',
            zIndex: 1
          }}
        />
      )}

      {open && (
        <>
          <header className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-subtle)]">
            <div className="flex flex-col">
              <span className="text-xs font-[550] text-fg-primary">{t.inspectorDrawer.title}</span>
              <span className="text-[10px] text-fg-muted">{displayName}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={togglePin}
                title={pinned ? t.inspectorDrawer.pinTooltipOn : t.inspectorDrawer.pinTooltipOff}
                aria-label={pinned ? t.inspectorDrawer.pinAriaUnpin : t.inspectorDrawer.pinAriaPin}
                className="text-fg-muted hover:text-fg-primary hover:bg-raised rounded px-1.5 py-1 transition-colors"
              >
                {pinned ? <Pin size={14} /> : <PinOff size={14} />}
              </button>
              <button
                type="button"
                onClick={close}
                title={t.inspectorDrawer.closeTooltip}
                aria-label={t.inspectorDrawer.closeAria}
                className="text-fg-muted hover:text-fg-primary hover:bg-raised rounded px-1.5 py-1 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </header>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
            <SummaryCard summary={summary} />
            <ReadyWorkList panes={summary?.panes ?? []} />
            <BulkActions workspaceId={workspaceId} summary={summary} />
            <TestPlanCard
              hints={summary?.testHints ?? []}
              askingLlm={askingLlm}
              askError={askError}
              report={report?.markdown ?? null}
              onAskKeeper={askKeeper}
            />
          </div>
        </>
      )}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function SummaryCard({ summary }: { summary: WorkspaceSummary | null }): React.JSX.Element {
  const t = useStrings()
  if (!summary) {
    return (
      <section className="rounded border border-[var(--color-border-subtle)] bg-canvas px-3 py-3">
        <SummaryPlaceholder />
      </section>
    )
  }
  return (
    <section className="rounded border border-[var(--color-border-subtle)] bg-canvas px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-[550] text-fg-primary">{t.inspectorDrawer.summary}</h3>
        <span className="text-[10px] text-fg-muted">{formatRelativeTime(summary.generatedAt)}</span>
      </div>
      <ul className="text-xs text-fg-secondary space-y-1">
        <li>
          <strong className="text-fg-primary">{summary.totalPanes}</strong>
          {' '}{t.inspectorDrawer.paneCountFmt(summary.totalPanes).replace(/^\d+\s*/, '')}
          {' · '}
          <strong className="text-fg-primary">{summary.readyCount}</strong>
          {t.inspectorDrawer.readyToMergeSuffix}
        </li>
        <li>
          {t.inspectorDrawer.fileCountFmt(summary.totalFilesTouched)}
        </li>
        {(summary.totalLinesAdded > 0 || summary.totalLinesRemoved > 0) && (
          <li>
            <span className="text-accent">+{summary.totalLinesAdded}</span>
            {' / '}
            <span className="text-red-400">-{summary.totalLinesRemoved}</span>
            {t.inspectorDrawer.linesSuffix}
          </li>
        )}
      </ul>
      {summary.repos.length > 1 && (
        <div className="mt-2 pt-2 border-t border-[var(--color-border-subtle)]">
          <h4 className="text-[10px] uppercase tracking-wide text-fg-muted mb-1">{t.inspectorDrawer.byRepoHeader}</h4>
          <ul className="text-xs space-y-1">
            {summary.repos.map((repo) => (
              <RepoRow key={repo.repoPath} repo={repo} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function RepoRow({ repo }: { repo: RepoRollup }): React.JSX.Element {
  const t = useStrings()
  const hasLines = repo.totalLinesAdded > 0 || repo.totalLinesRemoved > 0
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-fg-primary truncate" title={repo.repoPath}>{repo.repoLabel}</span>
      <span className="text-fg-muted text-[11px] shrink-0">
        {t.inspectorDrawer.repoSummaryFmt(repo.paneCount, repo.readyCount)}
        {hasLines && (
          <>
            {' · '}
            <span className="text-accent">+{repo.totalLinesAdded}</span>
            {'/'}
            <span className="text-red-400">-{repo.totalLinesRemoved}</span>
          </>
        )}
      </span>
    </li>
  )
}

function SummaryPlaceholder(): React.JSX.Element {
  return (
    <div className="text-xs text-fg-muted">
      <div className="h-3 w-20 bg-raised rounded animate-pulse mb-2" />
      <div className="h-3 w-32 bg-raised rounded animate-pulse" />
    </div>
  )
}

function ReadyWorkList({ panes }: { panes: ReadyPaneEntry[] }): React.JSX.Element {
  const t = useStrings()
  if (panes.length === 0) {
    return (
      <section className="rounded border border-[var(--color-border-subtle)] bg-canvas px-3 py-3">
        <h3 className="text-xs font-[550] text-fg-primary mb-2">{t.inspectorDrawer.panesHeader}</h3>
        <p className="text-xs text-fg-muted">{t.inspectorDrawer.noActivePanes}</p>
      </section>
    )
  }
  return (
    <section className="rounded border border-[var(--color-border-subtle)] bg-canvas px-3 py-3">
      <h3 className="text-xs font-[550] text-fg-primary mb-2">{t.inspectorDrawer.panesHeader}</h3>
      <ul className="space-y-1.5">
        {panes.map((pane) => (
          <PaneRow key={pane.paneId} pane={pane} />
        ))}
      </ul>
    </section>
  )
}

function PaneRow({ pane }: { pane: ReadyPaneEntry }): React.JSX.Element {
  const t = useStrings()
  const statusDot = pane.isReadyToMerge
    ? 'bg-accent'
    : pane.paneStatus === 'working'
      ? 'bg-yellow-400'
      : pane.paneStatus === 'needs-input'
        ? 'bg-orange-400'
        : pane.paneStatus === 'error'
          ? 'bg-red-500'
          : 'bg-zinc-500'
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className={`inline-block w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusDot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-[500] text-fg-primary truncate" title={pane.paneName}>
            {pane.paneName}
          </span>
          {pane.isReadyToMerge && (
            <span className="text-[10px] text-accent font-[600] uppercase tracking-wide shrink-0">{t.inspectorDrawer.readyBadge}</span>
          )}
        </div>
        <div className="text-[11px] text-fg-muted">
          {pane.branchName ?? t.inspectorDrawer.noBranch}
          {pane.filesTouched > 0 ? (
            <>
              {' · '}
              {t.inspectorDrawer.fileFmt(pane.filesTouched)}
              {(pane.linesAdded > 0 || pane.linesRemoved > 0) && (
                <>
                  {' · '}
                  <span className="text-accent">+{pane.linesAdded}</span>
                  {'/'}
                  <span className="text-red-400">-{pane.linesRemoved}</span>
                </>
              )}
            </>
          ) : (
            ` · ${t.inspectorDrawer.noChanges}`
          )}
        </div>
      </div>
    </li>
  )
}

function BulkActions({ workspaceId, summary }: { workspaceId: string; summary: WorkspaceSummary | null }): React.JSX.Element {
  const t = useStrings()
  const [busy, setBusy] = useState<null | 'merge' | 'pr'>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const readyCount = summary?.readyCount ?? 0
  const disabled = readyCount === 0 || busy !== null

  const mergeAll = useCallback(async () => {
    if (disabled) return
    setBusy('merge')
    setFeedback(null)
    try {
      const payload: CompletionMergeAllPayload = {
        scope: 'workspace',
        workspaceId: workspaceId,
        strategy: 'rebase-ff'
      }
      const res = (await ipcInvoke(IPC.COMPLETION_MERGE_ALL, payload)) as CompletionMergeAllResult
      if (res.error) {
        setFeedback(res.error)
      } else {
        setFeedback(t.inspectorDrawer.enqueuedFmt(res.enqueued))
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [disabled, workspaceId])

  const prAll = useCallback(async () => {
    if (disabled) return
    setBusy('pr')
    setFeedback(null)
    try {
      const payload: CompletionPrAllPayload = {
        scope: 'workspace',
        workspaceId: workspaceId,
        draft: false
      }
      const res = (await ipcInvoke(IPC.COMPLETION_PR_ALL, payload)) as CompletionPrAllResult
      if (res.error) {
        setFeedback(res.error)
      } else {
        setFeedback(t.inspectorDrawer.startedPrsFmt(res.enqueued))
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [disabled, workspaceId])

  return (
    <section className="rounded border border-[var(--color-border-subtle)] bg-canvas px-3 py-3 space-y-2">
      <h3 className="text-xs font-[550] text-fg-primary">{t.inspectorDrawer.bulkActions}</h3>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={mergeAll}
          disabled={disabled}
          title={readyCount === 0 ? t.inspectorDrawer.noPanesReady : t.merge.autoCommitNote}
          className="flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded bg-accent text-fg-on-accent disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
        >
          <GitMerge size={14} />
          {t.inspectorDrawer.mergeAllReadyFmt(readyCount)}
        </button>
        <button
          type="button"
          onClick={prAll}
          disabled={disabled}
          title={readyCount === 0 ? t.inspectorDrawer.noPanesReadyPr : undefined}
          className="flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded bg-raised text-fg-primary border border-[var(--color-border-subtle)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface transition"
        >
          <GitPullRequest size={14} />
          {t.inspectorDrawer.createPrAllReadyFmt(readyCount)}
        </button>
      </div>
      {feedback && <p className="text-[11px] text-fg-muted">{feedback}</p>}
    </section>
  )
}

function TestPlanCard({
  hints,
  askingLlm,
  askError,
  report,
  onAskKeeper
}: {
  hints: TestHint[]
  askingLlm: boolean
  askError: string | null
  report: string | null
  onAskKeeper: () => void | Promise<void>
}): React.JSX.Element {
  const t = useStrings()
  const grouped = useMemo(() => groupHintsByKind(hints), [hints])
  return (
    <section className="rounded border border-[var(--color-border-subtle)] bg-canvas px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-[550] text-fg-primary">{t.inspectorDrawer.testsToRun}</h3>
        <button
          type="button"
          onClick={() => void onAskKeeper()}
          disabled={askingLlm}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-raised hover:bg-surface border border-[var(--color-border-subtle)] text-fg-primary disabled:opacity-50 transition"
          title={t.inspectorDrawer.askKeeperTooltip}
        >
          <Sparkles size={12} />
          {askingLlm ? t.inspectorDrawer.asking : t.inspectorDrawer.askButton}
        </button>
      </div>

      {hints.length === 0 ? (
        <p className="text-[11px] text-fg-muted">{t.inspectorDrawer.keeperEmptyHint}</p>
      ) : (
        <div className="space-y-2">
          {grouped.changed.length > 0 && (
            <HintGroup title={t.inspectorDrawer.hintChangedTests} hints={grouped.changed} />
          )}
          {grouped.adjacent.length > 0 && (
            <HintGroup title={t.inspectorDrawer.hintAdjacentTests} hints={grouped.adjacent} />
          )}
          {grouped.scripts.length > 0 && (
            <HintGroup title={t.inspectorDrawer.hintRepoTestScripts} hints={grouped.scripts} />
          )}
        </div>
      )}

      {report && (
        <div className="mt-2 pt-2 border-t border-[var(--color-border-subtle)]">
          <h4 className="text-[10px] uppercase tracking-wide text-fg-muted mb-1">{t.inspectorDrawer.fromTheKeeper}</h4>
          <pre className="text-[11px] text-fg-secondary whitespace-pre-wrap break-words font-mono bg-canvas">
{report}
          </pre>
        </div>
      )}

      {askError && (
        <p className="text-[11px] text-red-400">{t.inspectorDrawer.keeperErrorFmt(askError)}</p>
      )}
    </section>
  )
}

function HintGroup({ title, hints }: { title: string; hints: TestHint[] }): React.JSX.Element {
  return (
    <div>
      <h4 className="text-[10px] uppercase tracking-wide text-fg-muted mb-1">{title}</h4>
      <ul className="space-y-1">
        {hints.map((hint, i) => (
          <li key={`${hint.kind}-${i}`} className="text-[11px] text-fg-secondary">
            {hint.command ? (
              <code className="font-mono text-fg-primary">{hint.command}</code>
            ) : (
              hint.label
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}

function groupHintsByKind(hints: TestHint[]): {
  changed: TestHint[]
  adjacent: TestHint[]
  scripts: TestHint[]
} {
  const changed: TestHint[] = []
  const adjacent: TestHint[] = []
  const scripts: TestHint[] = []
  for (const hint of hints) {
    if (hint.kind === 'changed-test-file') changed.push(hint)
    else if (hint.kind === 'adjacent-test-file') adjacent.push(hint)
    else scripts.push(hint)
  }
  return { changed, adjacent, scripts }
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 5_000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}
