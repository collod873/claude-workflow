# Workflow

How Claude Code work gets filed, built, judged and closed. The domain here is *the machinery
itself*, not any project it ships.

## Language

**Failure**:
A way the machine broke, linked as an issue, PR or failed run. Every part names the one it stops.
_Avoid_: problem, antipattern

### The machine

**Machine**:
This repo: `src/` and `bin/`. There is one machine and this is it.
_Avoid_: core, new core, v2

**Caller file**:
The one workflow another repo carries to have its tickets built and its specs and research notes
run: its triggers and calls to `tickets.yml` and `specs.yml` here, nothing else, so no part of the
machine is copied into it. `.github/caller.yml` is its text. Its specs are tried on its own checkout,
readied by its contract's setup, and a ticket the closer closes there starts the re-slice through
the caller's own `issues: closed`, since the App's close is heard. The closer wakes a builder by dispatching the caller file by its own file name with
`ticket` and `reason`, which GitHub starts only from the caller's default branch, so the file lands
on main before any ticket there builds. A builder it reaches passes a check red only for steps
named `(needs ...)`, which the machine's runner lacks; that repo's own CI judges them on its PR.
The runner lacks no `DATABASE_URL`: when a step needs it, the builder's job starts `postgres:16`
and hands its address on, so the builder sees that step red and its receipt covers the PR.
It passes such a check even when it says its receipts were not published, as a green one saying so
passes: that repo's CI judges its PR without them.
_Avoid_: shim, wrapper, vendored workflow

**Home**:
A stage run is home when it has no caller file, or when its caller file (named by `CALLED_FROM`)
is in the machine's own repo; it is foreign only when the caller file is in another repo. A home run
behaves exactly as this repo's own stage workflows did before Gaps first: the builder lands a `machine` outcome on
main and fails a check on any red step, `(needs ...)` ones included; the closer requires both
`check` and `review`; the done check gets this repo's running-system line and is offered the size
trial. So this repo moved onto the caller file with no difference the owner sees.
_Avoid_: local, own-repo mode

**Gaps first**:
How this repo moved onto the caller file: every gap on the reusable path closed first, then one PR
swapped its stage workflows for `machine.yml`. See `docs/adr/0001-cutover.md`.
_Avoid_: migration, switchover

**No caller, same file**:
A stage run with no caller file reaches the machine through `machine.yml`, the name `bin/enrol`
writes: builders wake and size trials start through it, and the closer dispatches no re-slice, as
the caller's `issues: closed` starts it.
_Avoid_: default caller, fallback workflow

**One checkout**:
Here the machine's and the target's checkouts are two clones of this repo at main, kept apart as in
any enrolled repo.
_Avoid_: self-checkout, same tree

**Enrol**:
Give a repo everything its tickets need to build: the caller file naming its own CI, the App's
reach, the App's client id and keys, every label the machine spells, auto-merge, and main taking
changes only through a PR passing `check`. `bin/enrol <repo>` sets what is missing and names what it
could not set; a missing auto-merge Save meets later is the repo's fault, never the ticket's.
_Avoid_: onboard, install, register

**PC runner**:
A runner on the owner's PC labelled `pc`, one set per private repo, installed by `bin/runner`. A
repo's `CI_RUNNER` set to `pc` sends its stage jobs and CI there; unset, to GitHub's runners.
_Avoid_: self-hosted mode, local runner

**Worker**:
A part of the machine whose worth is the work it does: a step, a script, a stage.
_Avoid_: job, component

**Guard**:
A part whose worth is the failure it stops, however rarely: a run time cap, a refusal, a hold.
It refuses out loud and never undoes the work.
_Avoid_: rail, safety net, guardrail

### Mechanisms

**Gate**:
Something that refuses an action at the moment it is attempted. Unlike a meter, it needs no
reader, only a trigger. A step the check runs is one; call it a step.
_Avoid_: validator, guardrail, lint

