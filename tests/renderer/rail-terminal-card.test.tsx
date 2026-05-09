// @vitest-environment jsdom
//
// RailTerminalCard renders the per-pane card in the redesigned repo rail.
// Two-row layout; top row varies by `groupBy`; second row varies by status;
// errored panes paint red regardless of status. Tests pin the wiring.

import React from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RailTerminalCard } from '../../src/renderer/components/RailTerminalCard'
import { STATUS_COLORS } from '../../src/renderer/lib/constants'

// jsdom doesn't ship ResizeObserver. The card uses it to detect prompt
// overflow; the no-op stub is enough for unit tests since they don't exercise
// container resizes.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void { /* no-op */ }
      unobserve(): void { /* no-op */ }
      disconnect(): void { /* no-op */ }
    }
    ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub
  }
})

const ERROR_COLOR = '#DB4D3F'

interface OverrideProps {
  status?: 'awaiting-prompt' | 'planning' | 'plan-ready' | 'needs-input' | 'working' | 'changes-ready'
  terminated?: boolean
  completionState?: 'success' | 'error' | 'conflict' | 'dirty-main' | null
  activeToolName?: string | null
  initialPrompt?: string | null
  lastMessage?: string | null
  groupBy?: 'repo' | 'status'
  isActive?: boolean
  onClick?: () => void
  onViewTurns?: () => void
}

function renderCard(overrides: OverrideProps = {}): {
  onClick: ReturnType<typeof vi.fn>
  onViewTurns: ReturnType<typeof vi.fn>
} {
  const onClick = overrides.onClick ?? vi.fn()
  const onViewTurns = overrides.onViewTurns ?? vi.fn()
  render(
    <RailTerminalCard
      paneId="p1"
      repoName="orchard"
      agentName="add-tagline"
      status={overrides.status ?? 'awaiting-prompt'}
      terminated={overrides.terminated ?? false}
      completionState={overrides.completionState ?? null}
      activeToolName={overrides.activeToolName ?? null}
      initialPrompt={overrides.initialPrompt ?? null}
      lastMessage={overrides.lastMessage ?? null}
      lastActivityAt={1_000_000}
      now={1_000_000 + 5 * 60_000} // 5 minutes
      groupBy={overrides.groupBy ?? 'repo'}
      isActive={overrides.isActive ?? false}
      onClick={onClick}
      onViewTurns={onViewTurns}
      animatedDots={1}
    />
  )
  return { onClick, onViewTurns }
}

