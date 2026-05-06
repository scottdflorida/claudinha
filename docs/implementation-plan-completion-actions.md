# Implementation Plan: Completion Actions (Option B)

**Status:** plan · ready for execution
**Branch:** `claude/research-completion-actions-Kczpw` (research only;
implementation will happen on follow-up branches)
**Companion doc:** [`docs/research-completion-actions.md`](./research-completion-actions.md)
**Date:** 2026-05-06

This plan operationalises Option B (turn-as-commit) per the resolved
decisions in §9 of the research doc. It covers what to delete, what to
build, what order to build it, and what to test. Read the research doc
first for the *why*; this doc is the *how*.

---

## 1. Scope

In scope:
- Auto-commit each agent turn as a `wip(turn-N)` commit on the
  worktree branch.
- A per-terminal modal that lists turns, expands diffs, and offers
  publish / split / discard.
- A repo-level modal that aggregates agents, filters by state, and
  offers bulk actions.
- Per-repo Publish-path config (`direct-merge` | `pr` | `both`) with
  workspace-launch default.
- Side-clone-driven direct merges that don't require a clean main.
- Hunk-level split at publish time and at discard time.
- Skip-and-surface bulk-merge with multi-conflict modal.
- Telemetry for every user action.

Out of scope (explicitly):
- Persistence of unpublished turns across paused-terminal snapshots
  (Q8: deferred).
- Automatic completion policies (replaced by user-driven actions —
  see Demolition §2).
- Stacked-diff / dependent-PR workflows (future, if at all).
- Cross-repo bulk actions (the repo-level modal is per-repo only).

---

## 2. Demolition

The existing completion-actions stack is removed wholesale. The
research doc commits to Option B, which doesn't share storage or
policy semantics with what's there. The list below is approximate;
the engineer doing the work owns the final boundary.

**Delete**
- `src/main/completion-executor.ts` — replaced by the action engine
  in §5.
- `src/main/merge-queue.ts` — replaced by the bulk pipeline in §5.
- `src/main/completion-policy-store.ts` — completion policies don't
  exist in the new model.
- `src/renderer/components/ChangesReadyModal.tsx` — replaced by
  `TurnsModal.tsx`.
- `src/renderer/components/DirtyMainModal.tsx` — side-clone merges
  remove the dirty-main constraint for merges. (If any non-merge flow
  still touches main, keep that bit.)
- `src/renderer/components/PolicyPopover.tsx` — no per-session policy.
- Completion-policy fields on `Workspace` and `PaneState` (gated by a
  one-time migration in `migrate-user-data.ts`).
- All `COMPLETION_*` IPC channels and their handlers.
- Strings related to completion policies in `lib/strings/{en,pt-BR}.ts`.

**Keep / extend**
- `src/main/git-status.ts` — extend with the new ops listed in §5.
  Don't rewrite; the lock-retry pattern stays.
- `src/main/git-status-poller.ts` — keep as-is. Becomes one of the
  signals feeding turn-state computation.
- `src/main/hook-listener.ts`, `src/main/status-detector.ts` — keep.
  We hook into `Stop` from a new module rather than modifying these.
- `src/renderer/components/DiffViewerModal.tsx` — reuse for
  diff rendering inside the new modal.
- `src/renderer/components/ConflictResolveModal.tsx` — extend to
  participate in the multi-conflict flow.

**Migrate**
- `migrate-user-data.ts` strips dead completion-policy fields from
  stored workspaces on first launch after upgrade. No user data is
  lost.

---

## 3. Domain model additions

New types in `src/shared/types.ts`:

