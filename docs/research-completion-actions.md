# Research: Completion Actions

**Status:** research / draft for discussion · do not implement yet
**Branch:** `claude/research-completion-actions-Kczpw`
**Date:** 2026-05-06

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
   named buckets, commit each bucket independently. This is the only
   mainstream UX for "user-clusters-the-clustering."
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

## 6. Three design options

These differ on one fundamental question: **what's the storage model
for "rounds of changes" — synthesised from git, or first-class?**
Everything else (UI layout, action affordances) can be retrofitted to
either choice; this is the choice that's hard to reverse.

### Option A — Working-tree-first (the lightest touch)

**Storage**: there is no "Patch" or "Turn" entity. State lives entirely
in git itself: working tree, local commits, origin. Claudinha reads
git on demand and renders.

**Per-terminal modal**:
- Top section "Pending" — uncommitted working-tree edits, file-by-file,
  with checkboxes (VS Code-style staging hidden behind checkbox UX).
  User selects which files to include in the next commit, writes a
  message, hits Commit.
- Middle section "Local commits" — list of commits ahead of base.
  Per-commit actions: view diff, reword, amend (last one), open PR,
  merge.
- Bottom section "Shipped" — last K merged/pushed commits, read-only,
  for context.
- Right rail or bottom: bulk actions ("Push", "Merge to base",
  "Open PR").

**"Round" = nothing in the data model.** The user thinks of rounds
informally; the UI doesn't track them. To cluster, they pick files into
commits at commit time.

**Repo-level modal**:
- One row per agent in the repo, with badges for state (uncommitted /
  ahead-of-base / pushed / pr-open).
- Filter chips: "uncommitted," "ready to merge," "ready to push,"
  "conflict."
- Bulk actions on filtered set: "Merge all ready," "Push all ready,"
  "Open PRs for all pushable."

**Pros**:
- Simplest. Fewest moving parts. No new storage.
- Everything we render is recomputable from git, so we can never get
  out of sync.
- Aligns with how mature git GUIs work today.

**Cons**:
- "Round" is invisible. The user can't see "this hunk came from turn 3,
  that hunk from turn 5" — they're a single dirty working tree.
- Re-clustering is limited to "pick files for next commit." No way to
  say "split this commit into two" without dropping into a CLI rebase.
- Loses the temporal dimension that the user explicitly cares about
  ("multiple rounds of changes").

### Option B — Turn-as-Commit (auto-commit per turn) [tentative lean]

**Storage**: every turn auto-commits. Each Stop with file changes
produces a `wip(turn-N): <subject>` commit on the worktree's branch
immediately. Turns are git commits; nothing extra to persist.
Subject lines come from a Haiku summary of the diff (we already use
Haiku for summaries elsewhere; this is the same pattern).

**Per-terminal modal**:
- Top section "**Turns**" — vertical list, newest at top, one row per
  turn. Each row shows: turn #, summary, file count, +/- counts,
  state badge. Click expands to inline diff. Range-select (Shift-click)
  to view a span as one diff.
- A "Publish" affordance per turn or per range:
  - **Publish as one commit** (default) — squashes the selected turns
    into one new commit, prompts for message, runs `git rebase -i`
    under the hood to collapse turns into a clean publish-commit on
    the worktree branch.
  - **Publish each turn as its own commit** — keeps the per-turn
    commits and just pushes/merges them as-is.
- "**Undo turn**" per turn — `git reset --hard <turn-N-1>`. Aider
  precedent. Cheap because turns are real commits.
- Below the turn list: "Already published" — patches that have shipped,
  collapsed by default.
- Bottom action bar: Commit (publish) → Merge → Push → PR, with the
  current state of each verb (idle / queued / running / done / blocked).

**"Round" = a turn = a wip commit.** First-class. Diffable, undoable,
addressable.

**Repo-level modal**:
- Same as Option A's repo modal, but rows include "N turns pending /
  M turns published" rather than just file counts.
- Bulk action "Publish all turns from agent X as one commit each" is
  meaningful in this model and not in A.

**Pros**:
- Matches the user's mental model exactly: rounds are real things.
- Round-vs-round diff is `git diff <turn-N>..<turn-M>` — free.
- Undo is `git reset` to a turn boundary — free.
- All state recomputable from git: Patch.state derives from where the
  commit sits in `git log` relative to publish-commits and base.
- Solves the commit-message problem: the user sees N descriptive turn
  commits and can squash with their own summary at publish time.

**Cons**:
- The worktree branch acquires WIP commits the user might not want
  visible. Mitigation: WIP commits never reach base. Squash-on-publish
  is the default; raw-publish is opt-in. The wip log is private to the
  worktree branch.
- Auto-committing during a turn the user wanted to abandon mid-flight
  is friction. Mitigation: still auto-commit; "Undo turn" is one click.
- `git rebase -i` to squash is fragile if the user has externally
  committed in parallel. Mitigation: the worktree is owned by the
  agent; manual external commits are rare and can be detected
  (compare HEAD before/after).
- Adds a "did this commit autoland?" question to the agent-loop telemetry
  surface that we currently don't have.

### Option C — Changelists (manual clustering over a dirty tree)

**Storage**: a sidecar file per worktree (e.g.,
`.worktrees/wt-<branch>/.claudinha-changelists.json`) tracking named
"changelists" — each is a set of file paths or hunks attributed to a
turn or to a user-named cluster. The working tree stays dirty until
the user commits a changelist.

