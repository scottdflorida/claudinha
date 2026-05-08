import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { IpcChannel } from '../shared/ipc-channels'

// ---------------------------------------------------------------------------
// Channel allowlists — enforce at runtime which channels can be used in each
// direction. Prevents the renderer from sending/listening on arbitrary channels.
// ---------------------------------------------------------------------------

/** Channels the renderer may SEND to main (one-way fire-and-forget) */
const SEND_CHANNELS = new Set<IpcChannel>([
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
  // Workspace management
  IPC.MANAGER_FOCUS_WORKSPACE,
  IPC.MANAGER_FOCUS_TERMINAL,
  IPC.MANAGER_SHOW,
  // Completion actions
  IPC.COMPLETION_DISMISS,
  IPC.COMPLETION_CLEAR_STATE,
  // Analytics — renderer-originated event signals (fire-and-forget)
  IPC.ANALYTICS_TRACK_SHORTCUT
  // Note: Completion v2 channels (TURN_*, BULK_*, REPO_PUBLISH_PATH_*,
  // WORKSPACE_DEFAULT_PATH_*, MERGE_CONFLICT_RESOLVE) are all invoke-style;
  // see INVOKE_CHANNELS below.
])

/** Channels the renderer may INVOKE on main (request/reply) */
const INVOKE_CHANNELS = new Set<IpcChannel>([
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
  // Workspace management
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
  // Completion actions
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
  IPC.GIT_COMMIT_DIRTY_MAIN,
  IPC.GIT_STASH_DIRTY_MAIN,
  IPC.GIT_DISCARD_DIRTY_MAIN,
  IPC.GIT_COMMIT_ALL,
  IPC.GIT_PANE_COMMIT_LOG,
  IPC.GIT_REWORD_COMMIT,
  IPC.GIT_LIST_BRANCHES,
  IPC.GH_CLI_CHECK,
  // Completion actions v2 — turn-as-commit (Option B)
  IPC.TURNS_GET,
  IPC.TURN_PUBLISH_SQUASH,
  IPC.TURN_PUBLISH_INDIVIDUAL,
  IPC.TURN_SPLIT,
  IPC.TURN_DISCARD,
  IPC.TURN_GET_DIFF,
  IPC.TURN_AUTO_COMMIT_TOGGLE,
  IPC.REPO_PUBLISH_PATH_GET,
  IPC.REPO_PUBLISH_PATH_SET,
  IPC.WORKSPACE_DEFAULT_PATH_GET,
  IPC.WORKSPACE_DEFAULT_PATH_SET,
  IPC.REPO_TURNS_GET,
  IPC.BULK_RUN,
  IPC.BULK_CANCEL,
  IPC.MERGE_CONFLICT_RESOLVE,
  // App config
  IPC.APP_CONFIG_GET,
  IPC.APP_CONFIG_SET,
  IPC.APP_CONFIG_RESET,
  // Inspector
  IPC.INSPECTOR_GET_SUMMARY,
  IPC.INSPECTOR_ASK_LLM,
  // Onboarding flow
  IPC.CLAUDE_CHECK,
  IPC.WORKSPACE_CREATE_WITH_TERMINALS,
  IPC.WORKSPACE_ADD_TERMINALS,
  IPC.WORKSPACE_RESUME_LAST,
  IPC.OPEN_EXTERNAL,
  IPC.WORKSPACE_REVEAL_PATH,
  // Rate limits (PE-01)
  IPC.RATE_LIMITS_GET,
  // Pane rehydrate (mount-time seed for usePaneState)
  IPC.PANE_LIST_GET
])

/** Channels the renderer may RECEIVE from main (event streams) */
const RECEIVE_CHANNELS = new Set<IpcChannel>([
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
  // Workspace management
  IPC.WINDOW_INIT,
  IPC.MANAGER_STATE_UPDATE,
  IPC.WORKSPACE_PAUSED_UPDATE,
  IPC.WORKSPACE_INITIAL_SPAWN_BEGIN,
  IPC.WORKSPACE_INITIAL_SPAWN_COMPLETE,
  IPC.WORKSPACE_FOCUS_PANE,
  // Completion actions
  IPC.COMPLETION_STATUS,
  IPC.PANE_RESOLVING_CONFLICT,
  IPC.COMPLETION_POLICY_GLOBAL_CHANGED,
  IPC.COMPLETION_POLICY_WORKSPACE_CHANGED,
  // Completion actions v2 — turn-as-commit broadcasts
  IPC.TURN_RECORDED,
  IPC.TURNS_UPDATED,
  IPC.TURN_PENDING_ACTION,
  IPC.BULK_PROGRESS,
  IPC.BULK_COMPLETED,
  // App config
  IPC.APP_CONFIG_CHANGED,
  // Inspector
  IPC.INSPECTOR_SUMMARY
])

// ---------------------------------------------------------------------------
// Listener wrapper registry
// Maps user-provided listener → electron IPC wrapper so removeListener works.
// Keyed by [channel][listener] so the same function can be registered on
// multiple channels independently.
// ---------------------------------------------------------------------------

type UserListener = (payload: unknown) => void
type ElectronListener = Parameters<typeof ipcRenderer.on>[1]

const listenerRegistry = new Map<string, Map<UserListener, ElectronListener>>()

function getChannelRegistry(channel: string): Map<UserListener, ElectronListener> {
  let map = listenerRegistry.get(channel)
  if (!map) {
    map = new Map()
    listenerRegistry.set(channel, map)
  }
  return map
}

// ---------------------------------------------------------------------------
// The API object exposed to the renderer via contextBridge.
// No ipcRenderer reference is exposed — the renderer can only use this object.
// ---------------------------------------------------------------------------

const api = {
  /**
   * Send a fire-and-forget message to the main process.
   * Only channels in SEND_CHANNELS are permitted.
   */
  send(channel: IpcChannel, payload?: unknown): void {
    if (SEND_CHANNELS.has(channel)) {
      ipcRenderer.send(channel, payload)
    }
  },

  /**
   * Register a listener for events arriving from the main process.
   * Only channels in RECEIVE_CHANNELS are permitted.
   * The listener receives only the payload (the IpcRendererEvent is stripped).
   */
  on(channel: IpcChannel, listener: UserListener): void {
    if (!RECEIVE_CHANNELS.has(channel)) return
    const registry = getChannelRegistry(channel)
    if (registry.has(listener)) return // already registered
    const wrapped: ElectronListener = (_event, payload) => listener(payload)
    registry.set(listener, wrapped)
    ipcRenderer.on(channel, wrapped)
  },

  /**
   * Remove a previously registered listener.
   * Only channels in RECEIVE_CHANNELS are permitted.
   */
  off(channel: IpcChannel, listener: UserListener): void {
    if (!RECEIVE_CHANNELS.has(channel)) return
    const registry = getChannelRegistry(channel)
    const wrapped = registry.get(listener)
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped)
      registry.delete(listener)
    }
  },

  /**
   * Invoke a main-process handler and await its response.
   * Only channels in INVOKE_CHANNELS are permitted.
   */
  invoke(channel: IpcChannel, payload?: unknown): Promise<unknown> {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`invoke: channel not permitted: ${channel}`))
    }
    return ipcRenderer.invoke(channel, payload)
  }
} as const

export type ElectronApi = typeof api

contextBridge.exposeInMainWorld('api', api)