```ts
type TurnState =
  | 'open'         // wip-commit on worktree branch, no publish action yet
  | 'pushed'       // worktree branch pushed to origin (PR-able)
  | 'pr-open'      // PR exists for the publish commit derived from this turn
  | 'merged'       // publish commit is on base branch locally
  | 'shipped'      // base branch is on origin (terminal "done" state)
  | 'superseded'   // a later split/squash absorbed this turn-commit
  | 'discarded'    // explicitly dropped by the user

type TurnPendingAction =
  | { kind: 'publishing-squash'; selectedTurnIds: string[] }
  | { kind: 'publishing-individual'; selectedTurnIds: string[] }
  | { kind: 'splitting'; turnId: string }
  | { kind: 'discarding'; turnId: string }

interface Turn {
  id: string                   // stable UUID
  paneId: string
  index: number                // sequential display number; renumbers on discard
  commitSha: string            // wip-commit sha on worktree branch
  parentCommitSha: string
  summary: string              // Haiku one-liner
  filesChanged: number
  additions: number
  deletions: number
  createdAt: number            // ms epoch
  state: TurnState
  publishCommitSha: string | null  // populated after publish
  prUrl: string | null             // populated after PR
}

interface PublishPathConfig {
  scope: 'workspace' | 'repo'
  value: 'direct-merge' | 'pr' | 'both'
}

interface Repo {
  // existing fields…
  publishPath: PublishPathConfig['value']  // resolved (per-repo override of workspace default)
}

interface Workspace {
  // existing fields…
  defaultPublishPath: PublishPathConfig['value']  // chosen at launch
  // completionPolicy field removed (see Demolition)
}

interface PaneState {
  // existing fields…
  autoCommitEnabled: boolean    // session-scoped toggle (default true)
  turns: Turn[]                 // newest first; capped or paginated as needed
  pendingAction: TurnPendingAction | null
}
```

Notes:
- `Turn.id` is a stable UUID generated when the wip-commit is created.
  Used in IPC payloads, telemetry, and as React keys.
- `Turn.index` renumbers on discard so the UI shows a tidy sequence;
  IDs stay stable for everything else (Scenario 4 in research §6).
- `Turn` is **synthesised** on read from git log (`git log
  worktree-branch..HEAD-of-base`, then enriched from a sidecar
  `notes` ref or commit-trailers we add on auto-commit). Not persisted
  separately. This avoids drift; see §11.
- `PaneState.turns` is the synthesised projection used by the
  renderer; the source of truth is git itself.

---

## 4. State machine: a turn's lifecycle

```
              ┌─────────┐
              │  open   │  ← created when auto-commit fires on Stop
              └────┬────┘
                   │
        ┌──────────┼──────────────────────────────┐
        │ publish  │ split                        │ discard
        ▼          ▼                              ▼
   ┌─────────┐  ┌────────────────────┐      ┌───────────┐
   │ pushed  │  │ open (N children)  │      │ discarded │
   └────┬────┘  │ original = super-  │      │ (terminal)│
        │       │  seded             │      └───────────┘
        │       └────────────────────┘
        │
   ┌────▼────┐
   │ pr-open │  (only if path = pr)
   └────┬────┘
        │
   ┌────▼────┐
   │ merged  │
   └────┬────┘
        │
   ┌────▼────┐
   │ shipped │  ← terminal "done"
   └─────────┘
```

State computation rules (run after every git operation and on poll):
- **open** if commit is between `worktree-branch HEAD` and the latest
  publish-commit AND `worktree-branch` is not on origin past this
  commit.
- **pushed** if commit is reachable from `origin/<worktree-branch>`
  but not from `origin/<base>`.
- **pr-open** if a PR exists for `<worktree-branch>` (probed via
  `gh pr list --head <branch>`).
- **merged** if commit's "publish parent" is reachable from local
  `<base>`.
- **shipped** if "publish parent" is reachable from `origin/<base>`.
- **superseded** if the wip-commit was rewritten by a split (recorded
  in commit notes; otherwise the commit is just gone and the Turn
  vanishes from the projection).
- **discarded** if the wip-commit was dropped via discard (recorded
  in a per-pane "discarded turns" sidecar, since git won't show it
  anymore — needed for telemetry and undo-warning UX).

State transitions are **derived**, not stored. Every transition is
the result of a git operation we ran or observed.

---

## 5. Main-process modules

New / changed modules in `src/main/`:

