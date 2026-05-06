# Research: Completion Actions

**Status:** research → decisions made · ready to translate into an
implementation plan
**Branch:** `claude/research-completion-actions-Kczpw`
**Date:** 2026-05-06 (updated post-discussion)

> **Update:** the nine open questions in §9 have been resolved. Option B
> (turn-as-commit) is the chosen direction with Option A as a per-session
> fallback; Option C is dropped. See §9 for the full set of decisions and
> §6/§8 for the reframed design.

This document is the research foundation for a fresh design of "completion
actions" in Claudinha — the surface where the user views, understands,
clusters, commits, merges, pushes, and PRs the changes their agents have
produced. The previous in-progress design is being thrown out; nothing here
assumes any of it. The goal is to come back with enough context (a) to
agree on a domain model and vocabulary, and (b) to pick between a few
concrete UX/architecture options.

---

## 1. The problem in one paragraph

A user opens a workspace with one or more repos. In each repo they spawn
one or more terminals; each terminal is a Claude Code agent in its own
git worktree on its own branch. Each agent makes multiple "rounds" of
edits — sometimes the user acts on a round immediately (commit, merge,
push, PR), sometimes they let several rounds accumulate and act on them as
a batch, sometimes they ship some rounds and leave others sitting. We
need (a) a per-terminal surface that lets the user understand and act on
that one agent's pending and shipped work, and (b) a repo-level surface
that aggregates across all the agents in that repo and offers bulk
actions where they make sense.

---

## 2. Architecture context (the scaffolding any design has to plug into)

These are the load-bearing facts about the rest of Claudinha; the new
design must not contradict them.

**Domain entities** (`src/shared/types.ts`, `src/main/workspace-store.ts`,
`src/main/session-registry.ts`):
- **Workspace** — window-level grouping; persisted; can be `general`,
  `repo`, or `worktree-branch` typed. Holds a list of active panes and
  paused-terminal snapshots. Has a (workspace-scoped, optional) override
  on the global completion policy.
- **Pane** — a single live terminal running a Claude Code session in its
  own worktree. The code uses *pane*, *session*, *terminal*, and *agent*
  interchangeably (see §9 in the architecture map for which appears
  where). Holds the worktree path, repo name, status, gitStatus, and
  (currently) completion action status.
- **Worktree** — created via `git worktree add` at
  `<repo-root>/.worktrees/wt-<branch>/<branch>` per pane (when worktree
  mode is `each-own`). Branched off a base branch (`main` or `master`,
  detected at runtime).

**Edit-detection signal path** (`src/main/hook-listener.ts`,
`src/main/status-detector.ts`, `src/main/git-status-poller.ts`):
- Claude Code fires Unix-socket hook events (SessionStart,
  UserPromptSubmit, PreToolUse, PostToolUse, Stop, StopFailure) at
  Claudinha's listener.
- Each maps to a pane status. Stop is the interesting one for us: on
  Stop, status-detector probes recent PTY output and `git status` to
  decide whether the pane is `changes-ready`, `needs-input`, or
  `awaiting-prompt`.
- A 30-second `git status --porcelain` poller acts as a backstop and a
  source of live "ahead-of-base" / "uncommitted-changes" updates that
  the renderer subscribes to via `PANE_GIT_STATUS`.

**Existing git plumbing in main** (`src/main/git-status.ts`): the main
process already has wrappers for `status`, `rev-list --count`,
`commit -A`, `worktree remove`, `checkout`, `rebase`, `merge --ff-only`,
`merge --squash`, `merge --no-ff`, `merge --abort`, `push -u`,
`branch -d/-D`, `gh pr create`, plus a lock-retry wrapper for
contention with the poller. Whatever we design can lean on these
primitives — we don't have to re-invent the git layer.

**State machine for a pane**
(`src/shared/types.ts:228-234`, `src/main/status-detector.ts`):
`awaiting-prompt → planning → plan-ready → needs-input → working →
changes-ready`. The completion-actions modal we're designing lives
"on top of" this — it doesn't change the agent state machine, it
projects it into a UX surface.

**Modal infrastructure** (`src/renderer/components/ui/Dialog.tsx`):
native `<dialog>` with `showModal()`, focus trap, Esc handling, sized
xs through xxl. The pattern from Kanban is: card holds a small piece
of state (`{ paneId, paneName }`); when set, a modal renders; `onClose`
clears it. Repo-level modal-opens follow the same pattern from
KanbanRepoCard.

**Constraints to flag**
- Merge/PR has to happen with the **main repo's** working tree (not the
  worktree's), and that working tree must be clean. There's already a
  `DirtyMainModal` for this. Any "merge" action we design has to
  account for it.
- The 30-second poller can collide with a concurrent `git push`; the
  lock-retry wrapper handles transient `index.lock` contention but
  bigger concurrent ops need careful sequencing.
- Completion policies are global with workspace-level overrides; there's
  no per-pane policy. New per-pane behaviour should be modeled as
  *user actions*, not *policies*.
- Renderer reloads need a `_LIST_GET` invoke to reseed; any in-flight
  state we add must be re-fetchable, not just broadcast.

**Vocabulary already used in code & UI strings**
- `pane` (code), `terminal` and `agent` (UI). All three refer to the
  same thing.
