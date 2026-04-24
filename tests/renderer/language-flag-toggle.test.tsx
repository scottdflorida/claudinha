// @vitest-environment jsdom
/**
 * LanguageFlagToggle — verifies the flag swaps on language change, the
 * accessible label flips to the OPPOSITE language (the affordance points at
 * the destination, not the current state), and clicking dispatches a
 * setConfig({ language: ... }) write.
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, fireEvent } from '@testing-library/react'

// Stub useAppConfig so we control the active language and can assert on
// setConfig calls without needing a real AppConfigProvider or window.api.
const setConfigSpy = vi.fn(() => Promise.resolve())
let mockLanguage: 'en' | 'pt-BR' = 'en'

vi.mock('../../src/renderer/hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    config: { language: mockLanguage },
    loaded: true,
    setConfig: setConfigSpy,
    resetConfig: () => Promise.resolve()
  })
}))

import { LanguageFlagToggle } from '../../src/renderer/components/LanguageFlagToggle'
import { en } from '../../src/renderer/lib/strings/en'
import { ptBR } from '../../src/renderer/lib/strings/pt-BR'

describe('LanguageFlagToggle', () => {
  beforeEach(() => {
    setConfigSpy.mockClear()
  })

  it('shows the Brazilian flag and switch-to-Portuguese label when language is "en"', () => {
    mockLanguage = 'en'
    const { getByRole } = render(<LanguageFlagToggle />)
    const button = getByRole('button')
    expect(button.getAttribute('aria-label')).toBe(en.languageToggle.switchToPortuguese)
    expect(button.getAttribute('title')).toBe(en.languageToggle.switchToPortuguese)
    // Brazilian flag has a green field with a yellow rhombus and blue circle.
    const greenRect = button.querySelector('rect[fill="#009c3b"]')
    expect(greenRect).not.toBeNull()
  })

  it('shows the American flag and switch-to-English label when language is "pt-BR"', () => {
    mockLanguage = 'pt-BR'
    const { getByRole } = render(<LanguageFlagToggle />)
    const button = getByRole('button')
    expect(button.getAttribute('aria-label')).toBe(ptBR.languageToggle.switchToEnglish)
    // American flag has the dark blue canton.
    const canton = button.querySelector('rect[fill="#3c3b6e"]')
    expect(canton).not.toBeNull()
  })

  it('clicking from English dispatches setConfig with language "pt-BR"', () => {
    mockLanguage = 'en'
    const { getByRole } = render(<LanguageFlagToggle />)
    fireEvent.click(getByRole('button'))
    expect(setConfigSpy).toHaveBeenCalledWith({ language: 'pt-BR' })
  })

  it('clicking from Portuguese dispatches setConfig with language "en"', () => {
    mockLanguage = 'pt-BR'
    const { getByRole } = render(<LanguageFlagToggle />)
    fireEvent.click(getByRole('button'))
    expect(setConfigSpy).toHaveBeenCalledWith({ language: 'en' })
  })

  it('appends the className prop to the button so parents control positioning', () => {
    mockLanguage = 'en'
    const { getByRole } = render(<LanguageFlagToggle className="absolute bottom-3 right-3" />)
    const button = getByRole('button')
    expect(button.className).toContain('absolute')
    expect(button.className).toContain('bottom-3')
    expect(button.className).toContain('right-3')
  })
})
