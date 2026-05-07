/**
 * turn-projection — synthesise the `Turn[]` view for a pane from git itself.
 *
 * The plan's design (docs/implementation-plan-completion-actions.md §3) is
 * deliberate: turns are NOT a separate persisted store. They're a
 * *projection* over `git log <base>..<branch>` enriched with:
 *
 *   - The `Claudinha-Turn-Id` commit trailer (written by `turn-recorder` on
 *     auto-commit), which gives every wip-commit a stable UUID even if the
 *     subject changes via amend/rebase.
 *   - `git ls-remote origin <branch>` to determine `pushed` state.
 *   - The discarded-turns sidecar (`<worktreePath>/.claudinha-turns.json`),
 *     which records turns the user explicitly discarded so we can include
 *     them as `discarded` in telemetry / undo prompts.
 *
 * Why projection-not-storage:
 *   - The user can `git rebase` the branch from a terminal and the projection
 *     stays consistent with what's actually on disk — no drift, no stale
 *     state surviving a rebase.
 *   - Closing/reopening the modal re-reads from git; cache-invalidation
 *     headaches go away.
 *
 * State derivation (M1 keeps the simplest forms; M2-M5 fill in the rest):
 *   - `open`        — the wip-commit exists on the branch and is not pushed.
 *   - `pushed`      — the commit is reachable from `origin/<branch>`.
 *   - `pr-open`     — M4 wires `gh pr list --head <branch>`.
 *   - `merged`      — M4 derives by checking the publish-commit's reachability
 *                     from local `<base>`.
 *   - `shipped`     — M4 derives from `origin/<base>` reachability.
 *   - `superseded`  — M3 records the original turn-id in the sidecar when
 *                     a split absorbs it.
 *   - `discarded`   — M2 writes the sidecar entry on discard.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import type { BrowserWindow } from 'electron'
import type { Turn, TurnState, TurnPendingAction, DiscardedTurnsSidecar } from '../shared/types'
import { extractTurnIdFromCommitMessage } from './turn-recorder'
import type { WindowManager } from './window-manager'
import { IPC } from '../shared/ipc-channels'
import type { TurnsUpdatedPayload } from '../shared/ipc-channels'

const execFileAsync = promisify(execFile)

/** Filename of the per-worktree discarded-turns sidecar. */
const SIDECAR_FILENAME = '.claudinha-turns.json'

/** Cap on `git log` output we'll pull at once. Branches with thousands of
 *  turns are exceptional; the cap protects against pathological cases. */
const MAX_TURNS_PROJECTED = 500

/**
 * Synthesise the turn list for a single pane.
 *
 * Returns turns in **display order**, oldest first (i.e. the way `git log
 * --reverse` walks them). The renderer reverses for "newest first" display
 * but the projection guarantees stable indices: the oldest open turn is
 * `index: 1` and they renumber 1..N on every projection.
 *
 * Paths that are shared with `turn-recorder` (notably commit-message parsing)
 * live in turn-recorder.ts and are imported here so there's one source of
 * truth per concern.
 */