**Per-terminal modal**:
- Top section "Active changelists" — by default, one per turn, named
  by the turn's prompt summary. User can drag files between
  changelists, rename them, merge/split them. Per-changelist Commit
  button.
- Middle: ahead-of-base commits. Bottom: shipped.

**"Round" = a changelist that defaults to the turn that produced it,
but the user can re-cluster freely.**

**Pros**:
- Maximum flexibility. JetBrains users love this for a reason.
- Clean commit history without auto-commit noise.
- Lets the user split one turn's work across two commits trivially.

**Cons**:
- Hardest to implement correctly. Hunk-level changelist tracking that
  survives further edits is non-trivial; if turn 5 modifies a line that
  turn 3 added, the bookkeeping is gnarly.
- Sidecar state can drift from real git state (deleted files, external
  edits). Mitigation: aggressive reconciliation on every poll.
- "Undo a turn" stops being free; you're rolling back a changelist's
  hunks, which is tantamount to `git checkout -p`.

### Cross-option: the repo-level surface

For all three options, the repo-level modal looks similar:
- Header: repo name + "N agents · M pending items"
- Filter chips (Sourcegraph-style): All / Pending / Pushable /
  PR-open / Conflict / Failed
- One row per agent: name, branch, state badges, mini-summary, click
  to drill into per-terminal modal
- Bulk-actions bar at the bottom of the filtered list, surfacing
  *only* actions valid for every selected item (greyed otherwise).
- Linear-style keyboard: J/K to walk, X to multi-select, Enter to drill,
  numeric hotkeys for filter chips.

**Bulk actions worth supporting** (all are gated by per-agent
prerequisites — the bulk action just iterates and surfaces failures):
- Push all (selected agents) — push their worktree branches.
- Merge all (selected agents) — sequential local merges into base.
  Fail-fast vs continue-on-failure is a setting.
- Open PRs for all (selected agents) — sequential `gh pr create`.
- Discard all (selected agents) — destructive, double-confirmed.

We **shouldn't** support bulk-commit (a single message for many
agents' work) because committing requires per-agent intent.

---

## 7. Design comparison at a glance

| Dimension                              | A: Working-tree | B: Turn-as-Commit | C: Changelists |
|----------------------------------------|------------------|-------------------|----------------|
| Implementation complexity              | Low              | Medium            | High           |
| Storage to add                         | None             | None (uses git)   | Sidecar JSON   |
| Maps user's "rounds" mental model      | Weak             | Strong            | Medium         |
| Round-vs-round diff                    | Manual           | Free              | Possible       |
| Undo a turn                            | Hard             | Free              | Medium         |
| Re-cluster freely                      | At commit time   | Squash/split      | Drag-and-drop  |
| Commit-history cleanliness             | Good (manual)    | Good (squash)     | Best           |
| Risk of drift between UI and real git  | Lowest           | Low               | Highest        |
| Keystrokes from idea to shipped        | Most             | Fewest            | Medium         |
| Plays well with parallel external edits | Best             | Medium            | Worst          |

---

## 8. Recommendation (tentative — to discuss)

**Lean: Option B — Turn-as-Commit**, with two refinements:

1. **Wip commits never leave the worktree branch by default.** Publish
   always squashes by default; the user opts in to "preserve turn
   commits" per publish if they want.
2. **Allow option-A behavior as a fallback.** A per-session toggle
   "Auto-commit turns: on/off" (default on). If off, the modal
   degrades to option A's working-tree-first view.

This gives us the strongest mental-model match (turns are real,
diffable, undoable, addressable) while keeping a clean publish history
and preserving an escape hatch for users who hate auto-commit.

The repo-level surface is the same for all options; we can build it
once.

---

## 9. Open questions for the discussion

1. **Vocabulary**: do we like *turn* / *patch* / *batch* / *publish*?
   Alternatives: *round* (your word, currently unused in code) /
   *change* / *version* / *ship*. Whatever we pick, we should make it
   the consistent term in code, UI, and docs.
2. **Auto-commit default**: on or off? On gives us option B's
   ergonomics by default; off forces every user through option A.
3. **Hunk-level granularity**: ship from day one, or a fast-follow?
   Cursor and Claude-Code-VS-Code both shipped without it and have
   open issues; that's a warning shot.
4. **Where does "merge" actually run?** In the worktree, or in the main
   repo? Today it's the main repo; that imposes the "main repo working
   tree must be clean" constraint. Could we instead push the worktree
   branch and merge from a side-clone, sidestepping the main-repo
   constraint entirely?
5. **PR-or-direct-merge default**: should the default Publish path be
   "merge locally to base + push base," or "push branch + open PR"?
   Different teams want different defaults; do we make this a
   workspace-scoped policy?
6. **Discard vs undo distinction**: is "Undo turn 5" different from
   "Discard turn 5"? Proposal: Undo = revert to before the turn (kept
   in reflog); Discard = drop the turn-commit and squash subsequent
   turns down (destructive, requires confirm).
7. **Conflict UX during bulk merge**: today's `ConflictResolveModal`
   resumes Claude on the conflict. Does that compose with bulk merge
   (pause queue → resolve → resume queue)?
8. **Persistence after session close**: paused-terminal snapshots
   already exist. Do unpublished turns "follow" the paused snapshot?
   Probably yes — Cursor's reopen-bug class warns us not to lose
   pending state on reopen.
9. **Telemetry**: every action (publish, merge, push, PR, undo,
   discard) should be a tracked event so we can tune later. Catalog
   addition for `docs/analytics-event-catalog.md`.

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
