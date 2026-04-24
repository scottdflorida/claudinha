// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { Tooltip } from '../../src/renderer/components/ui/Tooltip'

describe('Tooltip', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not render the tooltip body at rest', () => {
    const { queryByRole } = render(
      <Tooltip content="Hello"><button>anchor</button></Tooltip>
    )
    expect(queryByRole('tooltip')).toBeNull()
  })

  it('opens on hover after the openDelay', () => {
    const { getByText, queryByRole } = render(
      <Tooltip content="Hello" openDelay={500}><button>anchor</button></Tooltip>
    )
    fireEvent.mouseEnter(getByText('anchor'))
    expect(queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(499) })
    expect(queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(queryByRole('tooltip')).not.toBeNull()
    expect(queryByRole('tooltip')!.textContent).toBe('Hello')
  })

  it('opens immediately on focus (accessibility path)', () => {
    const { getByText, queryByRole } = render(
      <Tooltip content="Focused"><button>anchor</button></Tooltip>
    )
    fireEvent.focus(getByText('anchor'))
    expect(queryByRole('tooltip')).not.toBeNull()
  })

  it('closes after the closeDelay on mouse leave', () => {
    const { getByText, queryByRole } = render(
      <Tooltip content="Bye" openDelay={0} closeDelay={100}>
        <button>anchor</button>
      </Tooltip>
    )
    fireEvent.mouseEnter(getByText('anchor'))
    act(() => { vi.advanceTimersByTime(0) })
    expect(queryByRole('tooltip')).not.toBeNull()
    fireEvent.mouseLeave(getByText('anchor'))
    act(() => { vi.advanceTimersByTime(99) })
    expect(queryByRole('tooltip')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(queryByRole('tooltip')).toBeNull()
  })

  it('sets aria-describedby on the anchor while open', () => {
    const { getByText, queryByRole } = render(
      <Tooltip content="Helper" openDelay={0}><button>anchor</button></Tooltip>
    )
    expect(getByText('anchor').getAttribute('aria-describedby')).toBeNull()
    fireEvent.focus(getByText('anchor'))
    const describedBy = getByText('anchor').getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(queryByRole('tooltip')!.id).toBe(describedBy)
  })
})
