// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React, { useState } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { Composer } from '../../src/renderer/components/ui/Composer'

function ControlledComposer(props: React.ComponentProps<typeof Composer>) {
  const [v, setV] = useState(props.value)
  return <Composer {...props} value={v} onChange={(x) => { setV(x); props.onChange(x) }} />
}

describe('Composer', () => {
  it('renders textarea with placeholder + leading/trailing slots', () => {
    const { getByPlaceholderText, getByTestId } = render(
      <Composer
        value=""
        onChange={() => {}}
        placeholder="What now?"
        leading={<span data-testid="lead" />}
        trailing={<span data-testid="trail" />}
      />
    )
    expect(getByPlaceholderText('What now?')).toBeTruthy()
    expect(getByTestId('lead')).toBeTruthy()
    expect(getByTestId('trail')).toBeTruthy()
  })

  it('calls onSubmit on Enter with non-empty value', () => {
    const onSubmit = vi.fn()
    const { getByPlaceholderText } = render(
      <ControlledComposer value="hi" onChange={() => {}} onSubmit={onSubmit} placeholder="p" />
    )
    fireEvent.keyDown(getByPlaceholderText('p'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('hi')
  })

  it('does NOT submit on Shift+Enter (newline insertion)', () => {
    const onSubmit = vi.fn()
    const { getByPlaceholderText } = render(
      <ControlledComposer value="hi" onChange={() => {}} onSubmit={onSubmit} placeholder="p" />
    )
    fireEvent.keyDown(getByPlaceholderText('p'), { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit when the textarea is empty', () => {
    const onSubmit = vi.fn()
    const { getByPlaceholderText } = render(
      <ControlledComposer value="" onChange={() => {}} onSubmit={onSubmit} placeholder="p" />
    )
    fireEvent.keyDown(getByPlaceholderText('p'), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('brightens the border from subtle → strong on focus', () => {
    const { getByPlaceholderText, container } = render(
      <Composer value="x" onChange={() => {}} placeholder="p" />
    )
    const outer = container.firstElementChild as HTMLElement
    expect(outer.className).toMatch(/border-subtle/)
    fireEvent.focus(getByPlaceholderText('p'))
    expect(outer.className).toMatch(/border-strong/)
  })
})
