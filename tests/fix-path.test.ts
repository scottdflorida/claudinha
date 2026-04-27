import { describe, it, expect } from 'vitest'
import { extractPathFromShellOutput } from '../src/main/fix-path'

describe('extractPathFromShellOutput', () => {
  const BEGIN = '__CLAUDINHA_PATH_BEGIN__'
  const END = '__CLAUDINHA_PATH_END__'

  it('extracts the PATH between markers', () => {
    const stdout = `${BEGIN}/opt/homebrew/bin:/usr/local/bin:/usr/bin${END}`
    expect(extractPathFromShellOutput(stdout)).toBe(
      '/opt/homebrew/bin:/usr/local/bin:/usr/bin'
    )
  })

  it('ignores shell startup banners and prompt noise around the markers', () => {
    const stdout = [
      'Welcome to zsh!',
      '\x1b[32mYou have mail.\x1b[0m',
      `${BEGIN}/Users/me/.nvm/versions/node/v20.10.0/bin:/usr/bin${END}`,
      '\nlast login at...'
    ].join('\n')
    expect(extractPathFromShellOutput(stdout)).toBe(
      '/Users/me/.nvm/versions/node/v20.10.0/bin:/usr/bin'
    )
  })

  it('returns null when the BEGIN marker is missing', () => {
    expect(extractPathFromShellOutput('garbled output without markers')).toBeNull()
  })

  it('returns null when the END marker is missing', () => {
    expect(extractPathFromShellOutput(`${BEGIN}/usr/bin (truncated)`)).toBeNull()
  })

  it('returns null when the captured PATH is empty', () => {
    expect(extractPathFromShellOutput(`${BEGIN}${END}`)).toBeNull()
  })

  it('handles a PATH containing colons, slashes, and dots', () => {
    const path = '/Users/me/.local/bin:/opt/homebrew/bin:/Users/me/.cargo/bin:/usr/bin'
    expect(extractPathFromShellOutput(`${BEGIN}${path}${END}`)).toBe(path)
  })
})
