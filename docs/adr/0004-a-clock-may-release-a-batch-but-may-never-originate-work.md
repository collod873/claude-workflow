# A clock may release a batch, but may never originate work

Recorded 2026-08-23.

No mechanism fires because time passed. A timer is permitted in exactly one role: releasing a batch
that events have already filled — and a timer that fires against an empty batch must produce
nothing, cost nothing, and say nothing. Every recurring reader in the design is therefore attached
to the event that makes it non-vacuous rather than to a cadence.

## Why this came up

[`DESIGN.md`](../../DESIGN.md) is derived from The Owner's Foundry, which runs six cadences: a
nightly product walkthrough, a daily spec-drift check, three weekly audits, an hourly cost governor,
and a morning brief. Its §06 argues the position outright — *"Cron is for audits that nobody would
think to ask for."*

`GOAL.md`'s C3 says the opposite, sourced from the owner: *"i dont want a time based cadence, that
doesnt make sense because i might ship a lot of work at once then be away for a week."* And
agent-skills ADR-0029 had already rejected periodic triggers once, on its own reasoning: *"still
work the maintainer did not ask for, only less often."*

Two documents written a day apart, disagreeing in public. This settles it.

## The distinction that resolves it

C3's complaint is not about time. It is about **work arriving at a rate uncorrelated with the work
being done** — which is precisely the ship-a-lot-then-vanish-for-a-week case, where a weekly audit
fires four times against a repository nobody touched, and the one week that generated real evidence
gets the same single read as the four silent ones.

So the test is not "does a clock appear anywhere." It is:

> **Can this fire when nothing has happened since it last fired?** If yes, it is a cadence and it is
> forbidden. If firing against no new evidence is structurally impossible, the timer is only
> deciding *when* a result is delivered, and that is scheduling, not origination.

The morning brief passes: its contents are decisions that events queued, and an empty queue means it
does not publish or push. C7 requires batching, and batching requires a delivery moment — the timer
is that moment and nothing more.

## Consequences

Each of the Foundry's cadences was re-attached, and in every case the event is a better trigger than
the clock it replaced — it fires when there is something to read, and it carries the thing to read
with it:

| Was | Now fires on |
|---|---|
| Spec-drift, daily | A merge touching a module |
| Decision-consistency, weekly | An ADR or ruling being recorded |
| Architecture/coupling, weekly | The Nth landing in a module since its last read |
| Transcript audit, weekly | Session end |
| Cost governor, hourly | Dispatch — checked before spend, not after |
| Product walkthrough, nightly | A preview deploy (and cut for now: no repo has a deployed product) |

The Nth-landing trigger is agent-skills ADR-0029's own candidate — *a shape appearing at a second
site* — generalised to a counter, which is what makes it cheap enough to attach to every module.

This also removes a class of grooming C4 would otherwise have caught later: a cadence has to be
tuned as the workload changes, and nobody ever tunes it down.
