import React from 'react'
import { Dialog, DialogCancel, DialogActions } from './ui/Dialog'
import { Button } from './ui/Button'
import { useStrings } from '../lib/strings'

interface Props {
  message: string
  onRetry: () => void
  onClose: () => void
}

export function CompletionErrorModal({ message, onRetry, onClose }: Props): React.JSX.Element {
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
