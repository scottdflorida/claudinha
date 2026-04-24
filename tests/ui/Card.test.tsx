// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Card } from '../../src/renderer/components/ui/Card'

describe('Card', () => {
  it('renders children inside a rounded surface-filled panel', () => {
    const { getByText, container } = render(<Card>hello</Card>)
    expect(getByText('hello')).toBeTruthy()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/rounded-lg/)
    expect(root.className).toMatch(/bg-surface/)
  })

  it('adds hover styling + cursor when interactive', () => {
    const { container } = render(<Card interactive>x</Card>)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/hover:bg-raised/)
    expect(root.className).toMatch(/cursor-pointer/)
  })

  it('uses bg-raised + border when elevated', () => {
    const { container } = render(<Card elevated>x</Card>)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/bg-raised/)
    expect(root.className).toMatch(/border-subtle/)
  })

  it('forwards extra className and native props', () => {
    const { container } = render(<Card className="my-card" data-test="yes">x</Card>)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/my-card/)
    expect(root.getAttribute('data-test')).toBe('yes')
  })
})
