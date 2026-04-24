import React, { useCallback, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { WorkspaceResumeTerminalResult } from '../../shared/ipc-channels'
import type { TerminalSnapshot } from '../../shared/types'
import { ipcInvoke } from '../hooks/useIpc'
import { formatTimeAgo } from '../lib/formatTimeAgo'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// PausedTerminalsPanel
// ---------------------------------------------------------------------------

interface PausedTerminalsPanelProps {
  workspaceId: string
  pausedTerminals: TerminalSnapshot[]
}

/**
 * PausedTerminalsPanel — collapsible panel within workspace windows showing
 * dormant terminals from the workspace's history.
 *
 * Collapsed: single 24px row with terminal count.
 * Expanded: scrollable list with resume action per terminal.
 * Defaults to collapsed.
 */
export function PausedTerminalsPanel({ workspaceId, pausedTerminals }: PausedTerminalsPanelProps): React.JSX.Element | null {
  const t = useStrings()
  const [expanded, setExpanded] = useState(false)
  const [resumingId, setResumingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleResume = useCallback(async (terminal: TerminalSnapshot) => {
    if (!terminal.sessionId) return
    setResumingId(terminal.paneId)
    setError(null)
    try {
      // First, remove the terminal from the dormant list on the main process
      const result = await ipcInvoke(IPC.WORKSPACE_RESUME_TERMINAL, {
        workspaceId,
        terminalSnapshotPaneId: terminal.paneId
      }) as WorkspaceResumeTerminalResult & { terminal?: { sessionId: string; worktreePath: string } }
      if (result.error) {
        setError(result.error)
        return
      }
      // Then spawn the terminal via pane:spawn in resume-session mode
      if (result.terminal) {
        const spawnResult = await ipcInvoke(IPC.PANE_SPAWN, {
          mode: 'resume-session',
          sessionId: result.terminal.sessionId,
          worktreePath: result.terminal.worktreePath,
          workspaceId
        }) as { error: string | null }
        if (spawnResult.error) {
          setError(spawnResult.error)
        }
      }
    } catch {
      setError(t.pausedTerminalsPanel.failedToTend)
    } finally {
      setResumingId(null)
    }
  }, [workspaceId])

  if (pausedTerminals.length === 0) return null

  return (
    <div
      className="shrink-0"
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        borderTop: '1px solid var(--color-border-subtle)'
      }}
    >
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        style={{
          width: '100%',
          height: 24,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 12,
          cursor: 'pointer',
          color: 'var(--color-fg-muted)',
          fontSize: 11,
          fontFamily: 'Menlo, Monaco, Cascadia Mono, Courier New, monospace',
          background: 'none',
          border: 'none',
          textAlign: 'left'
        }}
      >
        <span style={{ color: 'var(--color-fg-muted)', marginRight: 6 }}>
          {expanded ? '▾' : '▸'}
        </span>
        {t.pausedTerminalsPanel.dormantPanes(pausedTerminals.length)}
      </button>

      {/* Expanded terminal list */}
      {expanded && (
        <div
          style={{
            maxHeight: 150,
            overflowY: 'auto',
            paddingLeft: 12,
            paddingRight: 12,
            paddingBottom: 8
          }}
        >
          {pausedTerminals.map((terminal) => (
            <div
              key={terminal.paneId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 0',
                fontSize: 11,
                fontFamily: 'Menlo, Monaco, Cascadia Mono, Courier New, monospace'
              }}
            >
              <span style={{ color: 'var(--color-fg-muted)' }}>·</span>
              <span style={{ color: 'var(--color-fg-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {terminal.sessionTitle || `${terminal.repoName}/${terminal.worktreeName}`}
              </span>
              {terminal.gitStatus?.hasUncommittedChanges && (
                <span style={{ color: 'var(--color-accent)', flexShrink: 0 }}>*</span>
              )}
              {terminal.gitStatus && terminal.gitStatus.commitsAhead > 0 && (
                <span style={{ color: 'var(--color-success-fg)', opacity: 0.7, flexShrink: 0 }}>{'\u2191'}{terminal.gitStatus.commitsAhead}</span>
              )}
              <span style={{ color: 'var(--color-fg-subtle)', flexShrink: 0 }}>
                {formatTimeAgo(terminal.snapshotAt)}
              </span>
              {terminal.sessionId ? (
                <button
                  type="button"
                  onClick={() => handleResume(terminal)}
                  disabled={resumingId === terminal.paneId}
                  onMouseEnter={(e) => { if (resumingId !== terminal.paneId) e.currentTarget.style.color = 'var(--color-accent)' }}
                  onMouseLeave={(e) => { if (resumingId !== terminal.paneId) e.currentTarget.style.color = 'var(--color-fg-muted)' }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                    color: resumingId === terminal.paneId ? 'var(--color-fg-subtle)' : 'var(--color-fg-muted)',
                    cursor: resumingId === terminal.paneId ? 'default' : 'pointer',
                    flexShrink: 0
                  }}
                >
                  {resumingId === terminal.paneId ? t.pausedTerminalsPanel.tending : t.pausedTerminalsPanel.tend}
                </button>
              ) : (
                <span style={{ color: 'var(--color-fg-subtle)', flexShrink: 0 }}>{t.pausedTerminalsPanel.noSession}</span>
              )}
            </div>
          ))}
          {error && (
            <div style={{ color: 'var(--color-danger-fg)', fontSize: 11, marginTop: 4 }}>
              ! {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
