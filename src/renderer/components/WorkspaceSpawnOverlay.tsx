import React from 'react'
import { BrandMark } from './ui/BrandMark'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// WorkspaceSpawnOverlay — covers the workspace window during the initial
// batch-spawn loop kicked off by WORKSPACE_CREATE_WITH_TERMINALS. The
// underlying Kanban + repo rail are mid-build during this window (panes
// trickle in and the rail reads "Loading repo data…"); the overlay gives the
// user one calm "we're launching your agents" surface to look at instead.
//
// Mounting/dismissal is owned by WindowShell — see its initialSpawn state.
// ---------------------------------------------------------------------------

export function WorkspaceSpawnOverlay(): React.JSX.Element {
  const t = useStrings()
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        // Semi-opaque canvas tint + light blur — mutes the half-built UI
        // beneath without hiding it entirely. Uses var() so the overlay
        // tracks the active theme.
        background: 'color-mix(in oklch, var(--color-bg-canvas) 82%, transparent)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        // Absorb clicks/keystrokes so the underlying chrome reads as
        // inactive while terminals are mid-spawn.
        pointerEvents: 'auto',
        cursor: 'wait'
      }}
    >
      <BrandMark size={96} blink />
      <div style={{ textAlign: 'center', maxWidth: 420, padding: '0 16px' }}>
        <div
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: 'var(--color-fg-primary)',
            marginBottom: 6
          }}
        >
          {t.workspaceSpawnOverlay.title}
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-fg-secondary)' }}>
          {t.workspaceSpawnOverlay.body}
        </div>
      </div>
    </div>
  )
}
