/**
 * Map a Claude Code tool name to a present-continuous activity phrase used
 * in pane status surfaces (Kanban card activity row, Wall status pill,
 * PaneHeader kanban chip).
 *
 * The phrase reads as something Claude is actively doing right now —
 * "Reading", "Editing", "Running command" — so a glance at a card tells the
 * user what the agent is actually up to without parsing the verbatim tool
 * identifier. Unknown / MCP tools fall back to "Using <name>" so we never
 * silently misrepresent something we don't recognize.
 */
const TOOL_ACTIVITY: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  Write: 'Writing',
  MultiEdit: 'Editing',
  Bash: 'Running command',
  BashOutput: 'Reading output',
  KillBash: 'Stopping process',
  Grep: 'Searching',
  Glob: 'Finding files',
  NotebookRead: 'Reading notebook',
  NotebookEdit: 'Editing notebook',
  WebFetch: 'Fetching URL',
  WebSearch: 'Searching web',
  Task: 'Delegating',
  TodoWrite: 'Updating tasks',
  Skill: 'Running skill',
  ToolSearch: 'Searching tools',
  ExitPlanMode: 'Awaiting plan approval',
  AskUserQuestion: 'Asking question'
}

export function formatToolActivity(toolName: string): string {
  const known = TOOL_ACTIVITY[toolName]
  if (known) return known
  // MCP tools are namespaced as `mcp__server__action`. Strip the namespace
  // so the user sees the action name rather than the wire-level identifier.
  if (toolName.startsWith('mcp__')) {
    const action = toolName.split('__').pop() ?? toolName
    return `Using ${action}`
  }
  return `Using ${toolName}`
}
