// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { InfoCallout } from '../../src/renderer/components/ui/InfoCallout'

describe('InfoCallout', () => {
  it('renders with role=note and the info-subtle fill', () => {
    const { getByRole, getByText } = render(<InfoCallout>Heads up</InfoCallout>)
    const note = getByRole('note')
    expect(getByText('Heads up')).toBeTruthy()
    expect(note.className).toMatch(/bg-info-subtle-bg/)
  })

  it('renders a default info icon when no custom icon is passed', () => {
    const { container } = render(<InfoCallout>x</InfoCallout>)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('uses the provided icon when passed', () => {
    const { getByTestId, container } = render(
      <InfoCallout icon={<span data-testid="custom-icon" />}>x</InfoCallout>
    )
    expect(getByTestId('custom-icon')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
  })
})
