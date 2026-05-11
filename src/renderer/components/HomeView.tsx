import React from 'react'
import { LaunchForm } from './LaunchForm'
import { BrandMark } from './ui/BrandMark'
import { useStrings } from '../lib/strings'

// ---------------------------------------------------------------------------
// HomeView — Manager's main-area landing view for creating a workspace.
// ---------------------------------------------------------------------------

interface HomeViewProps {
  onLaunched: () => void
  /** Next auto-generated workspace ordinal — used to prefill the Workspace Name field. */
  nextWorkspaceNumber?: number
}

export function HomeView({ onLaunched, nextWorkspaceNumber }: HomeViewProps): React.JSX.Element {
  const t = useStrings()
  return (
    <div className="flex-1 min-h-0 overflow-y-auto w-full">
      <div className="max-w-[720px] mx-auto pt-10 pb-8 px-6">
        <div className="flex items-center justify-center gap-3 mb-8">
          <BrandMark size={28} />
          <h1 className="text-[28px] font-[650] text-fg-primary tracking-tight">{t.workspace.create}</h1>
        </div>
        <LaunchForm onLaunched={onLaunched} nextWorkspaceNumber={nextWorkspaceNumber} />
      </div>
    </div>
  )
}
