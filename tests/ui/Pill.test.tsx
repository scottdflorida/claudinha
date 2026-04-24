// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Pill } from '../../src/renderer/components/ui/Pill'

describe('Pill', () => {
  it('renders a pill-shaped button with leading icon + label', () => {
    const { getByRole, getByText } = render(
      <Pill leading={<span data-test="icon" />}>Code</Pill>
    )
    expect(getByText('Code')).toBeTruthy()
    expect(getByRole('button').className).toMatch(/rounded-full/)
  })

  it('switches to selected border when selected', () => {
    const { getByRole } = render(<Pill selected>X</Pill>)
    expect(getByRole('button').className).toMatch(/border-strong/)
  })

  it('fires onClick', () => {
    const onClick = vi.fn()
    const { getByRole } = render(<Pill onClick={onClick}>X</Pill>)
    fireEvent.click(getByRole('button'))
    expect(onClick).toHaveBeenCalled()
  })
})
