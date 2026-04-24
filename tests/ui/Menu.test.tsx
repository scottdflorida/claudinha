// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React, { useRef } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { Menu, type MenuItem } from '../../src/renderer/components/ui/Menu'

function Harness({ open, items, onClose }: { open: boolean; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button ref={ref}>anchor</button>
      <Menu anchorRef={ref} open={open} onClose={onClose} items={items} aria-label="Test menu" />
    </>
  )
}

describe('Menu', () => {
  const basicItems: MenuItem[] = [
    { kind: 'item', id: 'a', label: 'Alpha', onClick: vi.fn() },
    { kind: 'separator', id: 'sep-1' },
    { kind: 'item', id: 'b', label: 'Beta', disabled: true },
    { kind: 'item', id: 'c', label: 'Gamma', onClick: vi.fn() }
  ]

  it('does not render content when closed', () => {
    const { queryByRole } = render(<Harness open={false} items={basicItems} onClose={() => {}} />)
    expect(queryByRole('menu')).toBeNull()
  })

  it('renders items + separator when open', () => {
    const { getByRole, getByText } = render(<Harness open={true} items={basicItems} onClose={() => {}} />)
    expect(getByRole('menu').getAttribute('aria-label')).toBe('Test menu')
    expect(getByText('Alpha')).toBeTruthy()
    expect(getByText('Beta')).toBeTruthy()
    expect(getByText('Gamma')).toBeTruthy()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Harness open={true} items={basicItems} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('activates an item with Enter', () => {
    const click = vi.fn()
    const items: MenuItem[] = [
      { kind: 'item', id: 'a', label: 'A', onClick: click }
    ]
    const onClose = vi.fn()
    render(<Harness open={true} items={items} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(click).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('skips disabled items with ArrowDown', () => {
    const items: MenuItem[] = [
      { kind: 'item', id: 'a', label: 'A', onClick: vi.fn() },
      { kind: 'item', id: 'dis', label: 'Dis', disabled: true },
      { kind: 'item', id: 'c', label: 'C', onClick: vi.fn() }
    ]
    const onClose = vi.fn()
    const { getAllByRole } = render(<Harness open={true} items={items} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'Enter' })
    // After one ArrowDown: a → c (skipping disabled). Enter fires c.onClick.
    const btns = getAllByRole('menuitem')
    expect(btns[2].textContent).toBe('C')
  })

  it('does not fire onClick for disabled items', () => {
    const click = vi.fn()
    const items: MenuItem[] = [
      { kind: 'item', id: 'a', label: 'A', disabled: true, onClick: click }
    ]
    const { getByText } = render(<Harness open={true} items={items} onClose={() => {}} />)
    fireEvent.click(getByText('A'))
    expect(click).not.toHaveBeenCalled()
  })
})
