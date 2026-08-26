# The run watchdog sweeps on session end, because workflow_run is keyed on a name the failure erases

Recorded 2026-08-26.

[#41](https://github.com/collod873/claude-workflow/issues/41)'s watchdog does not fire on the run it
watches. It rides the `session-captured` dispatch and sweeps the last seven days of runs for any that
completed having executed zero jobs. `workflow_run` was the obvious trigger and it is structurally
blind to this failure.

## Why this came up

`DESIGN.md` §5 draws the line between a reconciler and a watchdog as *when* each runs: a reconciler
only has to run after the failure, which is what lets the close gate's reconciler ride session end
([ADR-0048](0048-the-close-gate-s-reconciler-rides-session-end-because-a-cron.md)), while "a watchdog
fires *during* the failure." That sentence reads as a requirement on #41, and the implementation was
started against `workflow_run` on that basis.

## What the trigger cannot see

`workflow_run`'s `workflows:` filter matches on a workflow's **name** — the string after `name:`
inside the file. The failure this watchdog exists for is GitHub being unable to parse the file at
all, and a file it cannot parse has no readable `name:`. GitHub names those runs after their own
path instead: all 25 zero-job runs in this repo's history are named
`.github/workflows/to-tickets.yml` or `.github/workflows/parse-probe.yml`, not `To tickets`.

So a name filter is blind to exactly the runs it would be there to catch, and no list of names fixes
it — the name does not exist at the moment it would be needed. Dropping the filter is not available
either: `actionlint`, which `verify.yml` runs as a gate, refuses the un-filtered form outright
(*"no workflow is configured for `workflow_run` event"*).

The trigger also fails #41's own third criterion on its face. A mechanism that "covers workflows that
do not exist yet" cannot be keyed on a list of the ones that do.

## Considered options

**`workflow_run`.** Rejected above. It is worth writing down because it is the first thing anyone
will reach for, and the reason it fails is not visible from the trigger's documentation.

**`push`.** Genuinely "during" — the same event that spawns the dead run — and it sees every
workflow. Rejected on cost: it fires on every push to every branch, and this repo pushes 13–22 times
on a working day against an estate already over its 2,000-minute monthly cap
([ADR-0002](0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md)). A watchdog whose
own bill is the largest line in the account gets turned off, which is the C4 failure by a different
route.

**A schedule.** Forbidden by [ADR-0004](0004-a-clock-may-release-a-batch-but-may-never-originate-work.md)
for the same reason ADR-0048 rejected it, and no better here: a daily sweep of a repo nobody touched
fires against nothing.

**Session end.** What shipped. It cannot fire vacuously — a session that ended is work that happened,
and dead runs only arrive during work — so it needs no exception to ADR-0004. It reuses the dispatch
the capture hook already sends rather than adding one, because a second dispatch is a second thing
that can silently stop arriving (#107 is what that looks like).

## What this amends

`DESIGN.md`'s during/after distinction survives as a description of the close gate's reconciler and
stops being a requirement on #41. The distinction that actually matters is not when a mechanism runs
but **whether the evidence it reads outlives the failure**. The close gate's does not — GitHub never
replays a missed event, so a reconciler has to reconstruct. A dead run does: the run object, its
conclusion and its job count sit in the Actions API for ninety days, and nothing about reading them
an hour later is worse than reading them at the moment they appeared.

This **extends** [ADR-0048](0048-the-close-gate-s-reconciler-rides-session-end-because-a-cron.md) to
a second mechanism and carries no `Amends:` trailer, because it supersedes nothing that ADR ruled —
the distinction [ADR-0045](0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md) draws
between `extends` and the five supersession verbs. Both records stand. What is amended is a sentence
in `DESIGN.md`, which is not an ADR and does not take a trailer.

## Consequences

A workflow broken and pushed mid-session is reported at that session's end rather than within the
minute. That is the accepted cost and it is bounded by the same thing that bounds everything else
here: work resuming. Measured against the failure it replaces — thirteen consecutive dead runs across
two days, two PRDs silently unsliced, and nothing anywhere saying so — the bound is one session.

The sweep sees one page of runs and spends at most sixty job-count reads inside it. Both bounds are
logged when they bite, because a cap nobody is told about reads as "there was nothing else", which is
the failure this mechanism exists for rebuilt inside the mechanism itself.
