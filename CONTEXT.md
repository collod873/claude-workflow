# Workflow

How Claude Code work gets filed, built, judged and closed. The domain here is *the machinery
itself*, not any project it ships.

## Language

**Symptom**:
A way the machine broke, linked as an issue, PR or failed run. Every part names the one it stops.
_Avoid_: failure

**Root cause**:
What one change would stop a set of symptoms: a row in `docs/root-causes.md`.
_Avoid_: bucket, theme

**Countermeasure**:
That one change. A **recurrence** after it lands disproves it; past the third is
**whack-a-mole**, Collin's call to reshape or scrap.
_Avoid_: fix, spot fix

### The machine

**Machine**:
This repo: `src/` and `bin/`. There is one machine and this is it.
_Avoid_: core, new core, v2

**Caller file**:
The one workflow another repo carries to have its tickets built and its specs and research notes
run: its triggers and calls to `tickets.yml` and `specs.yml` here, nothing else, so no part of the
machine is copied into it. `.github/caller.yml` is its text. Its specs are tried on its own checkout,
readied by its contract's setup. The closer wakes a builder by taking `waiting` off its ticket, which
the caller's `issues: unlabeled` hears from the caller's default branch alone, so the file lands on
main before any ticket there builds. A builder it reaches passes a check red only for
`(needs ...)` steps, which the machine's runner lacks, or unpublished receipts; that repo's own CI
judges its PR. A `DATABASE_URL` step is not one: the builder's job starts Postgres.
_Avoid_: shim, wrapper, vendored workflow

**Home**:
A stage run is home when it has no caller file, or when its caller file (named by `CALLED_FROM`)
is in the machine's own repo; it is foreign only when the caller file is in another repo. A home run
behaves exactly as this repo's own stage workflows did before Gaps first: the builder lands a `machine` outcome on
main and fails a check on any red step, `(needs ...)` ones included; the done check gets this repo's running-system line.
_Avoid_: local, own-repo mode

**Gaps first**:
How this repo moved onto the caller file: every gap on the reusable path closed first, then one PR
swapped its stage workflows for `machine.yml`. See `docs/adr/0001-cutover.md`.
_Avoid_: migration, switchover

**No caller, same file**:
A stage run with no caller file reaches the machine through `machine.yml`, the name `bin/enrol`
writes: reruns start through it.
_Avoid_: default caller, fallback workflow

**One checkout**:
Here the machine's and the target's checkouts are two clones of this repo at main, kept apart as in
any enrolled repo.
_Avoid_: self-checkout, same tree

**Enrol**:
Give a repo everything its tickets need to build: in one PR, the caller file,
the **check-job rule** (`check.yml`'s `check` job `if` and `name`; enrol's own PR still runs it) on
that CI's, and no pre-push, since `bin/land` is the gate; the App's reach, client id and keys, every label the
machine spells, auto-merge, and main taking changes only by a PR passing `check`, here too. It drops the
`tickets / review` and `review` checks no job posts, and the `queued`, `resolving` and `landing`
labels nothing marks (ADR-0012). This repo's `Enrol` workflow re-enrols them on each push to main.
`bin/enrol <repo>` sets what is missing and names what it could not set.
_Avoid_: onboard, install, register

**PC runner**:
A `pc` runner, where a private repo's `CI_RUNNER` sends jobs, else GitHub's.
_Avoid_: local runner

**Quick lane**:
Jobs building nothing, sent by `QUICK_RUNNER` to `pc-quick` runners.
_Avoid_: fast lane

**Worker**:
A part of the machine whose worth is the work it does: a step, a script, a stage.
_Avoid_: job, component

**Guard**:
A part whose worth is the symptom it stops, however rarely: a run time cap, a refusal, a hold.
It refuses out loud and never undoes the work.
_Avoid_: rail, safety net, guardrail

### Mechanisms

**Gate**:
Something that refuses an action at the moment it is attempted. Unlike a meter, it needs no
reader, only a trigger. A step the check runs is one; call it a step.
_Avoid_: validator, guardrail, lint

