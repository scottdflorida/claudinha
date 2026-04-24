// @vitest-environment jsdom
//
// PaneHeader — chromeMode='kanban' (Phase: Kanban polish, area F).
//
// Verifies: in Kanban mode the Move icon is absent and the header renders an
// inline status chip + compact metrics line. The Close icon is preserved so
// users can close the active terminal without switching back to Wall view.
// Wall mode is unchanged (the Move/Close icons still render).

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PaneHeader } from '../../src/renderer/components/PaneHeader'

function baseProps() {
  return {
    paneId: 'p1',
    repoName: 'demo',
    worktreeName: 'wt-1',
    sessionTitle: null,
    isFocused: true
  }
}

describe('PaneHeader — chromeMode="kanban"', () => {
  it('hides the Move-to-window button', () => {
    const { queryByLabelText } = render(
      <PaneHeader
        {...baseProps()}
        chromeMode="kanban"
        paneStatus="working"
        activeToolName="Bash"
      />
    )
    expect(queryByLabelText('Move to window')).toBeNull()
  })

  it('renders the Close-pane button so kanban users can close the active terminal', () => {
    const { getByLabelText } = render(
      <PaneHeader
        {...baseProps()}
        chromeMode="kanban"
        paneStatus="done"
        onClose={() => { /* no-op */ }}
      />
    )
    expect(getByLabelText('Close terminal')).toBeTruthy()
  })

  it('renders an inline status chip with the formatted activity phrase', () => {
    const { getByText } = render(
      <PaneHeader
        {...baseProps()}
        chromeMode="kanban"
        paneStatus="working"
        activeToolName="Bash"
      />
    )
    expect(getByText('Running command')).toBeTruthy()
  })

  it('renders compact metrics inline when present', () => {
    const { getByText } = render(
      <PaneHeader
        {...baseProps()}
        chromeMode="kanban"
        paneStatus="done"
        metrics={{
          totalTokens: 1000,
          contextPercent: 35,
          toolsUsed: null,
          totalCostUsd: 0.42,
          durationMs: 30_000,
          modelDisplayName: 'Opus',
          linesAdded: 12,
          linesRemoved: 3,
          sessionTitle: null
        }}
        isApiBilling={true}
      />
    )
    expect(getByText(/ctx 35%/)).toBeTruthy()
    expect(getByText(/\+12 −3/)).toBeTruthy()
    expect(getByText(/\$0\.42/)).toBeTruthy()
  })

  it('omits cost in metrics when isApiBilling=false (subscription account)', () => {
    const { queryByText, getByText } = render(
      <PaneHeader
        {...baseProps()}
        chromeMode="kanban"
        paneStatus="done"
        metrics={{
          totalTokens: 1000,
          contextPercent: 35,
          toolsUsed: null,
          totalCostUsd: 0.42,
          durationMs: 30_000,
          modelDisplayName: 'Opus',
          linesAdded: 0,
          linesRemoved: 0,
          sessionTitle: null
        }}
        isApiBilling={false}
      />
    )
    // ctx still shows; cost does not.
    expect(getByText(/ctx 35%/)).toBeTruthy()
    expect(queryByText(/\$0\.42/)).toBeNull()
  })
})

describe('PaneHeader — chromeMode="wall" (default) is unchanged', () => {
  it('still renders Move and Close buttons', () => {
    const { getByLabelText } = render(
      <PaneHeader
        {...baseProps()}
        // chromeMode omitted → defaults to 'wall'
      />
    )
    expect(getByLabelText('Move to window')).toBeTruthy()
    expect(getByLabelText('Close terminal')).toBeTruthy()
  })
})
