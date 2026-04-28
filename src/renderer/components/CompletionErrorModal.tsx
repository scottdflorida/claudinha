import React from 'react'
import { Dialog, DialogCancel, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { useStrings } from '../lib/strings'

interface Props {
  message: string
  onRetry: () => void
  onClose: () => void
  /**
   * Optional "back to ready" path. When provided, renders a third button so a
   * caller without its own clear-state surface (Kanban, where the
   * CompletionActionBar's [Close] button is suppressed) can still let the user
   * dismiss the failure without retrying. Wall mode passes nothing and keeps
   * its existing 2-button shape.
   */
  onClearState?: () => void
}

export function CompletionErrorModal({ message, onRetry, onClose, onClearState }: Props): React.JSX.Element {
  const t = useStrings()
  return (
    <Dialog
      title={t.completionErrorModal.title}
      size="md"
      onClose={onClose}
      footer={
        <>
          <DialogCancel onClick={onClose}>{t.completionErrorModal.close}</DialogCancel>
          <DialogActions>
            {onClearState && (
              <Button variant="secondary" onClick={() => { onClearState(); onClose() }}>
                {t.completionErrorModal.markResolved}
              </Button>
            )}
            <Button variant="primary" onClick={() => { onRetry(); onClose() }}>
              {t.completionErrorModal.retry}
            </Button>
          </DialogActions>
        </>
      }
    >
      <pre className="text-xs whitespace-pre-wrap break-words max-h-[40vh] overflow-auto font-mono p-3 bg-raised rounded text-fg-primary">
        {message}
      </pre>
    </Dialog>
  )
}