**Check**, **step**, **receipt**:
agent-hooks' words. A check is one run of `check`; a step is one named entry in
`.claude/contract.json`, all the machine knows of a repo it builds; a receipt records a step's pass
for exactly its inputs, so no step runs twice on one tree. The fast check runs mid-session; the
full check (`--full`) in `bin/land` and the builder. Its pass, posted
after the push as the head's `check` status by whoever pushed, is the whole check a PR merges on;
`Check` runs no `check` job on a landing's or a ticket's PR, since a pending run of that name
holds it (ADR-0008).
_Avoid_: gate (for a step), gauntlet, a repo-local check script, static check

**Meter**:
A rule that reports in the PR body what it would have refused, and refuses nothing. None is added any
more, and none runs (ADR-0006, ADR-0012).
_Avoid_: soft gate, warning, advisory check

**Refusal**:
A gate that fires before a run spends model time, so it is free when it fires.
_Avoid_: precondition, validation, check

**Builder**:
The agent that builds a ticket until its full check is green, then hands it to the reviewer. A
later run resumes its session or logs why not. It fixes the code, the ticket only in a `code`
answer, or the machine, splits or closes it, done if main holds it, else unbuilt; stopped, it marks
`stuck`. A spec's slice gets a **slice builder** instead (`bin/build-slice`): fast check only, its
own Postgres, port and temp dir, done when its branch fast-forwards the integration branch, or
`partial`, saying what is left.
_Avoid_: fixer, mechanic, fresh eyes, repair agent

**Reviewer**:
A fresh agent with the builder's access, in the builder's run: it reads the ticket, commit messages
and diff, fixes what it finds or approves, and lands it with `bin/land`, which hands back what it
refuses. Nothing goes back to the builder (ADR-0012). It files owner steps as `owner-step` notes
and what it lets through as research does. A spec gets two in series at its finish, one on the code
standard and one on the spec, each split per slice on a big diff.
_Avoid_: review job, judge, second builder

**Closer**:
`bin/close`: given a ticket and its merged PR, it closes the ticket; given a closed issue, it takes
`waiting` off each ticket that waited on it. It holds no queue and merges nothing.
_Avoid_: merger, queue, landing job

### The work

**Spec**:
The whole statement of a piece of work, filed as an issue labelled `spec`. One spec, one issue;
a spec in a file or a conversation has not been published yet.
_Avoid_: PRD document, requirements doc, brief

**Slicer**:
The stage that cuts a spec into slices with their blocked-by edges, the seams first, each slice at
its last responsible moment. The scheduler hires a fresh one at the start and after each merge,
reading the integration branch as built and the slices in flight; it files no ticket.
_Avoid_: splitter, decomposer, to-tickets, planner

**Run names**:
The `run-name` the caller file carries, so every run under it names what it does: the event and
its issue, a dispatch's rerun or probe, as `.github/caller.yml` spells each.
_Avoid_: run title, display name

**Done check**:
The stage that tries each of a spec's "I'll know it works when I can ___" sentences on the running
system once the spec has landed, and closes the spec once every one held or was put to the
owner. A miss leaves the spec open for the scheduler's one **fix pass**; a second miss marks it
`stuck`. A sentence put to the owner holds nothing open: the closing comment says what the owner
could try for it, and a miss seen live later is a new ticket. The owner's replies since the last
done check reach the next one, the fix pass's; a reply alone runs no done check.
_Avoid_: audit, acceptance test, verification

**Integration branch**:
`spec/<N>`, the one branch a spec builds on; every slice fast-forwards it, it is rebased onto main
before each slicer, and it lands once (ADR-0013). Each slice builds on `slice/<N>-<id>`, and each
of its commits carries a `Slice: <id>` trailer.
_Avoid_: spec branch

**Slice**:
One unit of a spec, cut at its last responsible moment: a seam, the shared code other slices plug
into, or after the seams one tracer bullet through the spec; never a ticket.
_Avoid_: piece, task

**Frontier**:
The slices whose blockers have all merged; only these get a builder.
_Avoid_: ready queue

**Scheduler**:
`bin/schedule`, the code that runs a spec, hiring each fresh slicer and slice builder, at most
three at once, then `bin/finish` (full check, two reviewers, `bin/land`, done check); it holds no
model context. Its state is the integration branch and the `## Spec run` progress comment it alone
writes, so a rerun resumes from them.
_Avoid_: orchestrator