| Module                          | Responsibility                                                                   | Notes |
|---------------------------------|----------------------------------------------------------------------------------|-------|
| `turn-recorder.ts`              | Listens for Stop hooks, runs auto-commit, emits `TURN_RECORDED`                  | New   |
| `turn-projection.ts`            | Synthesises `Turn[]` from git log per pane; called on demand and on git changes  | New   |
| `publish-engine.ts`             | Squash, individual-publish, split-a-turn; runs interactive rebases               | New   |
| `discard-engine.ts`             | Drop a turn-commit and rebase dependents; surfaces conflicts to the renderer    | New   |
| `merge-runner.ts`               | Side-clone setup + per-agent direct merge; pushes base                           | New   |
| `pr-runner.ts`                  | Push branch + `gh pr create` + parses PR URL                                     | New   |
| `bulk-action-pipeline.ts`       | Iterates a selection of agents, runs an action per agent, accumulates results    | New   |
| `side-clone-manager.ts`         | Creates/GCs `.worktrees/.merge-staging/` per repo                                | New   |
| `git-status.ts`                 | Existing; add: `gitInteractiveRebase`, `gitNoteAdd`, `gitNoteRead`, `gitApplyHunk` | Extend |
| `hook-listener.ts`              | Existing; emit a fan-out event on Stop that `turn-recorder` subscribes to       | Tiny extend |
| `analytics/events.ts`           | Add the event set from research §9                                              | Extend |

`turn-recorder` flow:
1. On Stop hook for pane P, check `gitStatus(P.worktreePath)`.
2. If working tree dirty:
   - `git add -A`
   - Generate Haiku summary of the staged diff (reuse Inspector
     pipeline).
   - `git commit -m "wip(turn-N): <summary>"` with a turn-UUID
     trailer.
   - Emit `TURN_RECORDED` to renderer.
3. If working tree clean: no-op (Stop with no edits = no turn).
4. If `autoCommitEnabled === false` for the pane: no-op.

`turn-projection` flow:
1. `git log <base>..<worktree-branch> --reverse --pretty=fuller`
   yields the wip and publish commits.
2. Read each commit's UUID trailer (or generate one for legacy commits
   created externally).
3. Read sidecar discarded-turns file (`.worktrees/wt-<branch>/.claudinha-turns.json`)
   for telemetry of discarded.
4. Probe `git ls-remote origin <branch>` and `gh pr list --head
   <branch>` to populate `pushed` / `pr-open` states.
5. Returns `Turn[]` ordered newest-first.

`publish-engine.squashAndPublish(paneId, turnIds, message, path)`:
1. Resolve turnIds to commit-shas.
2. Verify they're contiguous on the worktree branch (or fail with
   "selection must be contiguous for squash").
3. `git rebase -i <oldest-turn-parent>` with `pick` for the oldest,
   `squash` for the rest, applying `message`. Done via `GIT_SEQUENCE_EDITOR`
   to script the rebase non-interactively.
4. The resulting commit is the **publish commit**. Annotate with a
   note: "publish-of: <turn-uuids>".
5. Run `path` (push, push+pr, or merge) via `pr-runner` or
   `merge-runner`.

`publish-engine.splitTurn(paneId, turnId, hunkSelections, leftMessage, rightMessage)`:
1. `git rebase -i <turn-parent>` with `edit` for the turn.
2. At the `edit` stop: `git reset HEAD^`.
3. `git apply --cached` for the hunks marked left → `git commit -m leftMessage`.
4. `git add -A` for the rest → `git commit -m rightMessage`.
5. `git rebase --continue`.
6. Annotate the original turn-commit's UUID with "superseded-by:
   <new-uuids>" in the discarded-turns sidecar.

`discard-engine.discardTurn(paneId, turnId)`:
1. `git rebase --onto <turn-parent> <turn-sha> <branch-head>`.
2. If conflict during replay of dependents: abort, return list of
   dependent turns to renderer with "discard cascade required?"
   prompt.
3. Otherwise record in discarded-turns sidecar.

`merge-runner` flow (direct-merge path):
1. Resolve side-clone path via `side-clone-manager.ensure(repoPath)`.
2. In side-clone: `git fetch origin <base> <worktree-branch>`,
   `git checkout <base>`, `git merge --ff-only` if possible else
   `git merge --no-ff <worktree-branch>`.
3. On success: `git push origin <base>`. Then attempt to fast-forward
   user's actual main if it's clean (best-effort; failure here is not
   fatal — origin already has the commit).
4. On conflict: `git merge --abort` in side-clone; return conflict
   info.

`side-clone-manager`:
- `ensure(repoPath)` lazily creates `.worktrees/.merge-staging/` as a
  full clone (or a worktree of `<base>`).
- `gc(repoPath)` removes it when no agents in the repo have pending
  publishes.
- One side-clone per repo. Acquire a per-repo mutex to serialise
  merges within the bulk pipeline.