export async function projectTurnsForPane(
  worktreePath: string,
  paneId: string,
  baseBranch: string,
  currentBranch: string
): Promise<Turn[]> {
  // 1. List commits on the worktree branch beyond the merge-base with base.
  //    `--reverse` walks oldest → newest, which matches the user's mental
  //    model of "Turn 1" being the first thing the agent did.
  //    Format: <sha>|<parent>|<author-epoch>|<subject>|<body>
  //    Bodies need a separator that doesn't appear naturally; use \x1f
  //    (unit-separator) as the inner field delimiter and \x1e (record-
  //    separator) between commits.
  const FIELD = '\x1f'
  const RECORD = '\x1e'
  const FORMAT = `%H${FIELD}%P${FIELD}%at${FIELD}%s${FIELD}%b${RECORD}`

  let logOut: string
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', `${baseBranch}..${currentBranch}`, '--reverse', `--pretty=format:${FORMAT}`],
      { cwd: worktreePath, maxBuffer: 8 * 1024 * 1024 }
    )
    logOut = stdout
  } catch {
    // baseBranch might not exist (fresh repo, etc.). Treat as no turns.
    return []
  }

  // 2. Parse records.
  type RawCommit = {
    sha: string
    parents: string[]
    authorTime: number
    subject: string
    body: string
  }
  const records: RawCommit[] = []
  for (const chunk of logOut.split(RECORD)) {
    const trimmed = chunk.replace(/^\n+/, '')
    if (!trimmed) continue
    const parts = trimmed.split(FIELD)
    if (parts.length < 5) continue
    const sha = (parts[0] ?? '').trim()
    const parents = (parts[1] ?? '').trim().split(/\s+/).filter(Boolean)
    const authorTime = Number.parseInt((parts[2] ?? '0').trim(), 10) || 0
    const subject = parts[3] ?? ''
    const body = parts[4] ?? ''
    if (!sha) continue
    records.push({ sha, parents, authorTime, subject, body })
    if (records.length >= MAX_TURNS_PROJECTED) break
  }
  if (records.length === 0) return []

  // 3. Compute per-commit numstat in one shot (cheaper than per-commit calls).
  //    We populate `additions` / `deletions` / `filesChanged`.
  const numstat = await collectNumstats(worktreePath, baseBranch, currentBranch)

  // 4. Determine `pushed` set. M1 only checks origin/<branch>; M4 will fold
  //    in PR + merged/shipped probes.
  const pushedShas = await collectPushedShas(worktreePath, currentBranch)

  // 5. Read discarded-turns sidecar so we can mark `superseded` / future
  //    `discarded` rows. M1 doesn't need to surface discarded yet (M2 builds
  //    that flow), but reading it now means the projection is consistent.
  const sidecar = await readDiscardedSidecar(worktreePath)

  // 6. Build Turn objects.
  const turns: Turn[] = records.map((rec, i) => {
    const fullMessage = `${rec.subject}\n\n${rec.body}`
    const turnId = extractTurnIdFromCommitMessage(fullMessage) ?? legacyTurnId(rec.sha)
    const supersededBy =
      Object.values(sidecar.discarded).find((entry) => entry.commitSha === rec.sha)?.supersededBy

    const state: TurnState = supersededBy && supersededBy.length > 0
      ? 'superseded'
      : pushedShas.has(rec.sha)
        ? 'pushed'
        : 'open'

    const stats = numstat.get(rec.sha) ?? { filesChanged: 0, additions: 0, deletions: 0 }

    return {
      id: turnId,
      paneId,
      index: i + 1,
      commitSha: rec.sha,
      parentCommitSha: rec.parents[0] ?? '',
      summary: cleanSubject(rec.subject),
      filesChanged: stats.filesChanged,
      additions: stats.additions,
      deletions: stats.deletions,
      createdAt: rec.authorTime * 1000,
      state,
      publishCommitSha: null, // M4 fills this when squash-publish lands
      prUrl: null
    }
  })

  return turns
}

/**
 * Stable fallback ID for legacy commits that pre-date the turn-recorder
 * trailer. Uses the commit sha so the same commit always produces the same
 * id across projection runs.
 */
function legacyTurnId(commitSha: string): string {
  return `legacy:${commitSha.slice(0, 12)}`
}

/**
 * Strip the `wip(turn-N): ` prefix from the subject for the displayed
 * summary. Falls back to the raw subject if no prefix matches (e.g.
 * non-claudinha commits the user landed manually).
 */
function cleanSubject(subject: string): string {
  return subject.replace(/^wip\(turn-\d+\):\s*/, '')
}

/**
 * Run `git diff --numstat` between two refs and collect per-commit stats
 * by walking each commit individually. We can't use a single ref-range
 * diff because the projection wants per-commit deltas, not the cumulative
 * branch delta.
 *
 * Performance: for each turn, one `git show --numstat` call. Branches with
 * dozens of turns will have noticeable startup cost on cold cache; M6 may
 * memoize per-sha results.
 */
async function collectNumstats(
  worktreePath: string,
  baseBranch: string,
  currentBranch: string
): Promise<Map<string, { filesChanged: number; additions: number; deletions: number }>> {
  const out = new Map<string, { filesChanged: number; additions: number; deletions: number }>()
  let commits: string[]
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', `${baseBranch}..${currentBranch}`],
      { cwd: worktreePath, maxBuffer: 1024 * 1024 }
    )
    commits = stdout.trim().split('\n').filter(Boolean)
  } catch {
    return out
  }

  for (const sha of commits) {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', '--numstat', '--format=', sha],
        { cwd: worktreePath, maxBuffer: 4 * 1024 * 1024 }
      )
      let files = 0
      let added = 0
      let removed = 0
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue
        const cols = line.split('\t')
        if (cols.length < 3) continue
        files += 1
        // Binary files report '-' for both numbers.
        added += Number.parseInt(cols[0]!, 10) || 0
        removed += Number.parseInt(cols[1]!, 10) || 0
      }
      out.set(sha, { filesChanged: files, additions: added, deletions: removed })
    } catch {
      // Per-commit failure: leave it out of the map. Caller substitutes 0s.
    }
  }
  return out
}

