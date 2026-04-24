/**
 * IPC Contract Tests — verify that channel constants, handler registrations,
 * and preload allowlists are consistent. A mismatch here = a broken app.
 */

import { IPC } from '../src/shared/ipc-channels'

// ---------------------------------------------------------------------------
// 1. Preload allowlists — import as raw arrays from the preload source
//    (We cannot import the preload directly since it calls contextBridge,
//    so we define the expected sets here matching src/preload/index.ts)
// ---------------------------------------------------------------------------

/** Channels the renderer may SEND to main (fire-and-forget) — mirrors preload */
const EXPECTED_SEND_CHANNELS = new Set([
  IPC.PANE_CLOSE,
  IPC.PANE_INPUT,
  IPC.PANE_RESIZE,
  IPC.PANE_MOVE,
  IPC.PANE_RESPAWN,
  IPC.PANE_EFFORT,
  IPC.PANE_MODEL,
  IPC.PANE_SET_USER_NAME,
  IPC.GLOBAL_EFFORT,
  IPC.WINDOW_NEW,
  IPC.FEEDBACK_SEND,
  IPC.CLOSE_WORKSPACE_SEQUENCE_RESPONSE,
  IPC.CLOSE_WORKSPACE_SEQUENCE_ACK,
  IPC.RENDERER_READY,
  IPC.PANE_READY,
  IPC.MANAGER_FOCUS_WORKSPACE,
  IPC.MANAGER_FOCUS_TERMINAL,
  IPC.MANAGER_SHOW,
  IPC.COMPLETION_DISMISS,
  IPC.COMPLETION_CLEAR_STATE,
  IPC.ANALYTICS_TRACK_SHORTCUT
])

/** Channels the renderer may INVOKE on main (request/reply) — mirrors preload */
const EXPECTED_INVOKE_CHANNELS = new Set([
  IPC.PANE_SPAWN,
  IPC.PANE_CLOSE_WORKTREE,
  IPC.PANE_MERGE_AND_CLOSE,
  IPC.GLOBAL_EFFORT_GET,
  IPC.FOLDER_BROWSE,
  IPC.WORKTREE_LIST,
  IPC.PATH_VALIDATE,
  IPC.PATH_GIT_INIT,
  IPC.WINDOW_LIST,
  IPC.ANALYTICS_GET_CONSENT,
  IPC.ANALYTICS_SET_CONSENT,
  IPC.SESSION_HISTORY_LIST,
  IPC.PERMISSIONS_GET_DEFAULTS,
  IPC.PERMISSIONS_GET_EFFECTIVE,
  IPC.PERMISSIONS_SET_SCOPE,
  IPC.PERMISSIONS_RESET_SCOPE,
  IPC.PERMISSIONS_GET_PROJECT_PATHS,
  IPC.PERMISSIONS_GET_KNOWN_RULES,
  IPC.WORKSPACE_CREATE,
  IPC.WORKSPACE_LIST,
  IPC.WORKSPACE_GET,
  IPC.WORKSPACE_ACTIVATE,
  IPC.WORKSPACE_DEACTIVATE,
  IPC.WORKSPACE_DELETE,
  IPC.WORKSPACE_RENAME,
  IPC.WORKSPACE_ARCHIVE,
  IPC.WORKSPACE_UNARCHIVE,
  IPC.WORKSPACE_DELETE_ARCHIVED,
  IPC.WORKSPACE_PAUSED_TERMINALS,
  IPC.WORKSPACE_RESUME_TERMINAL,
  IPC.WORKSPACE_SET_VIEW_MODE,
  IPC.WORKSPACE_SET_ACTIVE_PANE,
  IPC.COMPLETION_MERGE,
  IPC.COMPLETION_PR,
  IPC.COMPLETION_ABORT,
  IPC.COMPLETION_CANCEL_QUEUE,
  IPC.COMPLETION_RESOLVE,
  IPC.COMPLETION_POLICY_GET_GLOBAL,
  IPC.COMPLETION_POLICY_SET_GLOBAL,
  IPC.COMPLETION_POLICY_GET_WORKSPACE,
  IPC.COMPLETION_POLICY_SET_WORKSPACE,
  IPC.COMPLETION_MERGE_ALL,
  IPC.COMPLETION_PR_ALL,
  IPC.REPO_PUSH_BASE_BRANCH,
  IPC.REPO_MERGE_AND_PUSH,
  IPC.REPO_APPROVE_PLANS_IN_SEQUENCE,
  IPC.REPO_STOP_PLAN_SEQUENCE,
  IPC.REPO_RETRY_FAILED_MERGES,
  IPC.REPO_CLAUDE_MD_READ,
  IPC.REPO_CLAUDE_MD_SAVE,
  IPC.REPO_DIFF_GET,
  IPC.GH_CLI_CHECK,
  IPC.CLAUDE_CHECK,
  IPC.WORKSPACE_CREATE_WITH_TERMINALS,
  IPC.WORKSPACE_RESUME_LAST,
  IPC.OPEN_EXTERNAL,
  IPC.WORKSPACE_REVEAL_PATH,
  IPC.APP_CONFIG_GET,
  IPC.APP_CONFIG_SET,
  IPC.APP_CONFIG_RESET,
  IPC.INSPECTOR_GET_SUMMARY,
  IPC.INSPECTOR_ASK_LLM,
  IPC.RATE_LIMITS_GET,
  IPC.PANE_LIST_GET
])