`bulk-action-pipeline.run(paneIds, action)`:
1. For each paneId, run `action` (merge, push, pr, discard, …).
2. Collect `{ paneId, result }` pairs.
3. Emit progress events (`BULK_PROGRESS`) on each completion.
4. On finish, emit `BULK_COMPLETED` with full results.
5. Conflicts and failures are *recorded*, not thrown — the pipeline
   doesn't stop.

---

## 6. Renderer components

New / changed components in `src/renderer/components/`:

| Component                         | Purpose                                                                  |
|-----------------------------------|--------------------------------------------------------------------------|
| `TurnsModal.tsx`                  | Per-terminal modal; replaces `ChangesReadyModal.tsx`                     |
| `TurnRow.tsx`                     | One row in the turns list; expands to inline diff                        |
| `PublishDropdown.tsx`             | Squash / individual / split menu; respects repo's Publish-path config    |
| `HunkPickerModal.tsx`             | Split-a-turn UI; checkboxes per hunk + two commit-message fields         |
| `DiscardConfirmDialog.tsx`        | Confirm + cascade-warning dialog                                         |
| `RepoChangesModal.tsx`            | Repo-level aggregate modal with filter chips and bulk actions            |
| `BulkActionsBar.tsx`              | Sticky bottom bar with selection-count and valid bulk actions            |
| `MultiConflictModal.tsx`          | Post-bulk-merge surface listing conflicting agents with resolution paths |
| `PublishPathConfigDropdown.tsx`   | Per-repo config; exposed in repo modal header                            |
| `WorkspaceLaunchPathStep.tsx`     | One-step add to workspace launch dialog: pick default Publish path       |
| `AutoCommitPill.tsx`              | Per-session toggle in the per-terminal modal header                      |

Hooks (`src/renderer/hooks/`):
- `useTurns(paneId)` — subscribes to `TURNS_UPDATED` for a pane;
  returns `{ turns, pendingAction }`.
- `useRepoAggregation(repoPath)` — derives the repo modal's data
  from `useTurns` over all panes in the repo.
- `useBulkAction(repoPath)` — manages selection state + dispatches
  bulk actions; surfaces progress.

KanbanCard / KanbanRepoCard changes:
- The "changes-ready" pill on a Kanban card opens `TurnsModal` for
  that pane.
- The repo card surfaces "N pending across M agents" and clicking it
  opens `RepoChangesModal`.

---

## 7. IPC channels

Append to `src/shared/ipc-channels.ts`:

| Channel                       | Direction      | Purpose                                                     |
|-------------------------------|----------------|-------------------------------------------------------------|
| `TURN_RECORDED`               | main → render  | New wip-commit landed for a pane                            |
| `TURNS_UPDATED`               | main → render  | Full turn projection for a pane refreshed                   |
| `TURNS_GET`                   | render → main  | Fetch the current turn projection for a pane (post-reload)  |
| `TURN_PUBLISH_SQUASH`         | render → main  | `{ paneId, turnIds, message, path }`                        |
| `TURN_PUBLISH_INDIVIDUAL`     | render → main  | `{ paneId, turnIds, path }`                                 |
| `TURN_SPLIT`                  | render → main  | `{ paneId, turnId, hunkSelections, leftMsg, rightMsg }`     |
| `TURN_DISCARD`                | render → main  | `{ paneId, turnId, cascadeConfirmed }`                      |
| `TURN_AUTO_COMMIT_TOGGLE`     | render → main  | `{ paneId, enabled }`                                       |
| `REPO_PUBLISH_PATH_SET`       | render → main  | `{ repoPath, path }`                                        |
| `WORKSPACE_DEFAULT_PATH_SET`  | render → main  | `{ workspaceId, path }`                                     |
| `BULK_RUN`                    | render → main  | `{ repoPath, paneIds, action }`                             |
| `BULK_PROGRESS`               | main → render  | `{ runId, paneId, result, completed, total }`               |
| `BULK_COMPLETED`              | main → render  | `{ runId, results }` (full)                                 |
| `MERGE_CONFLICT_RESOLVE`      | render → main  | `{ paneId, kind: 'manual'|'punt-claude'|'discard' }`        |

All payloads typed in `src/shared/ipc-channels.ts` and exported.

---

