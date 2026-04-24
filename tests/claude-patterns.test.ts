import { CLAUDE_PATTERNS } from '../src/main/claude-patterns'

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