describe('RailTerminalCard', () => {
  it('group by repo: shows agent name + colored status label', () => {
    renderCard({ status: 'planning', groupBy: 'repo' })
    expect(screen.getByText('add-tagline')).toBeTruthy()
    const label = screen.getByText('Planning')
    expect((label as HTMLElement).style.color).toBe('rgb(233, 237, 230)') // #E9EDE6 — matches 'working' (active agent)
  })

  it('group by status: shows "repo › agent" + status dot', () => {
    const { container } = render(
      <RailTerminalCard
        paneId="p1"
        repoName="orchard"
        agentName="add-tagline"
        status="working"
        terminated={false}
        completionState={null}
        activeToolName={null}
        initialPrompt={null}
        lastMessage={null}
        lastActivityAt={1_000_000}
        now={1_000_000 + 5 * 60_000}
        groupBy="status"
        isActive={false}
        onClick={() => {}}
        onViewTurns={() => {}}
        animatedDots={1}
      />
    )
    expect(screen.getByText('orchard')).toBeTruthy()
    expect(screen.getByText('add-tagline')).toBeTruthy()
    const dot = container.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(dot).toBeTruthy()
    // STATUS_COLORS['working'] = '#E9EDE6'
    expect(dot.style.background).toBe('rgb(233, 237, 230)')
    expect(STATUS_COLORS.working).toBe('#E9EDE6')
  })

  it('changes-ready: status label itself is the underlined link that opens the turns modal', () => {
    const onClick = vi.fn()
    const onViewTurns = vi.fn()
    renderCard({
      status: 'changes-ready',
      onClick,
      onViewTurns,
      lastMessage: 'I finished the migration.'
    })
    // The status label "Changes ready" is now a button — not a span — and
    // clicking it opens the turns modal without activating the card.
    const label = screen.getByRole('button', { name: 'View turns' })
    expect(label.tagName).toBe('BUTTON')
    expect(label.className).toContain('underline')
    fireEvent.click(label)
    expect(onViewTurns).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled() // stopPropagation
    // Second row shows the last message; the old "View turns" body link is gone.
    expect(screen.getByText('I finished the migration.')).toBeTruthy()
    expect(screen.queryByText('View turns')).toBeNull()
  })

  it('working: second row shows the last message, not the tool verb', () => {
    renderCard({
      status: 'working',
      activeToolName: 'Edit',
      lastMessage: 'Updating the importer module.'
    })
    expect(screen.getByText('Updating the importer module.')).toBeTruthy()
    // The status-label slot still shows "Editing" (top-right), but the
    // second-row activity verb is gone — only the last message remains.
    expect(screen.getAllByText('Editing').length).toBe(1)
  })

  it('any status: falls back to initialPrompt when lastMessage is null', () => {
    renderCard({
      status: 'working',
      activeToolName: null,
      initialPrompt: 'Refactor the importer',
      lastMessage: null
    })
    expect(screen.getByText('Refactor the importer')).toBeTruthy()
  })

  it('awaiting-prompt: shows the trimmed initial prompt', () => {
    renderCard({ status: 'awaiting-prompt', initialPrompt: '  Refactor the importer  ' })
    expect(screen.getByText('Refactor the importer')).toBeTruthy()
  })

  it('errored pane paints the status label red even if the underlying status is benign', () => {
    renderCard({ status: 'awaiting-prompt', completionState: 'error' })
    // Status label is "Awaiting orders" but rendered in error red.
    const label = screen.getByText('Awaiting orders')
    expect((label as HTMLElement).style.color).toBe('rgb(219, 77, 63)') // ERROR_COLOR
    expect(ERROR_COLOR).toBe('#DB4D3F')
  })

  it('terminated pane shows "Lost" label in red', () => {
    renderCard({ status: 'working', terminated: true })
    const label = screen.getByText('Lost')
    expect((label as HTMLElement).style.color).toBe('rgb(219, 77, 63)')
  })

  it('renders the mixed-style age in the right slot', () => {
    // 3h12m delta
    const onClick = vi.fn()
    render(
      <RailTerminalCard
        paneId="p1"
        repoName="orchard"
        agentName="add-tagline"
        status="awaiting-prompt"
        terminated={false}
        completionState={null}
        activeToolName={null}
        initialPrompt="hi"
        lastMessage={null}
        lastActivityAt={0}
        now={3 * 60 * 60_000 + 12 * 60_000}
        groupBy="repo"
        isActive={false}
        onClick={onClick}
        onViewTurns={() => {}}
        animatedDots={1}
      />
    )
    expect(screen.getByText('3h12m')).toBeTruthy()
  })

  it('group by repo + planning: renders 1/2/3 cycling dots after the label', () => {
    const baseProps = {
      paneId: 'p1',
      repoName: 'orchard',
      agentName: 'add-tagline',
      terminated: false,
      completionState: null,
      activeToolName: null,
      initialPrompt: null, lastMessage: null,
      lastActivityAt: 1_000_000,
      now: 1_000_000 + 5 * 60_000,
      groupBy: 'repo' as const,
      isActive: false,
      onClick: () => {},
      onViewTurns: () => {}
    }
    const { rerender } = render(
      <RailTerminalCard {...baseProps} status="planning" animatedDots={1} />
    )
    expect(screen.getByText('.')).toBeTruthy()
    rerender(<RailTerminalCard {...baseProps} status="planning" animatedDots={2} />)
    expect(screen.getByText('..')).toBeTruthy()
    rerender(<RailTerminalCard {...baseProps} status="planning" animatedDots={3} />)
    expect(screen.getByText('...')).toBeTruthy()
  })

  it('group by repo + awaiting-prompt: no animated dots', () => {
    renderCard({ status: 'awaiting-prompt', groupBy: 'repo', initialPrompt: 'hi' })
    expect(screen.queryByText('.')).toBeNull()
    expect(screen.queryByText('..')).toBeNull()
    expect(screen.queryByText('...')).toBeNull()
  })

  it('errored pane: no animated dots even on a working underlying status', () => {
    renderCard({ status: 'working', completionState: 'error', activeToolName: 'Edit' })
    expect(screen.queryByText('.')).toBeNull()
  })

  it('clicking the card calls onClick (selects the pane)', () => {
    const onClick = vi.fn()
    renderCard({ status: 'awaiting-prompt', initialPrompt: 'hi', onClick })
    const card = screen.getByRole('button', { pressed: false })
    fireEvent.click(card)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