**Check**, **step**, **receipt**:
agent-hooks' words, used here exactly as there. A check is one run of `~/bin/check`, the one
runner; a step is one named entry in `.claude/contract.json`, which is all the machine knows of
any repo it builds, this one included; a receipt records that a step passed for exactly its
inputs, so no step runs twice for the same tree. The fast check runs mid-session, the full check
(`--full`) at push, in the builder and in the `check` job of `Check`, the PR workflow, which runs
the review and the meters beside it.
_Avoid_: gate (for a step), gauntlet, a repo-local check script, static check

**Meter**:
A rule that reports in the PR body what it would have refused, and refuses nothing. An unproven rule
enters as one; run on 30 merged PRs, it becomes a gate or is deleted.
_Avoid_: soft gate, warning, advisory check

**Refusal**:
A gate that fires before a run spends model time, so it is free when it fires.
_Avoid_: precondition, validation, check

**Builder**:
The one agent that builds a ticket, and owns it from that build until it merges, one session across
every red run; a run that cannot resume that session says why in its log before it starts fresh. It fixes the code, ticket or machine, splits the ticket, or closes it unbuilt; when it
stops, it marks `stuck`.
_Avoid_: fixer, mechanic, fresh eyes, repair agent

### The work

**Spec**:
The whole statement of a piece of work, filed as an issue labelled `spec`. One spec, one issue;
a spec in a file or a conversation has not been published yet.
_Avoid_: PRD document, requirements doc, brief

**Slicer**:
The stage that turns a filed spec into tickets under it, one wave at a time. It answers with the
spec's decisions record, never the spec: code keeps every other byte as filed and splices the
record in. When a wave's last ticket closes, it slices the next against the spec and what that wave
found, cutting each pick whose ticket merged to a shipped name. A shared surface's slot is sliced a
wave ahead of the pieces that plug into it.
_Avoid_: splitter, decomposer, to-tickets, planner

**Decisions record**:
The one section of a spec the slicer writes, `## Decisions record` just before the sentences:
`### Picks` and `### Shipped names`, each bullet starting `- **name**:`. It names no file path, and
it is what gives way when the spec nears the spec cap; the owner's sections never do. Builders never
read the spec, so tickets carry the entries they cite: code copies each cited bullet word for word
under the ticket's `## Decisions it relies on`.
_Avoid_: names section, spec rewrite, Names the tickets share

**Pick**:
A choice the slicer made where the spec was silent, or a name two tickets of a wave both need,
written in full under `### Picks` until its ticket merges.
_Avoid_: decision, assumption, settled name

**Shipped name**:
A pick whose ticket merged, cut to one line under `### Shipped names` saying what it names, since
the code now says the rest.
_Avoid_: done pick, built name

**Wave**:
The tickets under one spec that are open at once and build side by side. The tickets in one wave
touch different parts, so none edits a file another edits. Only the current wave is tickets; the
rest is still the spec.
_Avoid_: batch, phase, sprint, round

**Wave note**:
The one comment the slicer posts on a spec for each wave it files, starting `## Wave` and its
number: the owner's words the wave's tickets quote, copied by code, what the wave before it did,
what comes next, and a `<!-- moves: ... -->` marker naming the sentences the wave should move. It
is the wave's readback.
_Avoid_: wave summary, status update, progress report

**Slice proof line**:
What every slice that files a wave says on the running system, so a wave check reads it from the
spec's wave notes and the run logs instead of rebuilding each body from edit history. Before it
posts, code compares the owner's bytes of the body it would post with those it read, and stops red
without posting if they differ. Each round that comes back for the spec's size logs the bytes over
the spec cap and the bytes the record had to lose. The filing line says the owner's bytes, with their
count, stand as filed, and gives the seconds from the first size round to filing, or says no round
came back for the size; the wave note carries the same owner's-bytes line for the owner.
_Avoid_: proof comment, audit line, byte check

