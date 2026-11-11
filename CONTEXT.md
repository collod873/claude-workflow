# Workflow

How Claude Code work gets filed, built, judged and closed. The domain here is *the machinery
itself*, not any project it ships.

## Language

**Symptom**:
A way the machine broke, linked as an issue, PR or failed run. Every part names the one it stops.
_Avoid_: failure

**Root cause**:
What one change would stop a set of symptoms.
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
readied by its contract's setup. Reconcile wakes a builder by taking `waiting` off its ticket, which
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

**Ship**:
`bin/ship`, run from an app's checkout, moves that app's production by pushing a commit to the
`release` branch its host deploys, once a full check that CI's own dispatch ran has passed on that
commit; a push or pull request run never counts. A red check, or one still waiting at its deadline,
holds the ship and files a "Ship held" bug. Each app carries a **ship caller file**: its once-a-day
cron and `health-url`, calling `ship.yml` here (`.github/ship-caller.yml` is its text). The **ship
clock**, `bin/ship-clock` run once on the PC, turns each caller's cron into a systemd timer that
dispatches it on time, caught up at boot when the PC was off: GitHub fires this account's schedules
hours late (Mezzanine's 08:00 ship started 14:26 to 17:51, and 15-minute crons fire every 4 to 7
hours), so a late GitHub run ships only when no dispatched Ship ran in the last 20 hours. `bin/enrol`
does not write it, since both differ per app and not every enrolled repo deploys from a release
branch. No app keeps a copy of the code (ADR-0004).
_Avoid_: deploy script, promote, release job

**PC runner**:
A `pc` runner, where a private repo's `CI_RUNNER` sends every job but reconcile's, else GitHub's. Reconcile's
job takes the repo's one `pc-reconcile` runner, so a wake never queues behind a builder; its concurrency group
runs one pass at a time, so one is enough, and on GitHub's a pass of seconds per ticket event bills a minute. It caps neither memory
nor CPU: its full checks take turns in the machine's one check slot, as the owner's do, so each gets
every core. While a repo's PC runners are all offline, the runner watch sets its `CI_RUNNER` to
`ubuntu-latest`, and back to `pc` once one returns; an unset `CI_RUNNER` is a hand switch it leaves.
_Avoid_: local runner, quick lane

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

**Keys**:
The secrets a repo's contract names in its `needs` list, beside its steps. That list is what the tree
needs from outside: `DATABASE_URL` there, or under any step's `needs`, gets its own Postgres, and every
other name is a key. One `needs` step in every job that runs a stage hands each key the repo's secrets
hold to its stages, so the builders and the done check see what the app sees, and names the rest in
`UNSET_KEYS`: a builder proves code resting on one against a stand-in and names the key, and the done
check puts a sentence resting on one to the owner.
_Avoid_: env, credentials, test keys

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
answer, or the machine, hands a first step to its owning repo, rewrites one too big for one build as a spec, or closes it, done if main
holds it, else unbuilt; stopped, it marks `stuck`. A spec's slice gets a **slice builder** instead (`bin/build-slice`): fast check only, its
own Postgres, port and temp dir, done when its branch fast-forwards the integration branch, or
`partial`, saying what is left.
_Avoid_: fixer, mechanic, fresh eyes, repair agent

**Reviewer**:
A fresh agent with the builder's access, in the builder's run: it reads the ticket, commit messages
and diff, fixes what it finds or approves, and lands it with `bin/land`, which hands back what it
refuses. Nothing goes back to the builder (ADR-0012). It files owner steps as `owner-step` notes
and what it lets through as research does. A spec gets two in series at its finish: one on the spec over
the whole branch, handed each slice's brief, then one on the code standard, last so it holds what the
first wrote. Each works in a tree the contract's setup readied. Only a diff over 200 KB splits either
into **packs**: whole slices packed into as few as fit under that cap, one reviewer each, at most three
at once, each in its own tree on `review/<N>-spec-<k>` or `review/<N>-code-<k>` and rebased onto the
integration branch as it answers.
_Avoid_: review job, judge, second builder

**Closing**:
No stage closes, queues or merges by itself: waking what a closed issue blocked is reconcile's alone (#1606). A ticket closes on its PR's `Closes #N`, which `bin/land --ticket`
writes, and a session's commit may close an issue the same way, since `bin/land` merges only past
the full check. A spec closes on landing, from its done check's tries, so `bin/land --spec` refuses a
commit that closes it by keyword. Every stage stands down on a closed issue as on a held one.
_Avoid_: closer, merger, queue, landing job

### The work

