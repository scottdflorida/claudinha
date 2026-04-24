import { IPC } from '../../shared/ipc-channels'
import { ipcInvoke } from '../hooks/useIpc'
import { GITHUB_ISSUES_URL } from './constants'

/**
 * Opens the project's GitHub "new issue" page in the user's default browser.
 * Used by the Submit Feedback button and the Cmd/Ctrl+Shift+I shortcut.
 */
export async function openFeedbackUrl(): Promise<void> {
  try {
    await ipcInvoke(IPC.OPEN_EXTERNAL, { url: GITHUB_ISSUES_URL })
  } catch {
    // Best effort — failure to launch the browser is not surfaced in the UI.
  }
}
