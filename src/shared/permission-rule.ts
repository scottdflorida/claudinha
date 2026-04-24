/**
 * Permission rule validator and normalizer.
 *
 * Claude Code's startup parser rejects permission rules whose tool name does
 * not start with an uppercase letter, and — critically — when it hits a bad
 * rule it discards the **entire** settings file, not just the offending entry.
 * One typo therefore silently disables every other valid permission. The
 * Claudinha used to forward whatever the user typed straight to disk; this
 * validator is the gatekeeper that stops invalid rules before they reach
 * `settings.json`.
 *
 * The validation rules here are deliberately narrow — only the case rule we
 * have direct evidence of from Claude Code's literal error message, plus a
 * parens-balance sanity check. We do NOT enforce a closed allowlist of tool
 * names, because that would block legitimate MCP / custom tools we don't
 * know about.
 *
 * Pure function with no side effects — safe to import from both renderer and
 * main process.
 */

export interface PermissionRuleValidation {
  /** True when the rule is acceptable (possibly after auto-fixing). */
  valid: boolean
  /** Canonical form to actually save. Only present when `valid`. */
  normalized?: string
  /** True when `normalized` differs from the trimmed input. */
  autoFixed?: boolean
  /** Human-readable reason. Only present when `!valid`. */
  error?: string
}

/**
 * Validate (and normalize) a permission rule string.
 *
 * Accepts inputs of the form `ToolName` or `ToolName(args)`. The first letter
 * of the tool name is auto-uppercased so the user can type `add` or `bash(git *)`
 * and have it land as `Add` or `Bash(git *)`. Rules whose tool name starts with
 * `mcp__` are passed through unchanged (MCP tool naming convention).
 */
export function validatePermissionRule(raw: string): PermissionRuleValidation {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { valid: false, error: 'Rule cannot be empty.' }
  }

  // Split optional `(args)` suffix off the tool name. Anything after the
  // first `(` is treated as arguments — we don't try to interpret them.
  const parenIdx = trimmed.indexOf('(')
  const toolName = parenIdx === -1 ? trimmed : trimmed.slice(0, parenIdx)
  const argsPart = parenIdx === -1 ? '' : trimmed.slice(parenIdx)

  if (!toolName) {
    return { valid: false, error: 'Tool name cannot be empty.' }
  }

  // MCP convention: `mcp__server__tool`. Lowercase by design — let it through
  // and defer to Claude Code's own validator. Still enforce the parens check.
  const isMcpTool = toolName.startsWith('mcp__')

  if (!isMcpTool) {
    const firstChar = toolName[0]
    if (!/[A-Za-z]/.test(firstChar)) {
      return { valid: false, error: 'Tool name must start with a letter.' }
    }
  }

  // If the input had a `(`, require a matching trailing `)`. We don't try to
  // balance nested parens — Claude Code's grammar uses a single top-level pair.
  if (argsPart && !argsPart.endsWith(')')) {
    return { valid: false, error: 'Mismatched parentheses — add a closing ")".' }
  }

  // Auto-fix: uppercase the first letter of the tool name when it's lowercase.
  // (Skipped for MCP tools — they keep their lowercase prefix.)
  let normalizedToolName = toolName
  let autoFixed = false
  if (!isMcpTool && /[a-z]/.test(toolName[0])) {
    normalizedToolName = toolName[0].toUpperCase() + toolName.slice(1)
    autoFixed = true
  }

  const normalized = normalizedToolName + argsPart
  return {
    valid: true,
    normalized,
    autoFixed: autoFixed || normalized !== raw
  }
}

/**
 * Filter an array of rule strings, dropping invalid ones and normalizing the
 * rest. Used at the file-write boundary so a stale invalid rule in storage
 * can never reach Claude Code's settings file. Optionally logs dropped rules
 * via the supplied callback for debugging.
 */
export function sanitizePermissionRules(
  rules: readonly string[],
  onDropped?: (rule: string, reason: string) => void
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const rule of rules) {
    const result = validatePermissionRule(rule)
    if (!result.valid || !result.normalized) {
      onDropped?.(rule, result.error ?? 'invalid')
      continue
    }
    if (seen.has(result.normalized)) continue
    seen.add(result.normalized)
    out.push(result.normalized)
  }
  return out
}