**Spec**:
The whole statement of a piece of work, filed as an issue labelled `spec`. One spec, one issue;
a spec in a file or a conversation has not been published yet. One filed blocked by an open issue
is parked: filed `waiting`, linked, then labelled `spec`, and a spec labelled `waiting` never starts.
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
The stage that tries each of a spec's "I'll know it works when I can ___" sentences, then each of
its numbered user stories, on its integration branch before it lands, in its own tree, port and Postgres, beside the full check. It
refuses nothing: its misses go once to the last reviewer, a fixed one lands with the spec, and the
rest are filed as bugs quoting what it saw once the spec has landed, when it also comments and
closes the spec. A sentence put to the owner holds nothing open and files nothing: the closing
comment says what the owner could try, and a miss seen live later is a new ticket. An owner step is
missing work, never a try (agent-hooks#83).
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

**Seam migration**:
The one migration a spec's first cut plans for the whole spec's schema, as one seam slice the later
slices build on. A later slice adds its own only for a change the seam missed, and says why in its
`why`; nothing is refused over it.
_Avoid_: schema slice, per-slice migration

**Frontier**:
The slices whose blockers have all merged; only these get a builder.
_Avoid_: ready queue

**Scheduler**:
`bin/schedule`, the code that runs a spec, hiring each fresh slicer and slice builder, at most
three at once, then `bin/finish` (two reviewers, done check, full check, `bin/land`); it holds no
model context. Its state is the integration branch and the `## Spec run` progress comment it
writes, where `bin/finish` stamps the landing alone, so a rerun resumes from them: once the spec has landed, it closes from the tries the progress
comment recorded, and runs the done check on `main` only when none were recorded.
_Avoid_: orchestrator

**Ticket**:
The unit the machine builds: an issue labelled `ticket` carrying `## Why` in the owner's words,
`## Done when`, what done looks like in its own repo, and any `## Follow-ups`, one line per other
repo, filed there as a build by whoever lands it. Adding `ticket` to an open issue builds,
reviews and lands it in one run (ADR-0012), as `spec` slices and `research` answers; opening starts
nothing, and taking `ticket` off and adding it back builds it again. Its PR merging closes it.
A build reads its ticket's labels again at admit, so one queued behind the build before it stands
down once that build marked it `waiting`, `paused` or `stuck`, or closed it.
_Avoid_: issue, sub-issue, card, item

**Reconcile**:
`bin/reconcile`, the one idempotent pass that owns wake, admit and stale-build recovery: a pure
`reconcile` from each open ticket's state to label edits, each checking the labels first so two
runs at once act once. `waiting` is its projection of the ticket's blocked-by links and any checks
wait, written and never read as state; a ticket with neither is left alone. Any other open issue labelled
`waiting`, a spec included, has `waiting` taken off once every blocker closed. When an issue closes,
the pass in its repo also reconciles each issue it blocked in another repo, so a cross-repo wait
ends on the close; the 15-minute clock is the last resort. The builder and the scheduler park
through `park`, which links each blocker, then marks `waiting`; a link already there counts as linked.
_Avoid_: sweeper, poller

**Checks wait**:
A line in an issue's body, `Waits on N full checks of <repo> after <repo>@<sha>.`, for work that
measures what a change did once it lands. Reconcile counts that repo's CI runs started after the
commit landed, when its pull request merged or, with none, when it was pushed, that left a
`check-logs` artifact, each holding its check's ledger rows; once N have,
it rewrites the line as `Waited on ...`, naming the runs and how to download their rows, and takes
`waiting` off. A builder answers `waits` with `checks` to write it.
_Avoid_: data wait, delayed ticket

**Note**:
An issue labelled `note`: filed to be kept, never built, with a `## Why`. A research
note, labelled `research` too, the machine answers and closes; one labelled `owner-step`, a step
only the owner can take. `file-issue` files these as `idea`, `look-into` and `owner`.
_Avoid_: idea, bug, backlog item, memo

**Stage**:
One agent process in a pipeline run, with no memory of other stages. Not an Actions job or step: a
stage is a context boundary and they are not. Each stage declares its part row, prompt caps and
quiet-output scenarios in its own part file, `src/<stage>.part.ts`, and its own stops in its own
code; every growth limit finds them by scanning, so no two stages share a list. Its prompt is in its
**own words**: written for its job in its own module, sharing no prose with another stage's, and
pointing at a skill for any rule a skill holds; the prompts step refuses two stages' prompts that
say the same eight words, imported or pasted, while shared code (schemas, caps, filing, the check
runner) stays shared.
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

**Owning repo**:
The one repo a kind of fix belongs in: this one for the machine, `design-kit` for a kit primitive,
`agent-skills` for a skill or shared tool. A builder whose ticket's first step belongs there answers
`owned`: it files that step there as a ticket and its own ticket waits on it. It is blocked by that
step, and the step's close wakes it through reconcile in the step's repo.
_Avoid_: upstream, other repo, dependency

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

**Sonnet builders trial**:
The one spec per repo labelled `sonnet-builders`: the first spec filed after the trial began, which
`file-issue` labels while no issue in the repo carries it. The scheduler hires its slice builders
on Sonnet; every other stage stays on the model and effort its hire names. It is judged against
Opus builders on red checks, holds' fixes per slice and cost per slice (#1647).
_Avoid_: experiment, A/B, canary

**Account failover**:
The owner's two Claude subscriptions, one token each in `CLAUDE_CODE_OAUTH_TOKEN` and
`CLAUDE_CODE_OAUTH_TOKEN_2`. A hire whose model ends on a usage limit is launched again at once on
the other account, and every later hire in that run stays there, as does a hire already running on
the spent one when another moved first; it ends red only when both are spent. `claude-token-to-gh --second` fills the second slot, `bin/enrol` sets both.
_Avoid_: backup token, second key

**Resume**:
Setting a held issue going again. Taking `waiting` off a ticket resumes its build; reconcile takes it
off once every issue it is blocked by has closed. Taking `paused`
or `stuck` off a ticket that then holds neither builds it again on the branch its last run kept,
its builder resuming its session. Taking either off an open spec that then holds neither runs its
scheduler again from its integration branch and progress comment, resuming each out slice's builder with the reason it stopped.
_Avoid_: unpause, restart, unblock