## 8. Phased delivery

Six milestones. Each ends with a working app the user can dogfood;
nothing is "unshippable until M6."

### M0: Demolition + scaffolding
- Delete the modules listed in §2.
- Add type stubs from §3 (no functionality yet).
- Add IPC channel constants.
- Migration in `migrate-user-data.ts` strips dead workspace fields.
- Stub `TurnsModal` with "coming soon" content reachable from the
  changes-ready pill.
- Tests still pass (vitest).

**Ship criterion:** clean compile, app launches, no completion-actions
UI surfaces (the pill is dead).

### M1: Auto-commit + per-terminal modal MVP
- `turn-recorder` (auto-commit on Stop with Haiku summary).
- `turn-projection` (synthesise Turn[] from git log).
- `TurnsModal` rendering the turn list and inline diffs.
- Squash-and-publish via `PublishDropdown` → push branch only (no
  PR yet, no merge yet — just "push the squashed commit").
- Per-session auto-commit toggle.

**Ship criterion:** user can run an agent, see turns, squash some,
push to origin. No PR, no merge yet.

### M2: Discard + cascade
- `discard-engine`.
- `DiscardConfirmDialog` with cascade prompt.
- Discarded-turns sidecar persistence.

**Ship criterion:** user can discard a turn, including those with
dependents.

### M3: Hunk-level split
- `publish-engine.splitTurn`.
- `HunkPickerModal`.
- "Split a turn" entry in `PublishDropdown`.
- Hunk-level discard (split + drop one half).

**Ship criterion:** user can take one turn-commit and produce two
publish commits, picking hunks.

### M4: Side-clone merges + per-repo Publish path
- `side-clone-manager`, `merge-runner`.
- `pr-runner` (separates push from PR-create).
- `PublishPathConfigDropdown` and the per-repo setting.
- `WorkspaceLaunchPathStep` in workspace launch dialog.
- The PR path becomes available in `PublishDropdown`; direct-merge
  path becomes available too (uses side-clone).

**Ship criterion:** user can configure each repo for direct-merge,
PR, or both. Direct-merge works regardless of main repo's working
tree state.

### M5: Repo-level modal + bulk actions + multi-conflict
- `RepoChangesModal`, `BulkActionsBar`.
- `bulk-action-pipeline`.
- `MultiConflictModal` with manual / punt-Claude / discard paths.
- Filter chips, keyboard nav (J/K, X-multi-select).

**Ship criterion:** repo-level aggregation works; bulk merge across
N agents with mixed outcomes ends in a single multi-conflict modal.

### M6: Telemetry + polish
- All event emissions from research §9.
- Catalog updates in `docs/analytics-event-catalog.md`.
- Empty-state polish, error-toast wording, keyboard-shortcut
  documentation.
- Performance: capping `turns` list at e.g. 100 (collapsing older
  into "Already published"); paginating the diff fetcher.

**Ship criterion:** every action emits an event; catalog is current;
modal feels finished.

---

## 9. Open UX details to lock down

These are the questions surfaced during the scenario walkthrough that
the doc didn't decide. They block implementation only at the
milestone where they matter; flagged here so they don't surprise us.

| # | Question                                                                                       | Blocks milestone | Default if undecided                                  |
|---|------------------------------------------------------------------------------------------------|------------------|-------------------------------------------------------|
| U1 | Combined-diff vs stacked-diff for range selection                                              | M1               | Combined diff (single rendered view)                  |
| U2 | Section labels in the modal: "Just landed / Pending / Already published" — exact wording      | M1               | Use these three exactly                               |
| U3 | Stable turn IDs vs sequential numbers — display rule                                           | M2               | Stable UUID internally, sequential display number     |
| U4 | Hunk picker: show all hunks expanded by default, or collapsed?                                 | M3               | Expanded                                              |
| U5 | Workspace launch dialog: required field or optional with a "decide later" path?                | M4               | Required (defaults visible, user must click through)  |
| U6 | Multi-conflict: per-row resolve choices vs single bulk choice?                                 | M5               | Both — bulk choice + per-row override                 |
| U7 | Bulk action: select-by-default of all "valid" agents on filter, or empty selection?            | M5               | Empty selection (avoid accidental bulk)               |

These aren't independent design questions to research; they're calls
to make. I'd lean toward the "default if undecided" column unless
you push back.

