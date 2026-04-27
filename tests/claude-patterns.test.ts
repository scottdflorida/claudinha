import { CLAUDE_PATTERNS, STOP_CLASSIFIER, classifyStopOutput } from '../src/main/claude-patterns'

// ---------------------------------------------------------------------------
// Helper — test a string against a pattern array
// ---------------------------------------------------------------------------

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text))
}

// ---------------------------------------------------------------------------
// needsInput patterns
// ---------------------------------------------------------------------------

describe('CLAUDE_PATTERNS.needsInput', () => {
  const { needsInput } = CLAUDE_PATTERNS

  it('matches [y/n] case-insensitively', () => {
    expect(matchesAny(needsInput, 'Allow file edit? [y/n]')).toBe(true)
    expect(matchesAny(needsInput, 'Confirm? [Y/N]')).toBe(true)
  })

  it('matches (Y/n) case-sensitive', () => {
    expect(matchesAny(needsInput, 'Continue? (Y/n)')).toBe(true)
  })

  it('matches (y/N) case-sensitive', () => {
    expect(matchesAny(needsInput, 'Skip this? (y/N)')).toBe(true)
  })

  it('matches (yes/no) case-insensitively', () => {
    expect(matchesAny(needsInput, 'Proceed? (yes/no)')).toBe(true)
    expect(matchesAny(needsInput, 'Proceed? (YES/NO)')).toBe(true)
  })

  it('matches "Do you want to"', () => {
    expect(matchesAny(needsInput, 'Do you want to create this file?')).toBe(true)
  })

  it('matches "Would you like to"', () => {
    expect(matchesAny(needsInput, 'Would you like to continue?')).toBe(true)
  })

  it('matches Allow...Deny permission prompts', () => {
    expect(matchesAny(needsInput, 'Allow bash command `rm file.txt`? Allow / Deny')).toBe(true)
  })

  it('matches Allow...[y/n] permission prompts', () => {
    expect(matchesAny(needsInput, 'Allow edit on foo.ts? [y/n]')).toBe(true)
  })

  it('matches numbered option dialogs', () => {
    expect(matchesAny(needsInput, '1) Yes   2) No   3) Always allow')).toBe(true)
    expect(matchesAny(needsInput, '1) Allow for this project')).toBe(true)
    expect(matchesAny(needsInput, '1) Always allow this tool')).toBe(true)
  })

  it('does NOT match normal code output', () => {
    expect(matchesAny(needsInput, 'const allowed = true')).toBe(false)
    expect(matchesAny(needsInput, 'function deny() {}')).toBe(false)
  })

  it('does NOT match done patterns', () => {
    expect(matchesAny(needsInput, 'Total cost: $0.02')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// done patterns
// ---------------------------------------------------------------------------

describe('CLAUDE_PATTERNS.done', () => {
  const { done } = CLAUDE_PATTERNS

  it('matches "Total cost:" summary', () => {
    expect(matchesAny(done, 'Total cost: $0.02')).toBe(true)
  })

  it('matches "Total tokens:" summary', () => {
    expect(matchesAny(done, 'Total tokens: 1,234')).toBe(true)
  })

  it('matches "API cost:" summary', () => {
    expect(matchesAny(done, 'API cost: $0.05')).toBe(true)
  })

  it('matches "Tokens used:" summary', () => {
    expect(matchesAny(done, 'Tokens used: 500')).toBe(true)
  })

  it('matches checkmark task complete', () => {
    expect(matchesAny(done, '✓ Task complete')).toBe(true)
  })

  it('matches "Task completed"', () => {
    expect(matchesAny(done, 'Task completed successfully.')).toBe(true)
  })

  it('matches "Finished...task"', () => {
    expect(matchesAny(done, 'Finished the task')).toBe(true)
  })

  it('does NOT match prompt patterns', () => {
    expect(matchesAny(done, '> ')).toBe(false)
  })

  it('does NOT match needs-input patterns', () => {
    expect(matchesAny(done, 'Allow bash? [y/n]')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// awaitingPrompt patterns
// ---------------------------------------------------------------------------

describe('CLAUDE_PATTERNS.awaitingPrompt', () => {
  const { awaitingPrompt } = CLAUDE_PATTERNS

  it('matches bare > prompt at end of string', () => {
    expect(matchesAny(awaitingPrompt, '\n> ')).toBe(true)
    expect(matchesAny(awaitingPrompt, '> ')).toBe(true)
    expect(matchesAny(awaitingPrompt, '>')).toBe(true)
  })

  it('matches unicode ❯ prompt at end', () => {
    expect(matchesAny(awaitingPrompt, '❯ ')).toBe(true)
    expect(matchesAny(awaitingPrompt, '❯')).toBe(true)
  })

  it('does NOT match > embedded in a line', () => {
    expect(matchesAny(awaitingPrompt, 'if (x > 5) return')).toBe(false)
  })

  it('does NOT match cost summaries', () => {
    expect(matchesAny(awaitingPrompt, 'Total cost: $0.02')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// classifyStopOutput — Stop-time Done vs Needs Input refinement
// ---------------------------------------------------------------------------

describe('classifyStopOutput', () => {
  it('returns the configured default for null/undefined/empty input', () => {
    expect(classifyStopOutput(null)).toBe(STOP_CLASSIFIER.defaultStatus)
    expect(classifyStopOutput(undefined)).toBe(STOP_CLASSIFIER.defaultStatus)
    expect(classifyStopOutput('')).toBe(STOP_CLASSIFIER.defaultStatus)
  })

  it('routes the screenshot case (question + clarifier) to needs-input', () => {
    const buffer =
      'Want me to fix #4 (paths in the wave guide) and draft the Track 11 ' +
      'continuation kickoff variant now? Those are the two cheapest ' +
      'pre-launch chores.'
    expect(classifyStopOutput(buffer)).toBe('needs-input')
  })

  it('handles a tail with the "Worked for…" footer and prompt prefix', () => {
    const buffer =
      'Should I delete the orphaned worktree, or do you want to inspect it first? ' +
      'I can do either.\n\n* Worked for 42s\n\n> '
    expect(classifyStopOutput(buffer)).toBe('needs-input')
  })

  it('routes a purely declarative wrap-up to done', () => {
    expect(classifyStopOutput('All set. Tests pass and the dev server is happy.')).toBe('done')
  })

  it('routes "Want me to …?" buried before commentary to needs-input', () => {
    const buffer =
      'I patched the renderer and added a regression test. Want me to also ' +
      'apply the same fix to the Notification fallback? That would keep the ' +
      'two paths consistent.'
    expect(classifyStopOutput(buffer)).toBe('needs-input')
  })

  it('routes "Should I …?" / "Do you want …?" / "Would you like …?" to needs-input', () => {
    expect(classifyStopOutput('Should I run the migration now? It is reversible.')).toBe(
      'needs-input'
    )
    expect(classifyStopOutput('Do you want me to revert that file? Easy to undo.')).toBe(
      'needs-input'
    )
    expect(classifyStopOutput('Would you like a summary first? Or jump straight in?')).toBe(
      'needs-input'
    )
  })

  it('does NOT false-match a `?` from a code block far before the end', () => {
    // The `?` in the code block is followed by ~1500 chars of declarative
    // padding, so the {0,200} bound after `?` cannot reach end-of-string.
    const padding = 'Lorem ipsum non-question summary text. '.repeat(50)
    const buffer = 'Use the `obj?.field` access pattern.\n' + padding
    expect(classifyStopOutput(buffer)).toBe('done')
  })

  it('handles very large buffers by scanning only the tail', () => {
    const noisyHead = 'No question marks here. '.repeat(500) // > 2000 chars
    const tail = ' Final thought — should we proceed?'
    expect(classifyStopOutput(noisyHead + tail)).toBe('needs-input')
  })

  it('routes to needs-input through Claude Code ink TUI redraw padding', () => {
    // Captured live from the Stop hook on a "Hi!" → "Hi! What can I help you
    // with today?" exchange. The agent's question is on the same line as
    // hundreds of chars of `\r`-driven spinner / footer / divider redraws.
    // The classifier must see through that noise.
    const buffer =
      '\n\r\n\r✢(1s · ↓1 tokens)\r\r\n\r\n\r\n\r\n\r\n\r\n\r2\r\r\n' +
      '\r\n\r\n\r\n\r\n\r\n' +
      '\r⏺Hi! What can I helpyou with today?\r✢ Marinating… (1s · ↓ 2 tokens)' +
      '                                                                       \r   \r❯                  \r\r\n' +
      '─'.repeat(120) +
      '\r\r\n●high·/effort\r\r\n\r3\r\r\n\r\n\r\n\r\n\r\n\r\n' +
      '\rMarinating…4\r\r\n\r\n\r\n\r\n\r\n\r\n' +
      '\rrunning sp hooks… 0/2 · 1s · ↓5 tokens)\r\r\n\r\n\r\n\r\n\r\n\r\n' +
      '\r✳Marinating…\r\r\n\r\n\r\n\r\n\r\n\r\n\r16\r\r\n\r\n\r\n\r\n\r\n\r\n'
    expect(classifyStopOutput(buffer)).toBe('needs-input')
  })

  it('keeps defaultStatus as `done` (guards against accidental flip)', () => {
    expect(STOP_CLASSIFIER.defaultStatus).toBe('done')
  })

  it('exposes empty completion patterns until the default is flipped', () => {
    expect(STOP_CLASSIFIER.completionPatterns).toHaveLength(0)
  })
})
