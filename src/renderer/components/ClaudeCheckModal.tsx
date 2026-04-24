import React, { useCallback, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { ClaudeCheckResult } from '../../shared/ipc-channels'
import { ipcInvoke } from '../hooks/useIpc'
import { Dialog, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// ClaudeCheckModal
// ---------------------------------------------------------------------------

const INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code'
const DOCS_URL = 'https://docs.anthropic.com/en/docs/claude-code/overview'

interface ClaudeCheckModalProps {
  onResolved: () => void
}

/**
 * ClaudeCheckModal — blocking modal shown when the claude CLI is not found.
 *
 * Provides install instructions and a retry button. Does not allow the user
 * to proceed until claude is detected.
 */
export function ClaudeCheckModal({ onResolved }: ClaudeCheckModalProps): React.JSX.Element {
  const t = useStrings()
  const [checking, setChecking] = useState(false)
  const [stillMissing, setStillMissing] = useState(false)

  const handleRetry = useCallback(async () => {
    setChecking(true)
    setStillMissing(false)
    try {
      const result = await ipcInvoke(IPC.CLAUDE_CHECK) as ClaudeCheckResult
      if (result.found) {
        onResolved()
      } else {
        setStillMissing(true)
      }
    } catch {
      setStillMissing(true)
    } finally {
      setChecking(false)
    }
  }, [onResolved])

  const handleOpenDocs = useCallback(async () => {
    try {
      await ipcInvoke(IPC.OPEN_EXTERNAL, { url: DOCS_URL })
    } catch {
      // Ignore — best effort
    }
  }, [])

  return (
    <Dialog
      title={t.claudeCheckModal.title}
      subtitle={t.claudeCheckModal.subtitle}
      size="sm"
      blocking
      showClose={false}
      footer={
        <DialogActions>
          <Button
            variant="primary"
            onClick={handleRetry}
            disabled={checking}
          >
            {checking ? t.claudeCheckModal.checking : t.claudeCheckModal.retry}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-secondary">
          {t.claudeCheckModal.bodyIntro}{' '}
          <button
            onClick={handleOpenDocs}
            className="ui-btn inline-flex items-center gap-1 text-accent hover:text-accent-hover transition-colors duration-[80ms]"
          >
            {t.claudeCheckModal.bodyInstructionsLink}
            <ExternalLink size={12} />
          </button>
          {t.claudeCheckModal.bodyEnd}
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-[500] text-fg-muted uppercase tracking-wide">{t.claudeCheckModal.installCommandLabel}</span>
          <code className="block px-3 py-2 rounded bg-sunken text-sm text-fg-primary font-mono select-all border border-subtle">
            {INSTALL_COMMAND}
          </code>
        </div>

        {stillMissing && (
          <p className="text-sm text-danger-fg">
            {t.claudeCheckModal.stillMissing} <code className="font-mono">claude</code> {t.claudeCheckModal.stillMissingEnd}
          </p>
        )}
      </div>
    </Dialog>
  )
}
