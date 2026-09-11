---
status: constraint
date: 2026-09-10
reversal: Dropping the tail job puts an Acceptance cap death back on a `workflow_run` door GitHub never opens for a bot-started run; dropping the strike lets a death the reconciler now hears start the author again without bound, one Opus call per half hour.
---

# An Acceptance death is a strike on the ticket's one ladder, so waking on it is bounded by the same decision

ADR-0177 has a lane the machine started ring `run-ended` on its way out. Acceptance was left
out of #445 because nothing bounded its re-fire: the reconciler sends `acceptance-wanted` for any
ready ticket with no test, a cap death leaves nothing on the ticket, and a dead `Acceptance #n`
run was not a strike. Heard, it would have restarted the author at once, forever (#457).

So the author rings from a `contents: write` tail job, since its model jobs hold `contents: read`
(ADR-0091), and a dead Acceptance run is a strike on the ladder every other death climbs. Three
deaths of any lane end in the one decision. Short of it, a ticket with no test goes to the author
again; the strike bounds, it does not route.

**Rejected: `needs-human` on the second dead Acceptance run.** A second counter beside the
ladder, read nowhere else, with a reset of its own.