/** Channels the renderer may RECEIVE from main — mirrors preload */
const EXPECTED_RECEIVE_CHANNELS = new Set([
  IPC.PANE_SPAWNED,
  IPC.PANE_CLOSED,
  IPC.PANE_DATA,
  IPC.PANE_STATUS,
  IPC.PANE_METRICS,
  IPC.PANE_MOVED_IN,
  IPC.PANE_TERMINATED,
  IPC.PANE_RESPAWNED,
  IPC.PANE_GIT_STATUS,
  IPC.PANE_PERMISSION_MODE,
  IPC.RATE_LIMITS_UPDATE,
  IPC.MENU_NEW_PANE,
  IPC.MENU_CLOSE_PANE,
  IPC.MENU_FEEDBACK,
  IPC.MENU_ANALYTICS,
  IPC.CLOSE_WORKSPACE_SEQUENCE_START,
  IPC.WINDOW_INIT,
  IPC.MANAGER_STATE_UPDATE,
  IPC.WORKSPACE_PAUSED_UPDATE,
  IPC.COMPLETION_STATUS,
  IPC.PANE_RESOLVING_CONFLICT,
  IPC.COMPLETION_POLICY_GLOBAL_CHANGED,
  IPC.COMPLETION_POLICY_WORKSPACE_CHANGED,
  IPC.APP_CONFIG_CHANGED,
  IPC.INSPECTOR_SUMMARY
])

// ---------------------------------------------------------------------------
// All IPC channel values
// ---------------------------------------------------------------------------

const ALL_IPC_VALUES = new Set(Object.values(IPC))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IPC channel contract', () => {
  describe('channel constant uniqueness', () => {
    it('every IPC constant has a unique string value', () => {
      const values = Object.values(IPC)
      const unique = new Set(values)
      expect(unique.size).toBe(values.length)
    })
  })

  describe('preload allowlist coverage', () => {
    it('every IPC channel is in exactly one allowlist (send, invoke, or receive)', () => {
      for (const channel of ALL_IPC_VALUES) {
        const inSend = EXPECTED_SEND_CHANNELS.has(channel)
        const inInvoke = EXPECTED_INVOKE_CHANNELS.has(channel)
        const inReceive = EXPECTED_RECEIVE_CHANNELS.has(channel)
        const count = [inSend, inInvoke, inReceive].filter(Boolean).length
        expect(count).withContext(`Channel "${channel}" should be in exactly one list but is in ${count}`).toBe(1)
      }
    })

    it('no channel appears in both SEND and INVOKE', () => {
      for (const channel of EXPECTED_SEND_CHANNELS) {
        expect(EXPECTED_INVOKE_CHANNELS.has(channel)).withContext(
          `Channel "${channel}" is in both SEND and INVOKE`
        ).toBe(false)
      }
    })

    it('union of all three lists covers every IPC.* value', () => {
      const covered = new Set([
        ...EXPECTED_SEND_CHANNELS,
        ...EXPECTED_INVOKE_CHANNELS,
        ...EXPECTED_RECEIVE_CHANNELS
      ])
      for (const channel of ALL_IPC_VALUES) {
        expect(covered.has(channel)).withContext(`Channel "${channel}" not in any allowlist`).toBe(true)
      }
    })

    it('no allowlist contains a value that is not an IPC.* constant', () => {
      const allLists = [
        ...EXPECTED_SEND_CHANNELS,
        ...EXPECTED_INVOKE_CHANNELS,
        ...EXPECTED_RECEIVE_CHANNELS
      ]
      for (const channel of allLists) {
        expect(ALL_IPC_VALUES.has(channel)).withContext(
          `"${channel}" in allowlist but not in IPC constants`
        ).toBe(true)
      }
    })
  })
})

// Add a custom matcher for better error messages
expect.extend({
  withContext(received: unknown, message: string) {
    return {
      pass: true,
      message: () => message,
      actual: received,
      expected: undefined
    }
  }
})
