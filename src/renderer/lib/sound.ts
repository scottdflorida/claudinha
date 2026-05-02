/**
 * Sound effects for pane status transitions.
 *
 * Uses Vite's ?url imports so paths resolve correctly in both dev and
 * production builds — no IPC or preload changes required.
 *
 * Playback is gated on the user's AppConfig (soundsEnabled, soundVolume,
 * per-status toggles). Call `applySoundConfig` at renderer startup and
 * whenever the config changes. Until configured, playback uses conservative
 * defaults (enabled, 0.4 volume) so sounds still work if the config hasn't
 * arrived yet.
 */

import needsInputUrl from '../../../assets/sounds/status.notification-needsinput.mp3?url'
import doneUrl from '../../../assets/sounds/status-notification-done.mp3?url'

import type { PaneStatus, AppConfig } from '../../shared/types'
import { DEFAULT_APP_CONFIG } from '../../shared/types'

// Pre-create Audio elements so playback is instant (no network fetch on first play)
const sounds: Partial<Record<PaneStatus, HTMLAudioElement>> = {}

type SoundConfig = Pick<
  AppConfig,
  'soundsEnabled' | 'soundVolume' | 'soundOnNeedsInput' | 'soundOnDone'
>

let currentConfig: SoundConfig = {
  soundsEnabled: DEFAULT_APP_CONFIG.soundsEnabled,
  soundVolume: DEFAULT_APP_CONFIG.soundVolume,
  soundOnNeedsInput: DEFAULT_APP_CONFIG.soundOnNeedsInput,
  soundOnDone: DEFAULT_APP_CONFIG.soundOnDone
}

function preload(status: PaneStatus, url: string): void {
  const audio = new Audio(url)
  audio.volume = currentConfig.soundVolume
  sounds[status] = audio
}

preload('needs-input', needsInputUrl)
preload('changes-ready', doneUrl)

/**
 * Update the live sound configuration. Applies the new volume to every
 * preloaded audio element and stores the enable flags for the next
 * `playStatusSound` call. Safe to call repeatedly.
 */
export function applySoundConfig(config: AppConfig): void {
  currentConfig = {
    soundsEnabled: config.soundsEnabled,
    soundVolume: config.soundVolume,
    soundOnNeedsInput: config.soundOnNeedsInput,
    soundOnDone: config.soundOnDone
  }
  for (const audio of Object.values(sounds)) {
    if (audio) audio.volume = currentConfig.soundVolume
  }
}

/**
 * Play the sound effect for a status transition, if one exists and the
 * user has not muted it. Safe to call for any status — statuses without
 * sounds are silently ignored.
 */
export function playStatusSound(status: PaneStatus): void {
  if (!currentConfig.soundsEnabled) return
  if (status === 'needs-input' && !currentConfig.soundOnNeedsInput) return
  if (status === 'changes-ready' && !currentConfig.soundOnDone) return
  const audio = sounds[status]
  if (!audio) return
  // Reset to start so rapid repeated triggers still play
  audio.currentTime = 0
  audio.play().catch(() => {
    // Swallow — browser may block autoplay until user interaction
  })
}