**Size trial**:
A slice of a real spec run under a trial cap below the spec cap, so the size refusal happens on the
running system without padding any spec over the real cap. It is asked for with
`bin/slice --size-trial <spec> <trial cap>`, through a caller file (see Trial through the caller). The trial cap stands in for the spec cap in the size
refusal, its sent-back prompt and each round's log line, but not in the room line (see Trial room
line). The real slicer is hired and sent back each round exactly as in a real slice, answering with
the record and the wave only.
When the wave would file, code proves the owner's bytes stand in the body it would post and logs the
filing line it would have written, starting `slice: trial #N`, with the owner's bytes and the seconds
from the first size round, and posts nothing: no body edit, no ticket, no note, no label; a wave still
refused after the rounds back ends red without marking `stuck` or commenting. A trial of a spec with
nothing left to slice goes through Record at the hand-off under its trial cap and logs
`slice: trial #N would hand it to the done check` instead. A trial cap at or above
the spec cap, or below the owner's bytes, is refused before any model is hired, since the first can
never refuse and the second can never fit. A wave check trying the over-cap sentence runs one on the
spec with the cap described under Trial cap a check sets and reads its log. A trial
runs one at a time per spec in a concurrency group of its own, apart from the re-slice's.
_Avoid_: dry run, size test, fake cap

**Trial room line**:
In a size trial, the room line the slicer reads before its first answer gives the room under the
spec cap, not the trial cap; only the size refusal, its sent-back prompt and its round log lines use
the trial cap. Told the trial cap up front, a slicer cuts its record to fit before it answers, and no
round comes back, so the trial shows nothing of a slicer that misjudges its room. Told the spec cap,
its first answer goes over the trial cap the way a real over-cap slice goes over the spec cap.
_Avoid_: trial room, dry room line

**Trial cap a check sets**:
The trial cap the checker's size trial command carries: the owner's bytes plus half the record's
bytes, both counted from the spec's current body. A cap a few hundred bytes under the spec's size
let the slicer's own folding of the last wave fit without a round back, so the over-cap sentence was
never seen; half the record cannot hold a record the slicer only trims.
_Avoid_: trial size, check cap

**Record at the hand-off**:
When a slice gives no ticket and the last wave check missed nothing, code still holds its record to
the cap with the size refusal like any wave, proves the owner's bytes stand, and posts the spec with
the record spliced in before it runs the done check, so the last wave's picks are folded into shipped
names before the sentences are tried. Its line, `slice: #N has nothing left to slice, so it posted
its record and the done check tries its sentences`, says the owner's bytes stand and gives the
seconds from the first size round. A size trial of such a spec takes the same path under its trial
cap: sent back while over, then it logs `slice: trial #N would hand it to the done check` with the
owner's bytes standing and the seconds from the first size round, and posts nothing.
_Avoid_: trial of a finished spec, final record

**Check-started size trial**:
A size trial a wave check or done check on this repo starts itself, to try a sentence about the size
refusal, since a trial posts nothing to any spec. The checker's prompt names the manual run of the
caller file to start, with the spec and the trial cap a check sets, and says starting it counts
as leaving GitHub as it is. The checker waits for that run
to end and answers from its log: each size round with the bytes over and the bytes the record had to
lose, and the `slice: trial #N` line saying the owner's bytes stand and the seconds from the first
size round. The check holds the app's unnarrowed token, the one the closer wakes builders with, so
it can start the run. The trial's concurrency group is per spec and apart from the
re-slice's, so a check running inside a re-slice never queues behind itself; a trial posts nothing,
so it cannot race the re-slice's posting. A trial that ends red, or whose filing line gives 60
seconds or more, is a miss, not a try left untried. Every check starts it as described under Trial
through the caller, one with no caller file through the file No caller, same file names.
_Avoid_: self-test, trial hook

