---
name: drain
description: Drain a batch of tickets: parallel workers in worktrees, serial merge behind the gate, `close-ticket` verifies and closes each one, then land the branch on the default branch.
disable-model-invocation: true
argument-hint: "[selector]: a parent issue number, a label, explicit issue numbers, or nothing"
---

# Drain

You are the **foreman**. You assign work and inspect results; workers (fresh subagents) do all
implementation. Your context holds only the graph, the verdicts, and the brief; reading source or
writing code yourself rots it and degrades every later dispatch.

Drain is an **orchestrator**: it runs `/implement`'s edge one ticket at a time and holds the
merge–gate–close critical section around it. It ends when the batch is **landed**, on the
default branch, not merely on the drain branch. Tracker mechanics (relationship APIs, IDs vs
numbers, labels) come from the repo's `docs/agents/issue-tracker.md`.

## 1. Resolve the batch

The argument is a **selector**, not a spec:

| Selector | Resolves to |
|---|---|
| An issue number that has sub-issues | those sub-issues |
| A label | every issue carrying it |
| Explicit issue numbers | themselves |
| Nothing | every open issue in the repo |

Resolve it via the relationship APIs and `gh issue list`. Then filter to the **frontier**: an issue
is drainable only if it is **open**, its body carries `## Acceptance criteria` with at least one
`- [ ]` item, it has **zero open blockers**, and it is not labelled `needs-human`. Fetch every
blocker via the dependency API whether or not it is in the batch; a batch is a scheduling
convenience, not a dependency boundary.