**Ticket**:
The unit the machine builds: an issue labelled `ticket` carrying `## Why` in the owner's words,
`## Done when`, what done looks like in its own repo, and any `## Follow-ups`, one line per other
repo, filed there as a build by whoever lands it. Adding `ticket` to an open issue builds,
reviews and lands it in one run (ADR-0012), as `spec` slices and `research` answers; opening starts
nothing, and taking `ticket` off and adding it back builds it again. Its PR merging closes it.
_Avoid_: issue, sub-issue, card, item

**Note**:
An issue labelled `note`: filed to be kept, never built, with a `## Why`. A research
note, labelled `research` too, the machine answers and closes; one labelled `owner-step`, a step
only the owner can take. `file-issue` files these as `idea`, `look-into` and `owner`.
_Avoid_: idea, bug, backlog item, memo

**Stage**:
One agent process in a pipeline run, with no memory of other stages. Not an Actions job or step: a
stage is a context boundary and they are not. Each stage declares its part row, prompt caps and
quiet-output scenarios in its own part file, `src/<stage>.part.ts`, and its own stops in its own
code; every growth limit finds them by scanning, so no two stages share a list.
_Avoid_: phase, pass, step, job

**Stage opening**:
How a stage starts on its issue, in `src/stage.ts` beside the hire: it reads the issue once, ends red
at `unread` when it cannot, ends green in one line on `paused` or `stuck` with no label changed and
no model hired, then marks the stage's state, makes the log directory and hires. The slicer, the
researcher and the done check open through it.
_Avoid_: preamble, setup, bootstrap

**Paused**:
An issue the owner labelled `paused`, a `held` label the machine never adds or removes. Each stage
reads it when it opens and stands down, so a run already going finishes and none starts after it;
on a spec, its builders mid-slice finish into the integration branch and no new one is hired. A
paused ticket or spec does not land: its reviewer reads the label before `bin/land`.
_Avoid_: on hold, frozen, blocked

**Stuck**:
An issue the machine labelled `stuck`, its last resort: a stage that cannot go on marks it, and a
stage run marks it only when its re-run stops too.
Its comment names the run that stopped, ended red or out of time, links the first run and the
re-run, and asks the owner to look at the re-run and take `stuck` off once the cause is fixed.
Like `paused` it is `held`, so every stage stands down on it, and the machine adds it but never
removes it.
_Avoid_: blocked, failed

**Rerun**:
The machine's second try at a stage run that stopped. A job that ends red or is cancelled by its
time limit leaves an `owner call` notice naming its issue, unless that issue is `held`; once the run
completes, Rerun by dispatch hands it to `bin/rerun`, which re-runs its failed jobs once on a
first attempt, marking nothing and posting nothing, and marks the issue `stuck` on a later one. A run the owner cancelled is neither re-run nor
marked.
_Avoid_: retry, second chance

**Rerun by dispatch**:
How a stopped run reaches `bin/rerun`, as the caller cannot hear itself: each reusable workflow's
last job needs every stage job but the probe and rerun and, when one stopped,
dispatches the run's caller file with `rerun` set to `<run id>/<attempt>`. Only the `rerun` job runs on that dispatch: it waits for that attempt
to complete and stands down if the run has moved past it, so two hand-offs act once. A caller
lacking the input refuses the dispatch: logged, not red.
_Avoid_: self-heard rerun, rerun workflow

**Probe**:
A script or prompt `bin/probe --in <repo>` runs in the builder's environment, with no ticket or
GitHub token; nothing runs after it.
_Avoid_: dry run, smoke test

**Blip**:
A GitHub call that fails on a server error, a rate limit, a timeout or a not-found. Every call the
machine makes goes through `bin/github`, which tries a blip up to 3 times, 1s then 2s apart, and logs
each try again, before the call fails; a call for which a not-found is the answer, like a ticket's
missing parent, says `--missing-answers`. A blip is absorbed at its call, a rerun at its run.
_Avoid_: flake, glitch

**Resume**:
Setting a held issue going again. Taking `waiting` off a ticket resumes its build; the closer takes it
off once every piece of its split, fault it filed and issue its `## Waits on` names has closed. Taking `paused`
or `stuck` off a ticket that then holds neither builds it again on the branch its last run kept,
its builder resuming its session. Taking either off an open spec that then holds neither runs its
scheduler again from its integration branch and progress comment.
_Avoid_: unpause, restart, unblock

