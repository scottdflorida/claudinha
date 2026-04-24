import { app } from 'electron'
import { trackEvent } from './analytics-bus'
import { getInstallationId } from './analytics-config'
import { makeEvent } from '../../shared/analytics-events'
import type { EventContext } from '../../shared/analytics-events'

// ---------------------------------------------------------------------------
// Workspace lifecycle telemetry
//
// Fires on create / archive / unarchive / permanent-delete. Only enum type
// and rolled-up counts are transmitted — never workspace names or paths.
// ---------------------------------------------------------------------------

function ctx(): EventContext {
  return {
    installation_id: getInstallationId(),
    app_version: app.getVersion(),
    platform: process.platform
  }
}

export function trackWorkspaceCreated(workspaceType: string, workspaceCount: number): void {
  try {
    trackEvent(
      makeEvent(ctx(), {
        event_name: 'workspace_created',
        workspace_type: workspaceType,
        workspace_count: workspaceCount
      })
    )
  } catch {
    // Never throw from instrumentation
  }
}

export function trackWorkspaceArchived(workspaceType: string, archivedCount: number): void {
  try {
    trackEvent(
      makeEvent(ctx(), {
        event_name: 'workspace_archived',
        workspace_type: workspaceType,
        archived_count: archivedCount
      })
    )
  } catch {
    // Never throw from instrumentation
  }
}

export function trackWorkspaceUnarchived(workspaceType: string): void {
  try {
    trackEvent(
      makeEvent(ctx(), {
        event_name: 'workspace_unarchived',
        workspace_type: workspaceType
      })
    )
  } catch {
    // Never throw from instrumentation
  }
}

export function trackWorkspaceDeletedArchived(workspaceType: string): void {
  try {
    trackEvent(
      makeEvent(ctx(), {
        event_name: 'workspace_deleted_archived',
        workspace_type: workspaceType
      })
    )
  } catch {
    // Never throw from instrumentation
  }
}
