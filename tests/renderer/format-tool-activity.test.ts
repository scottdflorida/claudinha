import { describe, it, expect } from 'vitest'
import { formatToolActivity } from '../../src/shared/tool-activity'

describe('formatToolActivity', () => {
  it('maps Read to "Reading"', () => {
    expect(formatToolActivity('Read')).toBe('Reading')
  })

  it('maps Edit and MultiEdit to "Editing"', () => {
    expect(formatToolActivity('Edit')).toBe('Editing')
    expect(formatToolActivity('MultiEdit')).toBe('Editing')
  })

  it('maps Bash to "Running command"', () => {
    expect(formatToolActivity('Bash')).toBe('Running command')
  })

  it('maps Grep to "Searching" and Glob to "Finding files"', () => {
    expect(formatToolActivity('Grep')).toBe('Searching')
    expect(formatToolActivity('Glob')).toBe('Finding files')
  })

  it('maps Write to "Writing"', () => {
    expect(formatToolActivity('Write')).toBe('Writing')
  })

  it('maps WebFetch and WebSearch to readable phrases', () => {
    expect(formatToolActivity('WebFetch')).toBe('Fetching URL')
    expect(formatToolActivity('WebSearch')).toBe('Searching web')
  })

  it('strips MCP namespace and shows "Using <action>" for MCP tools', () => {
    expect(formatToolActivity('mcp__claude_ai_Gmail__create_draft')).toBe('Using create_draft')
    expect(formatToolActivity('mcp__server__do_thing')).toBe('Using do_thing')
  })

  it('falls back to "Using <name>" for unknown non-MCP tools', () => {
    expect(formatToolActivity('SomeCustomTool')).toBe('Using SomeCustomTool')
  })
})