/**
 * Resolve the set of commit shas that `origin/<branch>` reaches. M1 uses
 * this as the sole `pushed`-state determinant. If the remote ref doesn't
 * exist (`git rev-parse` fails), we return the empty set — meaning every
 * commit on the local branch is `open`, which matches the user's mental
 * model of "I haven't published this yet."
 */
async function collectPushedShas(worktreePath: string, currentBranch: string): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    // First check the remote ref exists.
    await execFileAsync('git', ['rev-parse', '--verify', `refs/remotes/origin/${currentBranch}`], {
      cwd: worktreePath
    })
  } catch {
    return out
  }
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', `origin/${currentBranch}`],
      { cwd: worktreePath, maxBuffer: 8 * 1024 * 1024 }
    )
    for (const sha of stdout.split('\n')) {
      const trimmed = sha.trim()
      if (trimmed) out.add(trimmed)
    }
  } catch {
    // ignore
  }
  return out
}

/**
 * Read the discarded-turns sidecar. Missing file → empty record.
 * Malformed JSON → log a warning and treat as empty (we never throw on the
 * read path because the projection has to keep working).
 */
export async function readDiscardedSidecar(worktreePath: string): Promise<DiscardedTurnsSidecar> {
  const filePath = path.join(worktreePath, SIDECAR_FILENAME)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return { version: 1, discarded: {} }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DiscardedTurnsSidecar>
    if (parsed.version !== 1 || typeof parsed.discarded !== 'object' || parsed.discarded === null) {
      console.warn('[turn-projection] sidecar shape mismatch, treating as empty')
      return { version: 1, discarded: {} }
    }
    return parsed as DiscardedTurnsSidecar
  } catch (err) {
    console.warn('[turn-projection] failed to parse sidecar:', err instanceof Error ? err.message : err)
    return { version: 1, discarded: {} }
  }
}

/**
 * Write the discarded-turns sidecar. Used by `discard-engine` (M2) and
 * `publish-engine.splitTurn` (M3). Atomic in the conventional sense:
 * write to a temp file, rename. Best-effort — never throws.
 */
export async function writeDiscardedSidecar(
  worktreePath: string,
  sidecar: DiscardedTurnsSidecar
): Promise<void> {
  const filePath = path.join(worktreePath, SIDECAR_FILENAME)
  const tmpPath = `${filePath}.tmp`
  const payload = JSON.stringify(sidecar, null, 2)
  try {
    await fs.writeFile(tmpPath, payload, 'utf8')
    await fs.rename(tmpPath, filePath)
  } catch (err) {
    console.warn(
      '[turn-projection] failed to write sidecar:',
      err instanceof Error ? err.message : err
    )
    // Try to clean up the tmp file but don't escalate.
    try { await fs.unlink(tmpPath) } catch { /* ignore */ }
  }
}

/**
 * Send a fresh TURNS_UPDATED IPC for a pane. Wraps `projectTurnsForPane`
 * so callers (turn-recorder, publish-engine, ipc-handlers) emit the same
 * shape every time.
 */
export async function broadcastTurnsUpdated(
  windowManager: WindowManager,
  windowId: string,
  paneId: string,
  ctx: {
    worktreePath: string
    baseBranch: string
    currentBranch: string
    autoCommitEnabled: boolean
    pendingAction: TurnPendingAction | null
  }
): Promise<void> {
  const win: BrowserWindow | undefined = windowManager.getWindow(windowId)
  if (!win || win.isDestroyed()) return
  const turns = await projectTurnsForPane(
    ctx.worktreePath,
    paneId,
    ctx.baseBranch,
    ctx.currentBranch
  )
  const payload: TurnsUpdatedPayload = {
    paneId,
    turns,
    pendingAction: ctx.pendingAction,
    autoCommitEnabled: ctx.autoCommitEnabled
  }
  win.webContents.send(IPC.TURNS_UPDATED, payload)
}
