import { describe, it, expect, vi } from 'vitest'
import {
  validatePermissionRule,
  sanitizePermissionRules
} from '../src/shared/permission-rule'

describe('validatePermissionRule', () => {
  describe('rejects', () => {
    it('empty input', () => {
      const r = validatePermissionRule('')
      expect(r.valid).toBe(false)
      expect(r.error).toMatch(/empty/i)
    })

    it('whitespace-only input', () => {
      const r = validatePermissionRule('   ')
      expect(r.valid).toBe(false)
    })

    it('input where the tool name does not start with a letter', () => {
      const r = validatePermissionRule('123Foo')
      expect(r.valid).toBe(false)
      expect(r.error).toMatch(/letter/i)
    })

    it('input that starts with `(` (no tool name at all)', () => {
      const r = validatePermissionRule('(arg)')
      expect(r.valid).toBe(false)
    })

    it('input with an unmatched opening paren', () => {
      const r = validatePermissionRule('Bash(git *')
      expect(r.valid).toBe(false)
      expect(r.error).toMatch(/parentheses/i)
    })
  })

  describe('passes through canonical rules unchanged', () => {
    it('bare tool name', () => {
      const r = validatePermissionRule('Bash')
      expect(r.valid).toBe(true)
      expect(r.normalized).toBe('Bash')
      expect(r.autoFixed).toBe(false)
    })

    it('tool name with arguments', () => {
      const r = validatePermissionRule('Bash(git *)')
      expect(r.valid).toBe(true)
      expect(r.normalized).toBe('Bash(git *)')
      expect(r.autoFixed).toBe(false)
    })
  })

  describe('auto-fixes lowercase first letter', () => {
    it('bare lowercase tool name', () => {
      const r = validatePermissionRule('add')
      expect(r.valid).toBe(true)
      expect(r.normalized).toBe('Add')
      expect(r.autoFixed).toBe(true)
    })

    it('lowercase tool name with arguments', () => {
      const r = validatePermissionRule('bash(git *)')
      expect(r.valid).toBe(true)
      expect(r.normalized).toBe('Bash(git *)')
      expect(r.autoFixed).toBe(true)
    })

    it('flags autoFixed when input had surrounding whitespace even if cased correctly', () => {
      const r = validatePermissionRule('  Bash  ')
      expect(r.valid).toBe(true)
      expect(r.normalized).toBe('Bash')
      expect(r.autoFixed).toBe(true)
    })
  })

  describe('MCP tools', () => {
    it('passes mcp__server__tool through unchanged', () => {
      const r = validatePermissionRule('mcp__server__tool')
      expect(r.valid).toBe(true)
      expect(r.normalized).toBe('mcp__server__tool')
      expect(r.autoFixed).toBe(false)
    })

    it('does NOT uppercase the leading m', () => {
      const r = validatePermissionRule('mcp__filesystem__read')
      expect(r.normalized).toBe('mcp__filesystem__read')
    })

    it('still enforces parens balance for MCP rules', () => {
      const r = validatePermissionRule('mcp__server__tool(arg')
      expect(r.valid).toBe(false)
    })
  })
})

describe('sanitizePermissionRules', () => {
  it('drops invalid rules and normalizes the rest', () => {
    const dropped: Array<{ rule: string; reason: string }> = []
    const result = sanitizePermissionRules(
      ['Bash', 'add', '123foo', 'bash(git *)', '   '],
      (rule, reason) => dropped.push({ rule, reason })
    )
    expect(result).toEqual(['Bash', 'Add', 'Bash(git *)'])
    expect(dropped.map((d) => d.rule)).toEqual(['123foo', '   '])
  })

  it('deduplicates after normalization', () => {
    const result = sanitizePermissionRules(['Bash', 'bash', 'BASH'])
    // 'Bash' is canonical; 'bash' normalizes to 'Bash' (dup); 'BASH' is left
    // alone (first letter already uppercase) and is a distinct entry.
    expect(result).toEqual(['Bash', 'BASH'])
  })

  it('invokes onDropped only for invalid rules, not duplicates', () => {
    const onDropped = vi.fn()
    sanitizePermissionRules(['Bash', 'Bash', 'add'], onDropped)
    expect(onDropped).not.toHaveBeenCalled()
  })

  it('does not log to console without an onDropped callback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sanitizePermissionRules(['add', '123bad'])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