**Trial through the caller**:
A size trial started through a caller file, so every repo on the caller file can run one. The
caller file's dispatch takes an optional `trial_cap` beside `ticket` and
`reason`; a dispatch carrying it runs the `size-trial` job in `specs.yml` on the spec named in
`ticket`, with `bin/slice --size-trial` in the concurrency group `size-trial-<spec>`, the re-slice
job's checkouts and caps and a token that can only read, and `tickets.yml` starts no builder for it.
A check under a caller file reads the file's name from the run it is called from and is told to
start the trial with `gh workflow run <caller file> -f ticket=<spec> -f reason=size-trial -f
trial_cap=<cap>` and to find its run under that file. A dispatch with no trial cap, `rerun` or
`probe` wakes a builder.
_Avoid_: caller trial, foreign trial

**Run names**:
The `run-name` the caller file carries, so every run under it names what it heard: an issue or
comment event shows `<action> #<number>: <title>`, a closed PR `closed PR #<number>: <title>`, a
dispatch `Probe (<how>): <probe>` for a probe, `Rerun of run <run id>/<attempt>` when it carries `rerun`, `Size trial of #<ticket> under
<trial_cap>` when it carries a trial cap and `Fix #<ticket>` otherwise, a heard run `After <workflow>
on <head branch>`, and a push `Push to main`. Enrol writes the file with no line folded, so the run
name stays one line.
_Avoid_: run title, display name

**Done check**:
The stage that tries each of a spec's "I'll know it works when I can ___" sentences on the running
system once nothing is left to slice, and closes the spec once every one held or was put to the
owner. A first miss gets the spec's one fix wave; a second marks the spec `stuck`. A sentence put
to the owner holds nothing open: the closing comment says what the owner could try for it, and a
miss seen live later is a new ticket; a spec an older done check left marked `asked` is tried again
on the next push to main. It may not give a sentence `unexercised`; one it gives anyway
ends the run red, posting and closing nothing.
_Avoid_: audit, acceptance test, verification

**Wave check**:
The done check at a wave's end, trying only the sentences that wave should have moved. It skips
the ones only the owner can try and closes nothing. A sentence that misses at a wave check and
again at the next wave check or at the end marks the spec `stuck`. A sentence nothing on
main could have shown yet it gives `unexercised`, listed as **Not tried yet** with what would have
to happen for it to be seen; that is never a miss, and the next wave check tries it again.
_Avoid_: wave review, checkpoint, interim check

**Ticket**:
The unit the machine builds: an issue carrying `## Why` in the owner's words and, under
`## Done when`, sentences saying what done looks like. Filing one starts its build; its PR
merging closes it.
_Avoid_: issue, sub-issue, card, item

**Note**:
An issue labelled `note`: filed to be kept, never built, with a `## Why` saying why. A research
note, labelled `research` too, the machine answers and closes.
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
a pause on a spec holds the spec alone, not its wave's tickets. A paused ticket's PR does not merge:
adding `paused` turns its auto-merge off, and a save on a held ticket leaves it off, so the closer
neither queues nor merges it.
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
marked. The closer names the ticket in its hands when it stops, so its run calls the owner on that.
_Avoid_: retry, second chance

**Rerun by dispatch**:
How a stopped run reaches `bin/rerun`, as the caller cannot hear itself: each reusable workflow's
last job needs every stage job and, when one stopped, dispatches the run's caller file with `rerun`
set to `<run id>/<attempt>`. Only the `rerun` job runs on that dispatch: it waits for that attempt
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
off only once every issue the ticket's `## Waits on` names has closed. Taking `paused`
or `stuck` off a ticket that then holds neither picks it up from where it stands: with no PR it
builds, with a red PR its builder resumes its session, with a green PR auto-merge comes back on at
its head, and a green PR behind main gets the closer's own branch update: marked landing, or on a
conflict reported at its head, marked resolving and its builder woken once. Taking either off an open spec that then holds neither reads where it stands, as a wave's
end does: a slice cut short slices again; a wave closed during the hold gets its wave check, then its
slice, or only its slice once checked; with nothing left to slice, the done check runs. A wave still
open waits for its last close.
_Avoid_: unpause, restart, unblock
