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

  it('changes-ready: renders View turns link that fires its handler without selecting the card', () => {
    const onClick = vi.fn()
    const onViewTurns = vi.fn()
    renderCard({ status: 'changes-ready', onClick, onViewTurns })
    const link = screen.getByText('View turns')
    fireEvent.click(link)
    expect(onViewTurns).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled() // stopPropagation
  })

  it('working: renders the formatted active tool verb', () => {
    renderCard({ status: 'working', activeToolName: 'Edit' })
    // "Editing" appears twice: once as the colored status label (top-right
    // when grouped by repo) and once as the second-row activity verb.
    const matches = screen.getAllByText('Editing')
    expect(matches.length).toBe(2)
  })

  it('working with no tool: falls back to "Working…" in the activity row', () => {
    renderCard({ status: 'working', activeToolName: null })
    // Status-label slot: formatStatusLabel returns "Working" (no ellipsis).
    // Activity row: falls back to t.kanban.working = "Working…".
    expect(screen.getByText('Working')).toBeTruthy()
    expect(screen.getByText('Working…')).toBeTruthy()
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
      initialPrompt: null,
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
