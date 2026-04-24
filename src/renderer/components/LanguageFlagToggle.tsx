import React, { useCallback } from 'react'
import { useAppConfig } from '../hooks/useAppConfig'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// LanguageFlagToggle — quick-flip flag button mounted on a few high-traffic
// surfaces. Shows the OPPOSITE flag of the current language: Brazilian when
// the app is in English (click → switch to pt-BR), American when in pt-BR
// (click → switch to English). The Configuration sidebar's language picker
// is the canonical setter; this is the convenience affordance.
//
// Stays in sync with ConfigurationView automatically because both write to
// the same `useAppConfig` setter, and AppConfigProvider rebroadcasts the
// new value to every mounted listener (including the other flag instances
// across windows).
// ---------------------------------------------------------------------------

interface LanguageFlagToggleProps {
  /**
   * Optional class names appended to the button. Use for parent-controlled
   * positioning (e.g. `absolute bottom-3 right-3`) — the component itself
   * has no opinion on where it lives.
   */
  className?: string
}

export function LanguageFlagToggle({ className = '' }: LanguageFlagToggleProps): React.JSX.Element {
  const { config, setConfig } = useAppConfig()
  const t = useStrings()

  const isEnglish = config.language === 'en'
  const ariaLabel = isEnglish
    ? t.languageToggle.switchToPortuguese
    : t.languageToggle.switchToEnglish

  const handleClick = useCallback(() => {
    void setConfig({ language: isEnglish ? 'pt-BR' : 'en' })
  }, [isEnglish, setConfig])

  return (
    <button
      type="button"
      onClick={handleClick}
      title={ariaLabel}
      aria-label={ariaLabel}
      className={`group inline-flex items-center justify-center rounded-sm overflow-hidden ring-1 ring-fg-muted/30 hover:ring-fg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg transition-shadow duration-[80ms] ${className}`}
    >
      {isEnglish ? <BrazilianFlag /> : <AmericanFlag />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Inline SVG flags. Sized at 26×18 (Brazilian flag's 10:7 ratio); the U.S.
// flag is rendered slightly off its true 19:10 ratio at the same 26×18 box
// so the two icons are visually interchangeable in any mount point.
// Decorative — the parent button supplies the accessible label.
// ---------------------------------------------------------------------------

function BrazilianFlag(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 26 18"
      width={26}
      height={18}
      aria-hidden
      className="block"
    >
      <rect width="26" height="18" fill="#009c3b" />
      <polygon points="13,2 24,9 13,16 2,9" fill="#ffdf00" />
      <circle cx="13" cy="9" r="3.5" fill="#002776" />
    </svg>
  )
}

function AmericanFlag(): React.JSX.Element {
  // 7 red stripes + 6 implicit white = 13 stripes simplified to fit at 18px.
  return (
    <svg
      viewBox="0 0 26 18"
      width={26}
      height={18}
      aria-hidden
      className="block"
    >
      <rect width="26" height="18" fill="#fff" />
      <g fill="#b22234">
        <rect y="0" width="26" height="1.385" />
        <rect y="2.77" width="26" height="1.385" />
        <rect y="5.54" width="26" height="1.385" />
        <rect y="8.31" width="26" height="1.385" />
        <rect y="11.08" width="26" height="1.385" />
        <rect y="13.85" width="26" height="1.385" />
        <rect y="16.62" width="26" height="1.385" />
      </g>
      <rect width="10.4" height="9.69" fill="#3c3b6e" />
    </svg>
  )
}
