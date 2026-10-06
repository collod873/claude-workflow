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
It passes such a check even when it says its receipts were not published, as a green one saying so
passes: that repo's CI judges its PR without them.
_Avoid_: shim, wrapper, vendored workflow

**Enrol**:
Give a repo everything its tickets need to build: the caller file naming its own CI, the App's
reach, the App's client id and keys, every label the machine spells, auto-merge, and main taking
changes only through a PR passing `check`. `bin/enrol <repo>` sets what is missing and names what it
could not set; a missing auto-merge Save meets later is the repo's fault, never the ticket's.
_Avoid_: onboard, install, register

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
A rule that reports in the PR body what it would have refused, and refuses nothing. Every new rule
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
under the ticket's `## Decisions it relies on`, and a ticket citing a pick ends its Done when asking
for the pick's full description in `CONTEXT.md` or an ADR.
_Avoid_: names section, spec rewrite, Names the tickets share

**Pick**:
A choice the slicer made where the spec was silent, or a name two tickets of a wave both need,
written in full under `### Picks` until its ticket merges.
_Avoid_: decision, assumption, settled name

**Shipped name**:
A pick whose ticket merged, cut to one line under `### Shipped names` naming the `CONTEXT.md` term
or ADR it lives under, since the code now says the rest.
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

**Done check**:
The stage that tries each of a spec's "I'll know it works when I can ___" sentences on the running
system once nothing is left to slice, and closes the spec only when every one held. A first miss
gets the spec's one fix wave; a second marks the spec `stuck`. A sentence it puts to the
owner waits for his reply on the spec, which runs it again. It may not give a sentence
`unexercised`; one it gives anyway ends the run red, posting and closing nothing.
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
research, slice, reslice, resume, done check or fix run marks it only when its re-run stops too.
Its comment names the run that stopped, ended red or out of time, links the first run and the
re-run, and asks the owner to look at the re-run and take `stuck` off once the cause is fixed.
Like `paused` it is `held`, so every stage stands down on it, and the machine adds it but never
removes it.
_Avoid_: blocked, failed

**Rerun**:
The machine's second try at a stage run that stopped. A job that ends red or is cancelled by its
time limit leaves an `owner call` notice naming its issue, unless that issue is `held`; once the run
completes, `bin/rerun` re-runs its failed jobs once on a first attempt, marking nothing and posting
nothing, and marks the issue `stuck` on a later one. A run the owner cancelled is neither re-run nor
marked.
_Avoid_: retry, second chance

**Resume**:
Setting a held issue going again. Taking `waiting` off a ticket resumes its build. Taking `paused`
or `stuck` off a ticket that then holds neither picks it up from where it stands: with no PR it
builds, with a red PR its builder resumes its session, with a green PR auto-merge comes back on at
its head, and a green PR behind main gets the closer's own branch update: marked landing, or on a
conflict reported at its head, marked resolving and its builder woken once. Taking either off an open spec that then holds neither reads where it stands, as a wave's
end does: a slice cut short slices again; a wave closed during the hold gets its wave check, then its
slice, or only its slice once checked; with nothing left to slice, the done check runs. A wave still
open waits for its last close.
_Avoid_: unpause, restart, unblock
