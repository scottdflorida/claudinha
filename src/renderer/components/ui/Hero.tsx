import React from 'react'
import { BrandMark } from './BrandMark'

interface HeroProps {
  /** Main title text. */
  title: React.ReactNode
  /** Optional single-line subtitle (muted). */
  subtitle?: React.ReactNode
  /** Display size tier; controls the title font-size and mark proportions. */
  size?: 'sm' | 'md' | 'lg'
  /** Gentle blink on the brand mark (only enabled on the landing hero). */
  blink?: boolean
  className?: string
}

const SIZE_MAP = {
  sm: { title: 'text-display-sm', mark: 28 },
  md: { title: 'text-display-md', mark: 40 },
  lg: { title: 'text-display-lg', mark: 50 }
} as const

/**
 * Hero — brand mark + display title + optional subtitle, §9.3-A / §10.18.
 *
 * The hallmark landing composition. Mark sits inline to the left of the
 * title with a 16px gap, vertically centered on the title's cap height.
 * Title is set in the display face at font-display weight.
 */
export function Hero({
  title,
  subtitle,
  size = 'md',
  blink = false,
  className = ''
}: HeroProps): React.JSX.Element {
  const { title: titleClass, mark: markSize } = SIZE_MAP[size]
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      <div className="flex items-center gap-4">
        <BrandMark size={markSize} blink={blink} />
        <h1 className={`${titleClass} font-display text-fg-primary tracking-tight`}>
          {title}
        </h1>
      </div>
      {subtitle && <p className="text-sm text-fg-muted">{subtitle}</p>}
    </div>
  )
}
