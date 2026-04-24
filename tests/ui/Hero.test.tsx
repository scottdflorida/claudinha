// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Hero } from '../../src/renderer/components/ui/Hero'

describe('Hero', () => {
  it('renders an h1 title and a BrandMark svg', () => {
    const { container, getByRole } = render(<Hero title="Welcome back" />)
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Welcome back')
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders the subtitle when provided', () => {
    const { getByText } = render(<Hero title="Hi" subtitle="Small note below" />)
    expect(getByText('Small note below')).toBeTruthy()
  })

  it('picks the display-lg class on size=lg', () => {
    const { getByRole } = render(<Hero title="Huge" size="lg" />)
    expect(getByRole('heading').className).toMatch(/text-display-lg/)
  })

  it('applies font-display + font-display weight', () => {
    const { getByRole } = render(<Hero title="X" />)
    const h1 = getByRole('heading')
    expect(h1.className).toMatch(/font-display/)
  })
})
