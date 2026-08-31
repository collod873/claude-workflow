# A standing report speaks only on evidence it has not already cited, and retires only on evidence its subject recovered

Recorded 2026-08-31.

Amends: ADR-0099

[ADR-0099](0099-a-recomputing-counter-closes-its-standing-issue-when-its-cou.md) gave a recomputing
counter an end. It said nothing about what the counter may say **in between**, and nothing about
what "the set is empty" is allowed to mean when the set is a window rather than a query. Both gaps
had teeth in the run watchdog, so both are ruled here.

**Speaking.** A mechanism that collapses many occurrences into one standing issue may comment on
that issue only with evidence the issue does not already cite. Recomputed from the issue's own body
and comments, as ADR-0099's zero is recomputed from the tracker — no cursor, no ledger.

**Retiring.** A standing report retires on evidence that its subject **recovered**, never on the
absence of evidence that it failed. A window that has gone quiet is not a window that has gone
green, and a sweep that did not read its whole window may not say either.

## Why the first gap had teeth

[#252](https://github.com/collod873/claude-workflow/issues/252) carried two `Still dead` comments
fifteen minutes apart, citing the same run — 33278011242 — verbatim. Nothing had changed between the
sweeps. `run-watchdog.ts`'s standing path took `lane.runs[0]` and commented on every sweep whether
or not that run was new; the word `also` in its message asserted a novelty the code never checked.

That defeats the reason the standing path exists. Its own comment says *"Thirteen dead runs are one
dead lane. A second issue per run would be this ticket's failure with the sign flipped — a signal
nobody reads because there is too much of it."* Collapsing thirteen runs into one issue and then
commenting on it every sweep reaches the same destination one step later: a reader who sees the same
`Still dead` twice learns the comment carries no information.

It is worse than a slow leak, because the sweep rides session end
([ADR-0049](0049-the-run-watchdog-sweeps-on-session-end-because-workflow-run.md)). The re-post rate
is the owner's session rate, so the mechanism gets louder exactly as he works harder. And it
mis-states the record: two re-assertions of one startup failure made a standing defect out of what
`CONTEXT.md` defines as an incident.

The other two counters already behaved this way — `lost-dispatch-counter.ts`'s `alreadyNamed`,
`unreachable.ts`'s. The watchdog was the outlier, and the rule is now written down rather than
re-derived per mechanism.

## Why the second gap needed a different answer from ADR-0099's

ADR-0099's counters answer a **query**: nothing in the tracker is unreachable, computed over the
tracker entire. Zero findings is therefore the assertion the standing issue would have to keep
making, and closing on it is sound.

The watchdog answers over a **window** — seven days of runs, one page, at most `MAX_JOB_READS` job
counts. Zero dead runs in that window has two causes and they are not the same fact:

1. The lane runs and executes jobs again. It recovered.
2. Nobody triggered the lane for a week. Its dead runs aged out. It is exactly as unable to start as
   it was, and the first person to push will find out.

Closing on (2) writes an all-clear nothing checked, which is the failure the whole mechanism exists
to catch, rebuilt inside the thing that catches it. So the watchdog requires a run of that same
workflow file, inside the window, that executed something. A run that executed nothing cannot
conclude anything but `failure` — all 25 in this repo's history did — so any completed run of the
lane that is not itself dead is that evidence, and the retirement comment cites it rather than
asserting recovery in the abstract.

A sweep that clipped its window retires nothing at all. A dead run sitting unread behind the job-read
cap would otherwise read as recovery, and the cap exists precisely because a repo mid-incident
produces more failures than one sweep will pay to examine.

## Considered options

**Retire on absence.** Simpler, and it is what ADR-0099 literally says. Rejected: it converts a lane
nobody has run into a lane that works, and the difference is the entire subject of the issue being
closed.

**Leave retirement to a human.** The status quo, and #252 is the argument against it: it sat open for
two days after its lane had recovered, and a human closed it. ADR-0011's rule is that a refusal ships
only once something can clear it; a report only a human can clear is the park with an issue number
attached.

**Guard the comment with a stored cursor.** Rejected for the reason ADR-0099 gives and this
mechanism's own header repeats: what it already said is durable and readable, and a cursor is one
more thing that can go stale against it.

## Consequences

**The zero path now reads the tracker.** Previously the watchdog returned before its `gh issue list`
when no lane was dead — the exact shape ADR-0099 rules against, where the one state in which a
report has nothing left to stand for is the one state nobody looks at it in. One list per sweep.

**A quiet lane keeps its issue open, and says so in the log.** That is a deliberate false-positive:
a standing signal about a lane that has genuinely been deleted will not retire itself. Closing it by
hand is one action; the mechanism does not re-open it, because a deleted lane produces no runs to
find.

**Silence is now an outcome.** A sweep that finds a dead lane its standing issue already covers
writes nothing and logs `silent on #N`. C3 asks that of a mechanism with nothing to report.