That much tests presence, not closability, and post-#215 those are different questions: a ticket
can carry `## Acceptance criteria` with a `- [ ]` item and still be nothing `close-ticket` will
ever close, because the item names no runnable command. So the frontier adds one more test, over
the same items the presence check already found: every `- [ ]` item under `## Acceptance
criteria` has to parse under `bin/ticket_shape.py`'s `parse_check_marker`, the same parse
`close-ticket` itself runs at close time, never a second reading of the grammar invented here. A
ticket where even one item fails that parse is dropped from the batch the same as one with an open
blocker; running it anyway spends a worktree, a worker, a merge and a gate on a ticket the closer
was always going to refuse, and there is nothing in the diff for a fixer to repair: the code is
fine, the ticket is not. This is not hypothetical: the run of 2026-08-29 found 20 open tickets
shaped exactly this way (#89–#94, #99, #114, #184 and the rest of the `build-order` set), every
one screened out by hand because the frontier didn't do it (#220).

Read the gate command from `.claude/contract.json`, `all` slot (the definition of green) and
**capture it here, once for the run**. Every ticket in this batch is gated by the command this step
read, even if the file changes under the loop; re-reading per ticket would mean half the batch was
verified against one definition of green and half against another with nothing recording which
ticket got which. A ticket whose own work edits the contract is the case this cannot absorb: land
the batch on the captured command, name the change in the debrief, and let the maintainer re-run
under the new one.

An **absent** `.claude/contract.json` is not `all: null`. Reading it as one is how a whole batch
merges unverified and reports green (#142), so the two are distinguished before anything is
dispatched:

| At step 1 | What it means | What you do |
|---|---|---|
| File absent | This repo has never said what green is | **Stop** (below) |
| Present, `all: null` | This repo has said, deliberately, that it has no gate | Run the loop, skip the **Gate** step, treat every merge as green |
| Present, `all` is a command | The definition of green | Capture it; run it at step 4 |

The stop names the file and the one slot it needs: `.claude/contract.json` carrying an `all` slot
holding either this repo's whole-suite command or an explicit `null`, so the fix is one edit and
`/drain <selector>` again. Say that is the recovery. Do not infer a gate from `package.json`, from
the spec's prose, or from what the test files appear to be: an inferred gate that happens to be
right teaches the next run that inferring is allowed, and the next repo has no prose to infer from.
Nothing has been dispatched or cut yet, so there is nothing to unwind.

`docs/agents/issue-tracker.md` is the same shape one notch quieter, and gets the opposite answer
because it carries tracker conventions rather than the definition of green: every verb this skill
needs has a stock-GitHub `gh` default (`gh issue view/list/close/edit/comment`, the dependency and
sub-issue APIs named in step 3). Absent, **proceed on those defaults**, and say so in the report
below, so a repo whose tracker is not stock is visible before dispatch rather than after a close
lands in the wrong shape.

**Report the resolved batch before dispatching anything**: every ticket that passed the frontier,
plus every candidate the selector named that the frontier dropped and why (an open blocker,
`needs-human`, no `## Acceptance criteria` item, or a criterion whose check marker doesn't parse),
plus the captured gate command and whether the tracker doc was present or defaulted. This is the
one place a bare invocation's blast radius becomes visible before it runs.

Done when: the batch is reported, the gate command is captured for the whole run (or the run has
stopped naming an absent `.claude/contract.json` and the edit that would fix it), and an absent
`docs/agents/issue-tracker.md` has been reported as running on stock-`gh` defaults.

## 2. Branch and worktree

The branch name follows the **selector**, so re-running the same selector resumes the same branch
even when the resolved batch has shifted by a ticket:

| Selector | Branch |
|---|---|
| Issue `<n>` with sub-issues | `drain/spec-<n>-<slug>` (or a legacy `drain/prd-<n>-…` for the same issue) |
| Label `<l>` | `drain/l-<slug>` |
| Explicit numbers | `drain/n<lowest>-<highest>` |
| Nothing | resume any existing `drain/frontier-*`; else create `drain/frontier-<lowest>` |

Resume the branch if it exists, else create it from the default branch, either way in the drain
tree below, never by checking it out in the shared checkout. Its history is append-only.

Before cutting any worktree, check headroom on both filesystems this run writes to: the repo's,
which holds the drain tree below, and the scratchpad's, which holds every worker's worktree and the
`wt-checker` worktree: `df -i` and `df -h` on each. A `tmpfs` scratchpad is RAM-backed and inode-capped even
when bytes look plentiful, and a run that cuts into low headroom surfaces later as a red gate that
reads like a genuine test failure rather than a disk error (see step 4). If free inodes or free
bytes are short on either, report the shortage and stop instead of proceeding.

**The loop works the branch from its own worktree; the shared checkout's `HEAD` never moves.**
You are one session in a checkout the maintainer and other sessions also use, and a branch you check
out there is the branch anyone else's next commit lands on; that is all `HEAD` means, and they have
no way to know. It has happened: `6f1a5ec` landed on `drain/spec-734-leads-working-surface` mid-loop
and rode into the batch's landing merge attributed to a drain that never ran it (#141). The general
rule is that an agent that will write needs its own working tree, and a path it was handed is
read-only unless it was told otherwise. `<repo>` is that path for you from here on: a source to read
context from, to copy gitignored files out of, and to name as `link-deps`' second argument, never a
target for a write, an install, a commit, or a `git` command that moves `HEAD`. The mechanics are documented where `~/bin/link-deps --help` prints them.

Cut the drain tree **beside the main checkout**, not in the scratchpad:

```
tree="<repo>.$(printf %s '<branch>' | tr / -)"  # e.g. …/lumaria.drain-spec-734-leads-working-surface

git worktree add "$tree" '<branch>'                       # the branch exists, so resume it here
git fetch origin '<default>' &&                           # it does not, so cut both at once, from the
  git worktree add "$tree" -b '<branch>' origin/'<default>'  #   remote tip, not a stale local ref

~/bin/link-deps "$tree" '<repo>'
```

- **Beside**, because step 4's gate is this batch's verdict *because* it runs at a path shaped like
  the real one, spaces and shell-special characters included. A sibling inherits the main
  checkout's parent directory and so keeps that shape; a scratchpad path throws it away and leaves
  the foreman's gate exactly as blind to a path-shape bug as every worker's self-gate already is
  (#139). Quote the path everywhere for the same reason.
- `link-deps` gives this tree its own `node_modules`, the same tool and the same call the loop
  makes for every worker worktree (step 3) and for the `wt-checker` worktree (step 5), never a
  second mechanism invented here.
- Gitignored files do not follow into a worktree. Copy any the gate needs (`.env*`, local config)
  from `<repo>`; a gate that goes red for an absent `.env` reads exactly like a real failure.
- Resume a drain tree an interrupted run left standing rather than cutting a second one. If the
  branch is already checked out somewhere (another session, or a run from before this rule)
  `git worktree add` refuses. Report which tree holds it and stop; moving that tree's `HEAD` off the
  branch is the one thing this step exists not to do.

Every `git` command below runs **in the drain tree** unless it names another tree. Ref reads
(`git rev-parse <branch>`, `git log`, `git worktree add`) are cwd-independent and safe from
anywhere; a merge, a checkout, or a gate is not.

Record `git rev-parse <branch>` here as the run's **starting tip**. It is the first value of the
tip step 3 checks before each merge and the left end of the range step 4 accounts for; both of
which need a SHA this run can say it produced, and this is where the run first has one.

Done when: the drain branch is checked out at its tip **in the drain tree**, that tip is recorded
as the run's starting tip, that tree has its dependency tree and whatever gitignored files the gate
needs, the shared checkout's `HEAD` is where you found it, and headroom is confirmed on both
filesystems.

## 3. The loop

Workers run in parallel, each in its own worktree. Merging is a **serial critical section**: one
merge–gate–close at a time; finished workers queue. Repeat until no open tickets remain in
the batch:

1. **Pick** every open ticket in the batch (ascending issue number) whose blockers are all closed,
   up to 3 in flight. If open tickets remain but none is pickable and none in flight, stop and
   report the cycle.
2. **Dispatch**: cut each worktree yourself, `git worktree add <scratchpad>/wt-<ticket> -b
   drain-worker-<ticket> <branch>`, naming the drain branch explicitly as the base (built-in
   worktree isolation forks from the repo's default branch, never the tip you mean), then,
   **before dispatching**, give it its own
   dependency tree: `~/bin/link-deps <scratchpad>/wt-<ticket> <repo>`. That builds a
   `node_modules` sharing the main checkout's packages by symlink while keeping private copies of
   the manifests a package manager rewrites, at a cost of one inode per top-level entry (~79 on a
   real project) rather than the ~87k a second install would spend against the budget step 2 just
   checked. A worker left to solve this itself symlinks the whole tree at the main checkout's, which
   makes `node_modules/.modules.yaml` shared *and mutable* across every worker and you;
   corruption in #140, whose blast radius is the rest of the run, not the worker. Run it
   unconditionally: on a repo with no `node_modules` it reports that and exits 0. Then dispatch a
   fresh background subagent at
   `model: sonnet` by **stub**: the one-line prompt [WORKER-PROMPT.md](WORKER-PROMPT.md) opens
   with, values filled, appended with any lines from the seam ledger you are carrying (see below)
   that are plausibly relevant to this ticket, never the whole ledger. The worker reads the
   template and fetches its own context; the template never enters your window.
3. **Merge**: the worker returns its verdict (`DONE` or `BLOCKED: <why>`) plus its seam
   declaration; append the declaration to the seam ledger you are carrying unless it is `none`. On
   `BLOCKED`, label the ticket `needs-human` with the line as a comment, remove its worktree
   (`git worktree remove`), and move on. On `DONE`,
   confirm the branch has commits with `git log`; an empty branch stalled; resume it once with a
   nudge, and re-dispatch fresh only if that also returns empty. Capture the drain branch's
   current tip as this ticket's `base` (`git rev-parse <branch>`, named rather than read off `HEAD`,
   so it is the same answer from any tree) immediately before merging; it is the tip every sibling
   merged so far, never this ticket's alone.

   Two assertions stand between that capture and the merge. Both guard a **wrong verdict reported
   as green** rather than a crash, which is why neither can be left to notice itself:

   - **The tip is the one you left.** The `base` you just captured must equal the SHA this loop
     last put on the branch: the previous ticket's post-merge tip, or step 2's starting tip for
     the first ticket of the run. A tip you did not produce is a commit from outside this run, and
     absorbing it into `base` hands `close-ticket` a diff containing someone else's work and
     rides it into the batch's landing merge under a drain that never ran it (#141). Do not merge.
     Report the foreign SHA with `git log <last-left>..<branch>` and its author, and put the choice
     to the maintainer: adopt it into the batch deliberately, or land it separately and re-run the
     selector; the branch is append-only and the ticket is still open, so a re-run resumes here.
     Whichever way it goes, carry the tip you end on as the new "last left" before continuing.
   - **The tree is clean.** `git status --porcelain` in the drain tree must be empty before the
     merge. Its loud failure is an aborted merge (`error: Your local changes … would be
     overwritten`); its quiet one is a stray write that changes what step 4 measures, with nothing
     downstream positioned to notice (#143). Refuse the merge and name the exact paths `--porcelain`
     printed, plus what wrote them if you can tell; a worker's install against the wrong path is
     the shape already seen. Do not `git checkout --` them away yourself: they may be the only copy
     of something. Report and stop the loop; the maintainer discards or keeps them, and the selector
     re-runs from here.

   Merge the worker branch into the drain branch, in the
   drain tree. A conflict means the disjointness guard missed; resolve it inline via the
   `resolving-merge-conflicts` skill, preserving both intents; most are two tickets appending to
   the same shared file. Re-dispatch fresh from the updated tip only when the conflict is a genuine
   logic collision.
4. **Gate**: assert `git status --porcelain` in the drain tree is empty again before you run
   anything, and refuse the same way the merge step above refuses if it is not. The merge already
   checked; the merge commit itself is what makes this a second question rather than a restatement,
   and a gate is where a dirty tree pays: it returns a verdict on the merge *plus* whatever else is
   in the tree, and reports it as this ticket's (#143). Then
   run the contract's `all` command bare in the drain tree and read its own exit status.
   A pipe reports the last command's status, not the gate's; the worker's claim is not a verdict.
   Then read this ticket's acceptance criteria for any **other** suite they name by command (an
   integration run, a second harness, a script in no contract slot) and run each of those bare
   too, from this same tree, reading each one's own exit status. Repos whose verification is
   split across slots are the normal case, not the exception: a criterion naming a suite outside
   `all` is caught here, before the merge is declared green, rather than surfacing only when close
   (step 5) runs that criterion's own `check:` marker against a tree already merged (#151).
   Red on any of these is red, and everything below applies to whichever run failed.
   A red gate shaped like a codegen-sync failure or a missing/stale generated file is not
   automatically a genuine collision or regression: run `df -i` on the scratchpad's filesystem
   first. Inode exhaustion under ENOSPC silently fails a regeneration step and leaves a stale file
   behind, which reads exactly like that class of failure while `df -h` still shows bytes free.
   A second environmental shape, also not a regression: a red gate whose failures are **only
   timeouts in files the ticket never touched**, or a `husky - commit-msg script failed` on your own
   merge commit. Check `node_modules/.modules.yaml` in the main checkout before spending a fixer on
   either. A worker that reached the dependency tree through a whole-tree symlink rewrites
   `virtualStoreDir` there to name its own worktree; from the main checkout that path no longer
   resolves, so pnpm decides the modules dir is foreign and aborts every later invocation:
   including the deps check husky runs at `commit-msg`, which is why a manifest clobbered by a
   worker surfaces as your merge failing to commit. Repair is `virtualStoreDir: .pnpm` back in that
   file (relative to the modules dir, not the repo root) plus `pnpm install --frozen-lockfile`; the
   fix is the **Dispatch** step's `link-deps`, so a run that hits this on a worktree this loop
   provisioned is a defect to file, not a repair to repeat (#140).
   A third shape, and the one that reads most like a merge collision: a failure the worker
   **reported green** honestly. Worker worktrees sit at a scratchpad path with no spaces and no
   other shell- or URL-special characters; the drain tree sits beside the main checkout and inherits
   whatever shape that parent directory has, which may include both, so a path-shape bug (a
   hand-built `file://` URL, an unquoted `argv` path) is invisible to every worker self-gate and
   fatal here (#139). Before assuming two tickets collided, have the fixer reproduce at a path
   shaped like this one. This cuts one way only: your bare run in the drain tree is the verdict
   *because* its path is shaped like the real checkout's, so it is never weakened or skipped to
   match what a worker saw, and the tree is never moved somewhere cheaper (step 2).
   Red: dispatch one fresh fixer worker with the gate output appended to the prompt; still red →
   `git revert` the merge, label the ticket `needs-human`, remove its worktree, move to the next
   pickable ticket. Nothing closes a merge that didn't land.
5. **Close**: on green, capture the drain branch tip as `head`; this is also the SHA you carry
   forward as "last left" for the next ticket's tip assertion above. Cut one dedicated detached
   worktree the first time this step runs in this drain, `git worktree add --detach
   <scratchpad>/wt-checker <head>`, then give it a dependency tree with the **same** tool and the
   same call the **Dispatch** step gives every worker worktree: `~/bin/link-deps
   <scratchpad>/wt-checker <repo>`, run immediately after the `git worktree add`. One mechanism for
   both, never a second one invented here, and never a whole-tree symlink at the main checkout's
   `node_modules`; that shape is the corruption #140 closed. A bare checkout leaves a criterion's
   own `check:` marker unable to run (a typecheck, a CLI invocation, a one-off script) so it
   fails for a reason that has nothing to do with the diff. Provision **once per worktree, not once
   per ticket**: `node_modules` is gitignored, so the farm survives the `git checkout <head>` that
   moves this worktree to a later ticket's head. Every later close this run reuses that same
   worktree, moved to its own `head` with `git checkout <head>` run there (safe, since this worktree is
   touched by nothing but this step, so no concurrent gate run can be corrupted by it moving).

   **Which `close-ticket` runs is resolved once, before this step's first ticket, never re-decided
   per ticket**, the same way `close-gate.py` resolves it: this machine's own tool, found relative
   to its own tree, with `~/bin/close-ticket` as the name to fall back to when that cannot
   be found. There is exactly one `close-ticket`; #220 was a repository under drain carrying its own
   stale copy that silently outranked the machine's, undoing #215's refusal (a ticket whose every
   criterion comes back unverified does not close) with a `## Closing record` that looked identical
   either way. Retiring the per-repository copy retires the precedence #220 needed, not just the
   symptom. Call the resolved path `<closer>` below and use it for every ticket in the batch.

   Run `<closer> <ticket> <base>..<head> <scratchpad>/wt-checker` bare.
   cross-repo, add `-R <owner>/<name>`. It fetches the ticket's own criteria from the issue body,
   runs each one's `check:` marker with the `wt-checker` worktree as its working directory, records
   `UNVERIFIED` for a criterion carrying no marker, posts the `## Closing record`, and closes the
   ticket itself: one command, no verdict for you to arbitrate.

   On exit 0, the ticket is closed. Remove the ticket's own worktree from step 2 (`git worktree
   remove <scratchpad>/wt-<ticket>`), never `wt-checker`, which every later ticket in this run
   reuses. Refill free slots from step 1; closes may unblock new tickets.

   On a nonzero exit, nothing was posted and the ticket is still open: the failing criterion and
   its check command's combined output are on stderr. Dispatch one fresh fixer worker by the normal
   stub plus one appended line, *Fix pass: `close-ticket` failed criterion `<criterion>` with:
   `<output>`; that is your whole job*, then merge and gate the fix the same as any other ticket,
   move `wt-checker` to the new `head` (`git checkout <head>` there), and re-run the same
   `close-ticket` invocation against the ticket's **original** `base` (the range widens to cover
   work and fix); the recovery is always the same one command, never a verdict to arbitrate.
   Still nonzero a second time: `gh issue edit <ticket> --add-label needs-human` with the command's
   output as a comment, remove the ticket's own worktree, and leave it open; the merges stand, the
   ticket carries the debt. Either way, refill free slots from step 1.

**The seam ledger** is what step 2 injects and step 3 accumulates: the running record of what the
batch has already built, held only in your own context across the loop, never a file on the drain
branch. A file would reintroduce the same collision named at step 3's merge conflict shape (two
tickets appending to one shared file), and it would give this orchestrator state its edge does not
produce. You are the one
context that watches every ticket in the batch land, so you are also the only place positioned to
hold it. Inject only the lines plausibly relevant to the ticket being dispatched, never the whole
ledger.

Done when: every ticket in the batch is closed or labelled `needs-human`, every merge and every
gate in the run ran against a tip this loop left and a tree `git status --porcelain` reported clean,
or you have stopped with the cycle, the foreign tip, or the stray paths named, and the recovery
stated with it.

## 4. Land

The tickets are closed; the code has not landed until it is on the default branch.

**Account for the range first.** `git log --oneline <starting-tip>..<branch>` is exactly what this
merge is about to put on the default branch under the batch's name, and every commit on it should
be a worker's, a fixer's, or one of your own merges, each traceable to a ticket in the batch. The
landing merge is `--no-ff`, so a commit none of them produced arrives on the default branch
attributed to this drain, having passed through no gate or close (§3) and belonging to no ticket
(#141). Step 3's tip
assertion catches those that arrive between merges; this catches the rest: one that landed while
a worker ran, or before the first ticket. Report any such commit by SHA, author and subject, and
put the choice to the maintainer before the push: land it with the batch and say so in the debrief,
or `git revert` it on the drain branch first and land the revert. Silence in either direction is
the failure; merging it unremarked is how it became invisible in the first place.

The shared checkout is no more yours here than it was at step 2, so the landing merge happens in the
drain tree too, on a **detached** `HEAD`, which claims no branch and so cannot collide with
whatever another session has checked out where:

```
git fetch origin '<default>'
git switch --detach origin/'<default>'
git merge --no-ff '<branch>'        # --no-ff keeps the batch visible in history
git push origin HEAD:'<default>'
```

A push rejected as non-fast-forward means the default branch moved under you while you were landing:
re-run all four lines from the fetch, so the batch merges the tip that actually exists. Never force.

This leaves the shared checkout's *local* `<default>` behind `origin/<default>` by exactly this
landing. That is correct: whoever owns that tree pulls when they choose, and fast-forwarding a
branch checked out in someone else's working tree is the same write step 2 refused, but it is
surprising to walk up to, so it is one line of the debrief.

Then, in this order, because a branch checked out anywhere cannot be deleted: remove the drain tree
from step 2 and, if this run ever cut one, the `wt-checker` worktree from step 5. Nothing
in the loop removes that one, since every later close reuses it. Remove too any ticket worktree still
standing, which survives here only if the run stopped mid-cycle or was interrupted before the loop's
own removal ran. Then delete the drain branch locally and on the remote.

If the selector was a spec (an issue number with sub-issues) and every one of its sub-issues is now
closed, close the parent too, `gh issue close <parent>`. Nothing else does this: `/to-tickets` never
touches the parent, and the loop above (§3) closes only tickets. A parent left with any sub-issue
still open, or labelled `needs-human`, stays open.

Done when: every commit in `<starting-tip>..<branch>` was accounted for to a ticket in the batch or
reported and ruled on before the push, `git branch -r --contains <drain-tip>` lists
`origin/<default>`, the drain branch no longer exists locally or on the remote, and `git worktree
list` shows nothing this run cut.

## 5. Debrief

Report: the landing SHA, that the shared checkout's local `<default>` is behind `origin/<default>`
by it (§4), tickets closed, tickets left `needs-human` and why, gate status at each
merge, any commit landed that no ticket in the batch produced and how it was ruled on (§4), a
`.claude/contract.json` that changed after step 1 captured it, anything stopped-on, and any defect
this run hit in the drain machinery itself (`SKILL.md`,
`WORKER-PROMPT.md`, whichever `close-ticket` step 5 resolved, `~/.claude/hooks/close-gate.py`, the hooks), name it and the issue number
it was filed under, routed per `docs/agents/issue-tracker.md`, or say `none` if this run hit none.
Mandatory either way, the same reason the seam ledger's `none` is: an unfiled defect that goes
unmentioned here is lost with the session, which is the exact failure this line exists to close.

**Then stop.** A drain lands one batch and ends; it never sweeps its own landing for standards, and
it never drains what a sweep filed. Both are commands the maintainer gives, never consequences of
this run. Filing a machinery defect above is reporting, not sweeping; it changes no
code, only where the defect gets addressed, so it narrows that boundary, never weakens it.

Never run `/standards`, `/standards-pass`, or `/ratify` from here, and never dispatch a subagent
that would. Whether to name them in the debrief depends on how this run started:

- **Dispatched by `/standards`** (step 4 of that chain, this session): the chain is over. Say
  nothing about sweeping: no mention of `/standards`, no "the landing is unswept" note, no offer.
  Naming it is what turns a finished chain into another pass.
- **Invoked directly** (`/drain <selector>`, no chain around it): one line, saying the landing's standards
  are unswept, and `/standards` is how they get written up, so the choice is visible. A statement,
  not an offer; do not run it and do not ask whether to.