---

## 10. Testing strategy

Unit:
- `turn-projection`: feed canned `git log` outputs, assert the
  `Turn[]` shape and state derivations.
- `publish-engine.squash`: spin up a temp git repo in tests, create
  N wip commits, squash, assert one publish commit with the right
  message and parent.
- `publish-engine.split`: similar harness; assert two commits with
  the right hunks each.
- `discard-engine`: assert dropped commit absent from log; assert
  cascade works when dependents exist.

Integration (end-to-end with real git, no Electron):
- Auto-commit fires on Stop with dirty tree; doesn't fire on clean
  tree; doesn't fire when toggle off.
- Squash-publish + push-branch round-trip succeeds.
- Side-clone direct-merge succeeds when user's main is dirty.
- Bulk pipeline drains with mixed success/conflict; emits one
  `BULK_COMPLETED` with the correct results.

Renderer (vitest + react-testing-library):
- `TurnsModal` keyboard nav (J/K through rows, Shift-click range
  select).
- `PublishDropdown` shows the right options for each
  `repo.publishPath` value.
- `MultiConflictModal` per-row resolution updates the right pane.

Manual smoke (per milestone ship criterion):
- The smoke checks listed in §8 are run before each milestone merges.

---

## 11. Risks and mitigations

| Risk                                                                                            | Mitigation                                                                                  |
|-------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| Auto-commit during a turn the user wants to abandon mid-flight                                  | Discard is one click; reflog catches anything else; document the toggle off path           |
| `git rebase -i` for split fragile if user externally pushes/commits to the worktree branch      | Detect HEAD movement before/after; abort and surface a clear error                          |
| Turn-projection reads stale state when an agent is mid-edit                                     | Projection only runs on git events / poll ticks; render uses cached state, refreshes on event |
| Side-clone disk usage balloons                                                                  | One per repo; lazy-create; GC when no active agents; document in user-visible storage view  |
| Merge-runner contends with status-poller `index.lock`                                           | Reuse the existing lock-retry wrapper; serialise per-repo via mutex in `bulk-action-pipeline`|
| Hunk picker can produce illegal patches if the user picks contradictory hunks                   | Run `git apply --check` before commit; surface "couldn't apply this combination" inline     |
| `gh pr create` rate-limited by GitHub for bulk PR opens                                         | Pipeline serialises one PR at a time; surfaces 429 errors as per-row failures, doesn't retry  |
| Multi-conflict modal becomes a wall of text with 10+ conflicts                                  | Keep it scrollable; group by file count; show first 5 detailed, rest summarised             |
| Turn renumbering on discard confuses users who saw "Turn 7" disappear and reappear as something else | UI shows `Turn N (was N+k)` for one render after a discard, then settles                  |
| Auto-commit summary call to Haiku adds latency on every Stop                                    | Don't block the wip-commit on the summary; commit with a placeholder, update message via `git commit --amend` once Haiku returns |

---

## 12. Migration

On first launch after upgrade:
- `migrate-user-data.ts` removes `completionPolicy` field from stored
  workspaces.
- Each repo on first open computes `publishPath` = workspace's
  `defaultPublishPath` (or asks via the launch dialog if missing).
- No turn data exists yet for in-flight worktrees; `turn-projection`
  retroactively builds turns from existing wip-commits if any are
  found, or treats all existing commits ahead of base as "open"
  unattributed turns (best-effort; users can publish or discard them
  as a single batch).

No data is destroyed. The migration is forward-only; downgrading the
app from a post-feature version to a pre-feature version is not
supported (consistent with current Claudinha policy).

---

## 13. Estimated scope

Rough size estimates per milestone (engineer-days, single
implementer):

| Milestone | Estimate |
|-----------|----------|
| M0        | 1 day    |
| M1        | 3 days   |
| M2        | 1.5 days |
| M3        | 2.5 days |
| M4        | 3 days   |
| M5        | 3 days   |
| M6        | 1.5 days |
| **Total** | **~16 days** |

These are real-world estimates assuming familiarity with the codebase
and the git plumbing involved, with normal review/iteration cycles.
The big rocks are M1 (foundational), M3 (interactive rebase
choreography is finicky), M4 (side-clone is a new concept), and M5
(bulk pipeline + multi-conflict UI).
