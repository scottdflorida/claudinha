import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

/**
 * Root-level error boundary. If a render/lifecycle error escapes the pane,
 * show a minimal recovery UI with a Reload button instead of letting the
 * window go completely blank. This is especially important during dev:
 * an HMR-induced React reconciliation failure while a modal is open would
 * otherwise leave the window black AND uncloseable (see close-confirmation
 * flow in src/main/index.ts — a stale pendingCloseConfirm flag blocks Cmd+W).
 * A visible Reload button lets the user recover without force-quitting.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Render error:', error, info.componentStack)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="w-screen h-screen flex items-center justify-center bg-canvas text-fg-primary font-sans p-8 select-text">
        <div className="max-w-[560px] w-full flex flex-col gap-4">
          <div className="text-lg font-title">Something went wrong</div>
          <div className="text-sm text-fg-secondary">
            The window hit a render error and can&apos;t continue. Reloading this window
            usually recovers it.
          </div>
          <pre className="text-xs font-mono text-fg-muted bg-sunken border border-[var(--color-border-subtle)] rounded-md p-3 max-h-[240px] overflow-auto whitespace-pre-wrap break-words">
            {error.message}
          </pre>
          <div>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-3 py-1.5 rounded-md bg-accent text-fg-on-accent text-sm font-body-emph hover:bg-accent-hover active:bg-accent-active transition-colors duration-[80ms]"
            >
              Reload window
            </button>
          </div>
        </div>
      </div>
    )
  }
}