- `worktree` is exposed in UI strings (see L-029, "this terminal has
  uncommitted changes…").
- `commit`, `merge`, `push`, `PR` — already used as user-facing verbs.
- `completion`, `completion policy`, `completion action` — used as the
  umbrella term for "what happens after the agent stops."
- `round` is **not** in the code. It's the user's word and we get to
  define it.

---

## 3. A short git mental-model primer (so we have shared vocabulary)

You said git terms are largely new. Skim this; the design discussion
hinges on getting these straight.

**The four "places" code lives in a git repo**

| Place                | What it is                                              | Verb to move *into* it       |
|----------------------|---------------------------------------------------------|------------------------------|
| Working tree         | The actual files on disk you can edit                   | (just edit a file)           |
| Index / staging area | A picked subset of changes queued for the next commit   | `git add`                    |
| Local commits        | Snapshots saved to your local repo's history            | `git commit`                 |
| Remote (origin)      | The server's copy of branches and commits               | `git push`                   |

The index/staging concept exists so you can build a commit from *some*
of your edits, not all of them. Modern GUIs (GitHub Desktop, VS Code)
mostly hide it behind checkboxes — the user picks which files/hunks
"go in this commit," and the GUI runs `add` then `commit` for them.
We can do the same and never expose the word "stage."

**Branches** are movable labels pointing at a commit. `main` (or
`master`) is conventionally the trunk — the branch that gets deployed.
Feature work happens on a feature branch, then gets merged into main.

**A worktree** is a separate working directory tied to the same `.git`
metadata. Each worktree can have a different branch checked out
simultaneously — that's why Claudinha can run several agents in
parallel without them clobbering each other's files. A worktree is
*not* a separate repo; it shares history, branches, and remotes with
the main repo.

**Merging** integrates a feature branch's commits back into the trunk.
Three flavours, all useful in different contexts:
- **Fast-forward** — only possible if the trunk hasn't moved since
  you branched. Just slides the trunk pointer forward. No new
  commit; cleanest history.
- **Merge commit** (`--no-ff`) — creates a "merge commit" that
  records the integration point. Preserves the feature branch's
  shape in history.
- **Squash merge** — flattens all the feature branch's commits into
  *one* commit on trunk. Loses intermediate history but keeps trunk
  linear. Common for short-lived feature branches.

**Rebase** is a different way to integrate: instead of merging, you
*replay* your branch's commits on top of the latest trunk. End result
is a linear history as if you'd branched from current trunk. Used
before merging to keep `main` linear without merge commits.

**Push / pull / fetch**
- `push` uploads your local commits to origin.
- `fetch` downloads origin's commits without changing your working
  files.
- `pull` = `fetch` + `merge` (or `+ rebase`, depending on config).
- `git rev-list --count main..HEAD` answers "how many commits is my
  branch *ahead* of main." The repo-level surface needs this number
  per agent.

**Pull request (PR) / merge request (MR)**
A GitHub/GitLab layer on top of git. Push your feature branch to
origin, then open a PR proposing "merge this branch into trunk." The
PR is a venue for review; the actual merge is a button on the PR
page, run by GitHub against origin. `gh pr create` already wraps
this for us.

**Lifecycle states a single change can be in**

```
edited (working tree dirty)
    │  git commit
    ▼
committed locally (ahead-of-base, not on origin)
    │  git push (worktree branch → origin)
    ▼
pushed to feature branch on origin (PR-able)
    │  open PR
    ▼
PR open
    │  merge PR  (or local merge then push base)
    ▼
merged into base (committed on base, may or may not be on origin)
    │  push base
    ▼
on origin/main (the canonical "shipped" state)
```

There's a parallel path where the user merges locally (no PR) and pushes
the base branch directly. Both paths matter for Claudinha; PRs aren't
mandatory.

**Why "ahead-of-base" matters as a UI signal**: when the agent's worktree
branch is ahead of `main` by N commits, those N commits represent work
the user has decided to keep (they're committed) but hasn't yet
integrated. That's a fundamentally different state from "uncommitted
working-tree edits," and the UI should make it visible.

---

## 4. Domain model proposal

This is a vocabulary + entity proposal that maps your mental model
onto git cleanly. We can keep, rename, or drop any of these — the
design hinges on agreeing here first.

**Proposed terms**

| Term          | Meaning                                                                                   | Why this term            |
|---------------|-------------------------------------------------------------------------------------------|--------------------------|
| Session       | A single agent terminal (= what code calls a pane)                                        | Already user-facing      |
| **Turn**      | One user-prompt-to-Stop cycle. The atomic unit of agent work                              | Matches Claude vocabulary |
| **Patch**     | The file-system delta produced by a turn — a named, addressable diff                      | Phabricator/Gerrit precedent |
| **Batch**     | A set of patches the user has decided to act on together                                  | User's own word          |
| Commit        | A git commit — patches turn into commits when the user (or auto-commit) commits them      | Standard git              |
| Publish       | Umbrella verb for "make this work visible outside this worktree" (push / merge / PR)      | Graphite-style separation |

**Key relationships**

```
Workspace  has many  Repos
Repo       has many  Sessions (one per agent terminal)
Session    has many  Turns           (Turn N+1 starts when user prompts again)
Turn       produces one  Patch       (may be empty if no edits)
Patch      becomes  Commit(s)        (1 patch = 1 commit, OR N patches → 1 commit, OR 1 patch → N commits)
Commit     gets     Published        (pushed / merged / PR'd)
```

**Patch states** (what the UI badges on a per-patch row):

| State            | Meaning                                                                  |
|------------------|--------------------------------------------------------------------------|
| open             | Just produced; in working tree; not yet committed                        |
| committed        | Bound to a local commit on the worktree branch; not on origin            |
| pushed           | Commit is on origin/<worktree-branch>; merge or PR still pending         |
| pr-open          | A PR exists for this commit's branch                                     |
| merged           | Merged into base branch (locally)                                        |
| shipped          | Merged AND base branch pushed to origin (the terminal "done" state)      |
| superseded       | A later edit reverted/overwrote it before publish                        |
| discarded        | User explicitly threw it away                                            |

**Session-level summary** (what the terminal-level modal header shows):

- "N patches in N batches"
- "X uncommitted, Y unpublished commits, Z shipped"
- "Last activity: …"

**Repo-level summary** (what the repo-level modal shows):

- N agents · M total open patches across them
- Filter chips by state (uncommitted / unpublished / pr-open / shipped /
  conflict / failed)

**Open question**: do we *create* a Patch entity in storage, or do we
synthesize it on demand from git log + working-tree diff? Both are
viable; this is a major design choice and is the spine of options
B vs A in §6.

---

## 5. Prior-art digest

Full survey: §10 (appendix). Here are the seven findings that should
shape our design.

1. **VS Code's two-section single-pane model** ("Changes" + "Staged
   Changes" visible together) beats GitHub Desktop's tab-swap
   ("Changes" tab vs "History" tab — open issue #2004 for years).
   Users want pending and shipped/in-flight visible at once.
2. **JetBrains "changelists"** are the cleanest existing answer to
   "cluster file changes into N logical commits." Drag files between
   named buckets, commit each bucket independently. We considered
   adopting this directly (see Option C in earlier drafts) but it's
   incompatible with auto-commit-per-turn; the *idea* of letting users
   re-cluster commits survives in Option B's "split a turn at publish
   time" affordance.
3. **Phabricator/Gerrit** treat the *logical change* (Differential
   Revision / Change-Id) as the unit of review, with successive uploads
   as numbered "patch sets." Reviewing diff N vs diff N+1 is a
   first-class UI affordance. This is the model that maps best onto
   "I want to diff turn 3 vs turn 5."
4. **Sapling's Interactive Smartlog** queues git ops in the background
   and never blocks the UI. With many parallel agents this matters —
   the merge queue we already have is a small precedent.
5. **Aider auto-commits each turn.** Every turn is a real git commit
   with a descriptive message. `/undo` reverts the last one. This is
   the simplest route to "every turn is git-addressable" — *no new
   storage, no new state machine*, just commits.
6. **Sourcegraph Batch Changes** filter chips ("ready to merge,"
   "in conflict," "needs attention") are the gold standard for the
   repo-level aggregation surface. Status-first grouping beats
   hierarchical nav when N×M is the cardinality.
7. **Linear's keyboard triage** (J/K to walk, single-key actions, no
   confirm-with-undo-toast) is the model for "many similar items, fast
   throughput." With 10+ agents in flight, mouseless ergonomics matter.

**Cursor's open feature request** ("Group Diffs by Agent in Source Control
Panel") and **Claude Code's open issue** for hunk-level approval together
say: nobody in this space has fully solved the "many agents, mixed states,
clean commit history" problem yet. We have a chance to.

**Patterns to specifically avoid** (from the survey):
- Don't expose Git's index as "stage" — use checkboxes or
  drag-between-sections like the modern GUIs.
- Don't tab-swap between pending and history — show both.
- Don't auto-clear pending state without persistence — Cursor's
  reopen-the-app bug class is a warning.
- Don't ship file-only granularity if hunks are coming — plan for hunks
  from day one, even if behind a flag.
- Don't aggregate by repo hierarchy when *state* is the real axis — Argo
  CD's users routinely build their own dashboards.

---

## 6. Design options (reassessed)

The original draft considered three options that differ on one
fundamental question: **what's the storage model for "rounds of changes"
— synthesised from git, or first-class?** With the decisions in §9,
the answer is now firm:

> **Chosen direction: Option B (turn-as-commit).** Auto-commit each turn
> as a `wip(turn-N): <summary>` commit on the worktree branch. The agent's
> turns become first-class git objects, addressable, diffable, undoable.
> Publishing squashes selected turns into clean commits. **Option A** is
> retained as a per-session fallback when the user toggles auto-commit
> off. **Option C (changelists)** is dropped — it's incompatible with
> auto-commit (changelists track working-tree hunks, which auto-commit
> clears).

The rest of §6 documents the chosen design (B) in detail, then
summarises A as a fallback. Option C is dropped and not described
further.

### Option B — Turn-as-Commit (chosen)

**Storage**: every turn auto-commits. Each Stop with file changes
produces a `wip(turn-N): <subject>` commit on the worktree's branch
immediately. Turns are git commits; nothing extra to persist. Subject
lines come from the Haiku summary we already produce for the inspector
(reuse the same pipeline).

**Per-terminal modal — layout**

```
┌──────────────────────────────────────────────────────────────┐
│ <repo>  ·  <agent name>  ·  branch: <worktree-branch>        │
│                                                              │
│ Turns (4 pending · 2 published)                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ✦ Turn 6  "Wire up debounce on the search input"        │  │
│  │   2 files · +14/-3   ·  open                            │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ ✦ Turn 5  "Add /search endpoint"                        │  │
│  │   3 files · +52/-1   ·  open                            │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ ✓ Turn 4  "Add search index migration"                  │  │
│  │   1 file  · +18/-0   ·  pushed (commit a1b2c3)          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ▸ Already published (2 turns, collapsed)                    │
│                                                              │
│  [Publish selected ▾]    [Discard turn]                      │
└──────────────────────────────────────────────────────────────┘
```

- **Turns list**, newest first. Each row: turn #, Haiku summary, file
  count, +/-, state badge (`open` / `committed` / `pushed` / `pr-open`
  / `merged` / `shipped`).
- **Click** a row to expand inline diff.
- **Range-select** (Shift-click) selects a contiguous span of turns;
  the diff view shows them as one combined diff (Phabricator
  precedent).
- **Multi-select** (X-on-hover, Linear-style) for non-contiguous turns.
- **Publish selected** dropdown:
  - **Squash and publish** (default) — collapse selected turns into one
    new commit, prompt for message (pre-filled with concatenated turn
    summaries), then run the configured publish path (§5 below).
  - **Publish each turn as its own commit** — keep per-turn commits;
    push/merge as-is. Useful for users who want fine-grained history.
  - **Split a turn** (advanced) — open the hunk picker (see below) to
    break one turn-commit into multiple publish-commits.
- **Discard turn** — drops a turn-commit. If the discarded turn is not
  the most recent open turn, also rebases subsequent open turns over
  the gap (or aborts with a clear "you'd have to discard turns 5, 6,
  too" prompt). Destructive; confirm dialog.

**Hunk-level granularity (decided: day-one)**

Per Q3, hunk-level support ships in v1. Three places it surfaces:

1. **At publish time**: when the user chooses "Split a turn," the
   modal opens a hunk picker per turn-commit. Hunks have checkboxes;
   checked hunks go into commit A, unchecked into commit B. The user
   can repeat to produce N commits from one turn.
2. **In Discard**: discard-with-hunks lets the user drop specific hunks
   from a turn rather than the whole turn. Implemented as
   "split the turn, discard one half."
3. **Diff viewer**: hunks are the navigation unit (J/K to walk hunks
   within a turn).

Implementation: each turn-commit is split via the standard
`git rebase -i edit` + `git reset HEAD^` + per-hunk `git add -p`
+ `git commit` + `git rebase --continue` choreography. The main
process owns this; the renderer drives via a `TURN_SPLIT` IPC.

**Publish paths (decided: per-repo configurable)**

Per Q5, two paths exist and the user picks per repo (with an initial
default at workspace launch):

1. **Direct merge** — local merge into base, then push base.
   `git checkout <base> && git merge <strategy> <branch> && git push origin <base>`.
2. **PR** — push the worktree branch to origin, then `gh pr create`.
   The user finishes review on GitHub.

The repo-level modal (§7) shows both verbs as buttons when both are
enabled; per-terminal modal shows the repo's chosen default(s) in the
Publish dropdown. Configuration lives on the repo entity, defaulting
from the workspace's launch choice.

**Side-clone for direct-merge (decided: yes)**

Per Q4, direct-merge runs against a **side-clone** of the main repo
rather than the user's main working copy. This sidesteps the "main
repo working tree must be clean" constraint entirely.

Sketch: lazily create `.worktrees/.merge-staging/` (a bare clone or a
worktree of `<base>`), run `git merge` there, push to origin, then
fast-forward the user's actual main if it's clean. If the user's main
is dirty, we still pushed origin, and their next pull/fetch picks it
up — they're never blocked.

This eliminates `DirtyMainModal` for the merge path. (It still applies
to other flows that touch main directly, if any remain.)

**Bulk-merge conflict handling (decided: skip-and-surface, multi-conflict-aware)**

Per Q7, bulk merges do not stop on the first conflict. They:

1. Iterate the selected agents, attempting merge for each.
2. On conflict, **abort that one** (`git merge --abort`), record the
   conflict, and **continue to the next**.
3. After the queue drains, surface a multi-conflict modal listing all
   the conflicts. The user can resolve them one at a time (with the
   existing `ConflictResolveModal` flow per agent), or punt them all
   to Claude (one resume-with-conflict prompt per agent), or discard
   the conflicting work.

This means `merge-queue` becomes a result-aggregating pipeline rather
than a stop-on-error sequence.

**Telemetry (decided: yes)**

Every action becomes a tracked event in
`docs/analytics-event-catalog.md`. Minimum event set for v1:

- `turn_auto_committed`
- `turn_published_squashed` / `turn_published_individual`
- `turn_split` (with N output commits)
- `turn_discarded`
- `publish_path_chosen` (direct-merge | pr)
- `merge_attempted` / `merge_succeeded` / `merge_conflicted` / `merge_aborted`
- `pr_opened` / `pr_open_failed`
- `bulk_action_started` / `bulk_action_completed` (with success/conflict/failure counts)
- `auto_commit_toggled` (on→off / off→on, per session)

All keyed by anonymous `installation_id` per existing telemetry rules
(no paths, no commit messages, no diffs).

**Auto-commit fallback (Option A behaviour)**

Per Q2, auto-commit defaults to ON. A per-session toggle disables it.
With auto-commit off, the modal degrades to Option A's working-tree-
first view: top section is uncommitted changes (with checkboxes,
VS Code-style), middle is local commits, bottom is shipped. Same
modal frame, different top section.

The toggle lives in the per-terminal modal header (a small
"Auto-commit: on/off" pill). Switching mid-session is allowed; turning
off doesn't retroactively un-commit, turning on doesn't backfill
commits for already-edited files.

**Pros**:
- Matches the user's "rounds" mental model exactly.
- Round-vs-round diff is `git diff <turn-N>..<turn-M>` — free.
- Discard is `git reset` / `git rebase` — straightforward because
  turns are real commits.
- All state recomputable from git: Patch.state derives from the
  commit's position in `git log`.
- Hunk-level support is a localised feature on top of real commits,
  not a parallel storage system.

**Cons (and mitigations)**:
- Worktree branch accumulates `wip(turn-N)` commits the user might not
  want visible publicly. **Mitigation:** wip commits never leave the
  worktree branch; squash-on-publish is the default; per-turn publish
  is opt-in. (Yes, per-turn publish *would* expose the wip commits;
  warn at the publish-dropdown choice.)
- `git rebase -i` for split-turn is fragile if the user has externally
  committed on the worktree branch in parallel. **Mitigation:** detect
  HEAD movement before/after; if HEAD changed unexpectedly, abort the
  split with a clear error.
- Auto-commit during a turn the user wants to abandon mid-flight feels
  wasteful. **Mitigation:** Discard is one click; reflog catches the
  rest.
- Side-clone for merges adds disk usage. **Mitigation:** one shared
  side-clone per repo, lazily created, garbage-collected when the repo
  has no active agents.

### Option A — Working-tree-first (per-session fallback only)

When a user toggles **auto-commit off** for a session, the per-terminal
modal degrades to a working-tree-first view. Storage and lifecycle:

- No turn-commits are produced; the working tree stays dirty as the
  agent edits.
- The modal's top section is uncommitted edits, file-by-file, with
  checkboxes (VS Code-style staging hidden behind checkbox UX). The
  user picks files (or hunks, when expanded), writes a message, and
  clicks Commit — same hunk picker as Option B's split flow.
- The middle section is local commits (ahead of base) — same display
  as Option B's "already published" section.
- Publish, push, PR, discard verbs all behave identically to Option B
  — only the source of pending work differs (working-tree edits vs
  turn-commits).

"Round" is not a first-class concept in this mode; the user clusters
files into commits manually at commit time. Switching auto-commit
back on does not retroactively create turn-commits for past edits.

### Repo-level surface

The repo-level modal is the same regardless of any session's
auto-commit setting (since the repo modal aggregates *commits* and
*publish state*, not turn-commits specifically):

- Header: repo name + "N agents · M pending items"
- Filter chips (Sourcegraph-style): All / Pending / Pushable /
  PR-open / Conflict / Failed
- One row per agent: name, branch, state badges, mini-summary, click
  to drill into per-terminal modal
- Bulk-actions bar at the bottom of the filtered list, surfacing
  *only* actions valid for every selected item (greyed otherwise).
- Linear-style keyboard: J/K to walk, X to multi-select, Enter to drill,
  numeric hotkeys for filter chips.

**Per-repo Publish-path config (decided: yes, with workspace default)**

Per Q5, each repo has a Publish-path setting with three values:
`direct-merge` | `pr` | `both`. Surface:

- **Workspace launch dialog** asks once: "Default Publish path for new
  repos in this workspace?" with the three options. Pre-fills the
  Publish-path setting for any repo opened thereafter.
- **Repo-level modal header** has a small dropdown showing the current
  setting; user can change it any time.
- **Both** means: the repo modal shows two side-by-side bulk-action
  buttons ("Merge directly" and "Open PRs"); per-terminal modal shows
  both as choices in the Publish dropdown. **Direct-merge** or **pr**
  alone hide the unused affordances.

**Bulk actions worth supporting** (all gated by per-agent prerequisites
— the bulk action iterates, accumulates results, and surfaces failures):
- Push all (selected agents) — push their worktree branches.
- Merge all (selected agents, when path includes direct-merge) —
  sequential merges into base via the side-clone (§6 Option B). On
  conflict, abort that one and continue (decided in Q7); accumulate
  conflicts and surface them all at the end.
- Open PRs for all (selected agents, when path includes pr) —
  sequential `gh pr create`. Same skip-and-surface pattern for
  failures.
- Discard all (selected agents) — destructive, double-confirmed.

We **don't** support bulk-commit (a single message for many agents'
work) — committing requires per-agent intent.

---

## 7. Design comparison at a glance

| Dimension                              | B: Turn-as-Commit (chosen) | A: Working-tree (fallback)    |
|----------------------------------------|----------------------------|-------------------------------|
| Default mode                           | Yes (auto-commit on)       | Opt-in (auto-commit off)      |
| Storage to add                         | None (uses git)            | None                          |
| Maps user's "rounds" mental model      | Strong                     | Weak                          |
| Round-vs-round diff                    | Free (`git diff`)          | Manual                        |
| Discard a turn                         | One click (`git reset`)    | Hard (revert hunks manually)  |
| Re-cluster freely                      | Squash / split at publish  | Pick files at commit time     |
| Commit-history cleanliness             | Good (squash on publish)   | Good (user-curated commits)   |
| Hunk-level granularity                 | At publish-time split      | At commit-time staging        |
| Risk of drift between UI and real git  | Low                        | Lowest                        |
| Keystrokes from idea to shipped        | Fewest                     | Most                          |
| Plays well with parallel external edits | Medium                    | Best                          |

Option C (changelists) is dropped (incompatible with auto-commit; see §6).

---

## 8. Recommendation (decided)

**Option B — Turn-as-Commit** is the chosen direction, with these
specifics:

1. **Auto-commit is on by default.** Each Stop with file changes
   produces a `wip(turn-N): <haiku-summary>` commit on the worktree
   branch. The user can toggle auto-commit off per session; that
   degrades the modal to Option A's working-tree-first view.
2. **Wip commits never leave the worktree branch by default.** Publish
   always squashes; per-turn-publish is opt-in per publish action.
3. **Hunk-level granularity ships in v1**, exposed as "Split a turn"
   at publish time and at discard time.
4. **Direct-merge runs against a side-clone** of the main repo, not
   the user's main working copy — the "main repo must be clean"
   constraint goes away.
5. **Publish path is per-repo configurable** (`direct-merge` | `pr` |
   `both`), with a workspace-launch default applied to new repos.
6. **Discard** is the only "remove" verb. No separate Undo.
7. **Bulk merges skip-on-conflict and surface all failures at the
   end** — multiple agents can be in conflict simultaneously.
8. **Persistence of unpublished turns across paused-terminal snapshots
   is out of scope for v1.**
9. **Every action is a telemetry event**; catalog updates ship with
   the feature.

The repo-level surface is independent of per-session auto-commit
state and is built once.

---

## 9. Decisions (resolved 2026-05-06)

The nine open questions from the original draft have been resolved.
Each entry below records the question, the decision, and any new
design implications absorbed into §6/§8.

**1. Vocabulary — DECIDED: my proposal.**
We adopt **turn** (one prompt-to-Stop cycle), **patch** (the file
delta a turn produces, addressable as a wip commit), **batch** (a set
the user acts on together), **publish** (umbrella verb for
push/merge/PR). These supersede "round" everywhere we add new code,
strings, and docs. Existing usages of "completion" remain for the
overall feature umbrella where they're already entrenched (e.g.,
`completion-policy-store.ts`); fresh code uses the new vocabulary.

**2. Auto-commit default — DECIDED: ON.**
Every Stop with file changes auto-commits as `wip(turn-N)`. Per-session
toggle off available; switching off mid-session does not un-commit
existing wip commits. This makes Option B the spine and Option A a
fallback only. Drives the §6 design.

**3. Hunk-level granularity — DECIDED: include in v1.**
Hunks are the navigation unit in the diff viewer (J/K). "Split a turn"
at publish time uses a hunk picker. "Discard hunks from a turn" is
shorthand for "split the turn, discard one half." Implementation:
`git rebase -i edit` + `git reset HEAD^` + selective `git add -p`.

**4. Where merge runs — DECIDED: side-clone.**
Direct-merge runs in a lazily-created side-clone at
`.worktrees/.merge-staging/` rather than the user's main working
copy. The "main repo working tree must be clean" constraint is
eliminated for the merge path. One side-clone per repo, GC'd when no
agents remain.

**5. PR vs direct-merge default — DECIDED: per-repo, with workspace
default.**
Each repo has a Publish-path setting: `direct-merge` | `pr` | `both`.
The workspace launch dialog asks once for the default (applied to
repos opened in that workspace). The repo-level modal exposes a
dropdown to change it any time. With `both`, both verbs surface as
side-by-side affordances; with one, the other's affordances hide.

**6. Discard vs Undo — DECIDED: Discard only.**
There is no separate Undo verb. **Discard turn N** drops the
turn-commit; if subsequent turns exist, they rebase over the gap (or
the dialog warns "you'd have to discard turns 5, 6, too"). Always
destructive, always requires a single confirm. Reflog still catches
disasters; we don't surface it as a UI verb.

**7. Bulk-merge conflict handling — DECIDED: skip-and-surface,
multi-conflict-aware.**
Bulk merge iterates the selected agents. On conflict for any one,
abort that merge (`git merge --abort`), record the conflict, continue
to the next. After the queue drains, surface a multi-conflict modal
listing every conflicted agent. The user can resolve them
one-at-a-time (existing per-agent flow), bulk-punt them all to Claude
(one resume-with-conflict prompt per agent), or discard the
conflicting work. The current `merge-queue` becomes a result-
aggregating pipeline rather than stop-on-error.

**8. Persistence after session close — DECIDED: out of scope for v1.**
Paused-terminal snapshots do not need to track unpublished turns yet.
We accept that resuming a paused terminal a week later starts with no
turn-list memory. This is explicit scope reduction; revisit in v2 if
demand surfaces. The Cursor reopen-bug warning still applies *within
a session* — the per-session modal must rehydrate from git on every
open, not from cached state.

**9. Telemetry — DECIDED: ship with the feature.**
Catalog additions to `docs/analytics-event-catalog.md`:

- `turn_auto_committed` — fields: turn_index, file_count, additions, deletions
- `turn_published` — fields: kind (`squashed` | `individual` | `split`),
  turn_count_in, commit_count_out, publish_path (`direct-merge` | `pr`)
- `turn_discarded` — fields: turn_index, had_dependents (bool)
- `merge_attempted` / `merge_succeeded` / `merge_conflicted` — fields:
  conflict_paths_count (0 if succeeded)
- `pr_opened` / `pr_open_failed` — fields: error_class (failed only)
- `bulk_action_started` / `bulk_action_completed` — fields: action,
  agent_count, success_count, conflict_count, failure_count
- `auto_commit_toggled` — fields: from, to, mid_session (bool)
- `publish_path_changed` — fields: scope (`workspace` | `repo`),
  from, to

All events keyed by anonymous `installation_id`; no paths, no commit
messages, no diffs. Same redaction rules as existing events.

---

## 10. Appendix — full prior-art survey

(Survey produced as part of this research run; URLs cited inline.
Not edited; included verbatim for traceability.)

### Group A — Git GUIs

**GitHub Desktop**
- Two top-level tabs in the left sidebar: "Changes" (working tree, with
  per-file checkboxes for staging) and "History" (commit list); a
  request to split them into separate panels has been open for years.
  ([desktop/desktop#2004](https://github.com/desktop/desktop/issues/2004))
- File checkboxes are the staging mechanism — there is no separate
  "Index" concept exposed; the UI treats the checkbox as "include in
  next commit."
  ([railsbricks](https://www.railsbricks.net/2024/10/28/github-desktop-commit-changes/))
- Range-select in History via Cmd/Shift-click lets the user view a
  range of commits as one diff — useful prior art for "select a span
  of rounds."
  ([GitHub Docs](https://docs.github.com/en/desktop/making-changes-in-a-branch/viewing-the-branch-history-in-github-desktop))
- Branch state ("ahead/behind origin") is a single Push/Pull/Fetch
  button that reshapes itself.

**VS Code Source Control**
- "Changes" and "Staged Changes" sections in one panel; drag between
  them.
  ([code.visualstudio.com](https://code.visualstudio.com/docs/sourcecontrol/staging-commits))
- Multi-repo: each repo (and each worktree) appears as a separate
  collapsible group; worktrees are first-class.
  ([branches/worktrees docs](https://code.visualstudio.com/docs/sourcecontrol/branches-worktrees))
- Common complaint: nested git repos cause every file to be listed —
  cautionary tale about scoping.
  ([dev.to](https://dev.to/eliastooloee/help-vs-code-source-control-is-listing-every-file-on-my-computer-how-can-i-just-commit-the-changes-from-my-current-project-39m5))

**JetBrains Local Changes / Changelists**
- "Changelists" are per-IDE groupings of working-tree changes you can
  drag files between, then commit independently. Closest mainstream
  analogue to "cluster these hunks into commit A vs commit B."
  ([jetbrains.com](https://www.jetbrains.com/help/idea/managing-changelists.html))
- Default changelist always exists; new changes auto-flow into it
  unless another exists.
- Non-modal commit toolwindow puts changelists, diff, and message in
  one panel.
  ([JetBrains support](https://intellij-support.jetbrains.com/hc/en-us/community/posts/22614979848594-The-Local-Changes-and-Stash-tabs-have-been-separated-from-the-Git-window))

**GitKraken**
- Working changes drawn as a "WIP node" at the top of the graph —
  lifecycle visually continuous.
  ([help.gitkraken.com](https://help.gitkraken.com/gitkraken-desktop/interface/))
- Stashes appear as graph nodes with right-click apply/pop/delete.
  ([stashing docs](https://help.gitkraken.com/gitkraken-desktop/stashing/))
- GitLens 17.2's "Commit Composer" reads prior commit messages as
  context to keep new commits stylistically consistent.
  ([GitKraken blog](https://www.gitkraken.com/blog/gitlens-17-2-commit-composer-streamlined-ux-and-enterprise-controls))

**Sublime Merge**
- Hunk-level and line-level staging via "Stage hunk" / "Stage line";
  drag hunk top/bottom to expand context.
  ([sublimemerge.com](https://www.sublimemerge.com/docs/getting_started))
- Commit message composer always-on at top.
  ([tips](https://www.sublimemerge.com/blog/sublime-merge-git-tips-creating-updating-commits))
- First-class amend/reword on existing commits.

**Sourcetree**
- Distinct status icons per file in left gutter — more granular than
  GitHub Desktop's.
  ([Atlassian KB](https://support.atlassian.com/sourcetree/kb/viewing-file-status-of-a-repository/))
- Stage hunk / line / discard hunk are right-click on the diff.
  ([mvtechjourney](https://mvtechjourney.wordpress.com/2014/08/01/git-stage-hunk-and-discard-hunk-sourcetree/))
- Frequent complaints: UI doesn't auto-refresh after external CLI
  changes — relevant warning for Claudinha with many concurrent
  agents.

### Group B — Stacked-diff / advanced PR tooling

**Graphite**
- Vocabulary: "submit" (push the stack as PRs) is distinct from
  "merge/land" (merge bottom-up). Two verbs, two semantics.
  ([graphite.com](https://graphite.com/docs/create-submit-prs))
- Land is bottom-up: merging the bottom PR cascades.
  ([graphite blog](https://graphite.com/blog/stacked-prs))
- Graphite Desktop specifics not directly verified — [unverified] for
  desktop UX claims.

**Sapling Interactive Smartlog (ISL)**
- Tree of commits where each commit is draggable — rebasing is "drag
  and drop a commit onto another."
  ([sapling-scm.com](https://sapling-scm.com/docs/addons/isl/))
- Combined "Commit and Submit" / "Amend and Submit" buttons.
- Background commands queue while the user keeps working — never
  blocks.

**Phabricator/Differential**
- Unit of review is "Differential Revision," not branch or PR.
  Successive uploads are numbered "diffs" within the same revision;
  diff-N-vs-diff-N+1 is built-in.
  ([secure.phabricator.com](https://secure.phabricator.com/book/phabricator/article/differential/))
- Separates the "logical change" from "current state of working tree"
  — directly analogous to "this round's edits as a logical unit."
  ([mediawiki](https://www.mediawiki.org/wiki/Phabricator/Differential))
- Reviewers mark inline comments "Done" — per-thread state separate
  from accept/reject.

**Gerrit**
- "Patch sets" are versioned snapshots of one Change-Id; each push is
  a new patch set; previous remains in history.
  ([gerritcodereview.googlesource.com](https://gerrit-review.googlesource.com/Documentation/concept-patch-sets.html))
- Side-by-side "compare patch set 2 vs patch set 4."
  ([Review UI docs](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html))

### Group C — AI-coding agent UIs

**Cursor (Composer/Agent)**
- Per-file diff cards; accept/reject per file (Cmd+Enter accepts all).
  ([cursor.gr.com](https://cursor.gr.com/composer.html))
- Open feature request: "Group Diffs by Agent in Source Control Panel"
  — pain point Claudinha targets.
  ([forum.cursor.com](https://forum.cursor.com/t/group-diffs-by-agent-in-source-control-panel/149215))
- Bug reports: pending-changes state not clearing after acceptance/commit.
  ([forum thread](https://forum.cursor.com/t/reopening-cursor-requires-re-approval-of-past-agent-changes-diffs/155566))

**Cline / Claude Code VS Code extension**
- Side-by-side diff per file; accept/reject/feedback. **No per-hunk
  granularity.**
  ([anthropics/claude-code#31395](https://github.com/anthropics/claude-code/issues/31395))
- Editing the proposal in the diff before accepting is allowed.
  ([eesel.ai](https://www.eesel.ai/blog/ide-diff-viewer-claude-code))
- Active feature request: Copilot-Edits-style hunk picker.
  ([anthropics/claude-code#33932](https://github.com/anthropics/claude-code/issues/33932))

**Continue.dev**
- Inline streaming diff with hotkey accept/reject — Cmd+Opt+Y/N for
  one change, Cmd+Shift+Enter/Delete for all.
  ([docs.continue.dev](https://docs.continue.dev/edit/how-it-works))
- Multi-file edits review per file.
  ([docs](https://docs.continue.dev/ide-extensions/edit/quick-start))

**Aider**
- Auto-commits each turn with descriptive message; agent's history *is*
  git history.
  ([aider.chat](https://aider.chat/docs/git.html))
- `/undo` reverts the last Aider commit.
- `--no-auto-commits` exists; default is auto.
  ([config options](https://aider.chat/docs/config/options.html))

**Conductor / Claude Code Desktop**
- Conductor's pitch is exactly Claudinha's: many parallel Claude Code
  agents, isolated copies, "review and merge in one place."
  ([conductor.build](https://www.conductor.build/changelog))
- Claude Code Desktop's April 2026 redesign added multi-session sidebar,
  drag-and-drop pane layout, integrated diff viewer, activity dashboard,
  worktree isolation, "Routines."
  ([pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/866/claude-code-desktop-redesign-parallel-sessions),
  [miraflow.ai](https://miraflow.ai/blog/claude-code-desktop-redesign-parallel-sessions-routines-workspace-guide))

**Claude Code CLI**
- Permission state: tri-mode toggle (normal → auto-accept → plan).
  ([code.claude.com](https://code.claude.com/docs/en/permission-modes))
- Per-action: Yes / Yes-for-session / No.
  ([smartscope.blog](https://smartscope.blog/en/generative-ai/claude/claude-code-auto-permission-guide/))

**Sourcegraph Cody / Batch Changes**
- Declarative spec fans out an edit across N repos, producing a
  changeset list with filter chips ("in conflict," "ready to merge,"
  "needs attention").
  ([sourcegraph.com blog](https://sourcegraph.com/blog/batch-changes-is-better-than-ever))
- Cleanest existing precedent for repo-level aggregate view across
  many parallel changes.
  ([sourcegraph.com](https://sourcegraph.com/batch-changes))

**Devin**
- Each session opens with an editable plan; output ships as a PR.
  Unit of review is the PR.
  ([cognition.ai](https://cognition.ai/blog/devin-2))
- Devin extension lets you check out Devin's PRs locally.

**Replit Agent**
- Generates instant *preview* of the running app; review = "see the
  artifact" not "see the diff."
  ([blog.replit.com](https://blog.replit.com/whats-changed-agent3-to-agent4))

**Warp**
- "Blocks" = command + output as one collapsible unit; agent and
  manual context kept visually separate.
  ([docs.warp.dev](https://docs.warp.dev/agent-platform/warp-agents/agent-context/blocks-as-context))
- "Send to agent" hint appears contextually (e.g., last command failed).
  ([modes docs](https://docs.warp.dev/agent-platform/warp-agents/interacting-with-agents/terminal-and-agent-modes))

### Group D — Multi-stream / multi-repo aggregation

**Argo CD**
- Single-instance UI doesn't aggregate across instances; users
  build their own dashboards.
  ([codefresh.io](https://codefresh.io/blog/using-gitops-multiple-argo-instances-environments-argo-cd-scale/))
- App list filterable by health/sync/project — sectioning by *state*
  not *environment*.
  ([argo-cd docs](https://argo-cd.readthedocs.io/en/stable/))
- Lesson: when N items × M states, status filters beat hierarchical
  navigation.

**Gitpod / Coder dashboards**
- Workspaces in a list with status, uncommitted indicator, branch.
  No deep cross-workspace aggregation in default UI.
  ([gitpod-io/gitpod#3426](https://github.com/gitpod-io/gitpod/issues/3426),
  [#676](https://github.com/gitpod-io/gitpod/issues/676))

### Group E — Inbox / triage

**Linear inbox**
- Single-key actions: 1 accept, 2 dup, 3 decline, H snooze, J/K nav,
  G+I jump. Mouseless flow.
  ([linear.app/triage](https://linear.app/docs/triage),
  [/inbox](https://linear.app/docs/inbox))
- Multi-select with X-on-hover; bulk-action bar appears at bottom.
  ([assigning](https://linear.app/docs/assigning-issues))
- Items disappear immediately after action with undo toast.

**Superhuman / Gmail**
- Cmd+K command palette; every shortcut is also a palette entry.
  ([blog.superhuman.com](https://blog.superhuman.com/inbox-zero-in-7-steps/))
- Hover-tooltips show shortcut next to icons (training wheels).
  ([help.superhuman](https://help.superhuman.com/hc/en-us/articles/45191759067411-Speed-Up-With-Shortcuts))
- Split Inbox auto-routes — sectioned aggregation prevents one queue
  from dominating attention.
