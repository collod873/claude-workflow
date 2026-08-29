# The close gate's reconciler rides session end, because a cron is throttled by the same outage it exists to survive

Recorded 2026-08-26.

Status: superseded by ADR-0088

The reconciler that finds closes the gate never judged fires on the `session-captured` dispatch, not
on a schedule. A session that ended is work that happened, and closes only arrive during work, so it
cannot fire against nothing — which is what
[ADR-0004](0004-a-clock-may-release-a-batch-but-may-never-originate-work.md) forbids. Upholds that
ruling rather than amending it.

## Why this came up

[#106](https://github.com/collod873/claude-workflow/issues/106) proposed a daily cron, and argued
the schedule was earned: the reconciler exists precisely because Actions can stop running workflows,
so attaching it to an Actions event looked like attaching it to the thing that fails.

## Considered options

**A daily cron.** What the ticket asked for. It needs an exception to ADR-0004 — a daily sweep can
fire against a week where nobody closed anything — and the case for the exception did not survive the
evidence. GitHub's scheduled runs are dispatched by Actions and are throttled and dropped under
exactly the load being reconciled against; a cron would have been late in the window it was there to
cover. Its one genuine advantage: it still fires if the owner closes an issue and never opens
another session.

**Session end.** The trigger the observations pipeline already uses. It cannot fire vacuously, needs
no exception, and its failure mode is benign — a dispatch lost to the outage is replaced by the next
session's, and a session that never comes means no work is happening for an unjudged close to block.

## What the evidence actually showed

The 2026-08-26 outage was read wrong when #106 was written, and the reconciler's own dry run
corrected it. Events were **throttled, not dropped**: [#103](https://github.com/collod873/claude-workflow/issues/103)'s
gate run was created 19 minutes after its close and passed, and
[#101](https://github.com/collod873/claude-workflow/issues/101)'s arrived after 7m42s.
[#85](https://github.com/collod873/claude-workflow/issues/85)'s run was created in 219 seconds and
then sat queued for hours. Nothing that day was lost.

That is the case for a reconciler that **waits** rather than one that hurries: every mechanism here
must distinguish a verdict that is late from a verdict that will never come, and reopening under a
queued run would have fought a gate that was still working. It is also the case against the cron, on
the cron's own terms — the failure it was sized for did not happen, and the delivery it depends on
was degraded throughout.

## Consequences

A close that lands with the tracker's last session already ended waits for the next session to be
reconciled. That is the accepted cost, and it is bounded by the same thing that bounds everything
else here: work resuming.
