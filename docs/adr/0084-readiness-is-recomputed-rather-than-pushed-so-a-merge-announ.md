# Readiness is recomputed rather than pushed, so a merge announces without interpreting and an unsatisfiable edge is a counter finding rather than a park

Recorded 2026-08-28.

**The ready set is recomputed, never pushed.** A lane 09 reconciler owns it, derives it from durable
state alone on `session-captured` and on lane 08's `graph-changed` doorbell, and dispatches
`ticket-ready` for every published slice in it that has not been started. Publish-time dispatch calls
the same predicate rather than implementing a second one.

## The bug was a folded constant, not a missing sender

`dispatchReadySlices` filtered on `dependsOn.length === 0`, and its own header said why that was
enough: *"At publish time every edge is unresolved by construction."* That is correct, and it is a
constant folded into a predicate. The real predicate is **every blocker delivered**; it merely
*equals* "zero declared edges" at t=0. Folded, it could only be answered once — so nothing sent the
second wave, and a 26-slice plan started however many roots it had and stopped.

[#178](https://github.com/collod873/claude-workflow/issues/178) read this as a missing sender and
named four things needing decisions first. Three of them stop existing once readiness is recomputed
rather than pushed. **Partial unblocking is not a case**: a recomputed set has no memory of which
blocker closed, so a slice with one merged and one open blocker is simply not in it, and a slice
whose second blocker just merged simply is. Firing twice or not at all, depending on arrival order,
is only reachable by a design that decrements a counter or handles an event.

## A merge announces itself without interpreting itself

#178 named the [ADR-0069](0069-the-dependency-graph-is-lane-03-s-output-and-read-only-downs.md)
problem correctly — lane 08 asking the dependencies API is a second lane reasoning about the graph —
and accepted it as the price of putting the sender at the merge. **It is not a price that has to be
paid.** Lane 08 sends a doorbell: the pull request, no tracker read, no graph read, no reasoning. The
reader is a reconciler that writes nothing to the graph.

So ADR-0069 is **applied, not amended**, and this ADR rules something narrower and more durable than
#178 asked for: *a reader of the graph at merge time is a reconciler, and a merge is entitled to
announce itself without interpreting itself.*

## An edge is satisfied by delivery, not by closure

> An edge is satisfied when its blocker **closed having delivered** — closed as completed with a
> merged pull request. Open, closed `not planned`, and closed with nothing merged all leave the edge
> unsatisfied.

The prior art in the sandcastle repo counts *open* blockers and skips promotion when the closing
issue carries `state_reason == not_planned`. That produces a timing asymmetry with no defensible
reading: a blocker closed `not planned` **before** fan-out does not block at all, because it is not
open, while the identical close landing **after** fan-out refuses to unblock. Same fact, opposite
behaviour, decided by when it happened. One predicate, evaluated the same way at publish time and at
reconcile time, removes it.

**The accepted cost, stated because it is live today.** Every slice this repo has closed so far was
worked by hand and closed with no pull request, so this rule reads those closes as undelivered. That
is correct under the design it is built for — lanes 05 and 08 have produced no run but `skipped`, and
the intended workflow is spec → to-tickets → the fleet building every ticket with nobody in the loop.
A hand-delivered slice is not a case this optimises for, and the one bounded touch it costs is the
counter below rather than a stall.

## An unsatisfiable edge is a refusal, not a park

Sandcastle's dependents sit in `agent:queued` forever when a blocker is closed `not planned`, and its
own ADR admits there is no sweeper. That is precisely the shape
[ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md) forbids: *"parked work is a queue
that drains onto the owner — the one outcome the whole design is built to avoid."*

A blocker closed without delivering does not make its dependents *late*. It makes them
**unreachable**, and that is knowable when it happens rather than inferable never — the reconciler's
walk already computes it, from the other end. Reported as one standing counter finding in
[ADR-0064](0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md)'s shape:
**event** — a slice became unreachable; **count** — how many per run; **action** — re-slice, re-open
the blocker, or cut the edge. Not *n* silently parked tickets.

## Why a second dispatch is permitted here when ADR-0049 refused one

[ADR-0049](0049-the-run-watchdog-sweeps-on-session-end-because-workflow-run.md) declined to add a
dispatch and reused the capture hook's, *"because a second dispatch is a second thing that can
silently stop arriving (#107 is what that looks like)."* That objection stands and does not bite
here.

ADR-0049's dispatch would have been **load-bearing** — lose it and the sweep never happens.
`graph-changed` is a **hint**: lose it and the session-end reconcile still finds the same ready set,
so the cost is latency, not correctness. A mechanism that degrades from minutes to one session is a
different object from one that degrades to nothing. The honest cost of dropping the hint entirely is
depth — a chain of depth *n* needs *n* wake-ups — and that is the only thing it buys.

Session end is [ADR-0004](0004-a-clock-may-release-a-batch-but-may-never-originate-work.md) applied
rather than excepted: a slice can only become ready if a merge happened, and merges only happen
during work. And ADR-0049's real criterion — *whether the evidence a mechanism reads outlives the
failure* — is met here more completely than for the close gate, whose reconciler must reconstruct a
verdict that was never recorded. The dependency graph, every blocker's close state and every slice's
branch are durable API objects. **There is nothing to replay and nothing to reconstruct.**

## At-least-once dispatch, and no lock

Sandcastle needs a global non-cancelling concurrency group over its whole promotion workflow, plus a
pre-mutation recheck, plus a consumed label — three mechanisms and a global serialisation point — to
buy exactly-once delivery. None of it is needed here. `implement/issue-<n>` is deterministic per
issue and git ref creation is atomic, so **the ref is the claim: an implementer's first act is to
create its branch ref, and one that finds the ref already there exits without working.**

The claim had to move to the front to be one. `commitAndPushBranch` pushed at the *end*, after the
model had already run, so two implementers both did the work and only the push collided; and a push
may fast-forward where `POST git/refs` returns 422. With the claim first, a duplicate `ticket-ready`
is free, so the reconciler may be dumb and aggressive — and no second global choke point is stacked
on the serialised merge that
[ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md) makes the throughput
ceiling deliberately.

**The branch is also the started-ness trace.** No new label and no new state: "does this slice have a
ref?" is a read lane 08 already makes, so the reconciler's `¬started` term costs nothing to add and
nothing to keep in sync.

## Considered options

- **Lane 08 promotes, as #178 proposes and the prior art does.** Rejected: it needs an ADR-0069
  amendment to buy nothing the doorbell does not buy, and it is edge-triggered, so it inherits every
  permanent-park failure above.
- **A pull model** — implementers poll for the next ready slice. Genuinely dissolves the problem, and
  rejected as a clock originating work under ADR-0004 with no long-lived process to hold a pool.
- **Store readiness as a counter and decrement it on each blocker close.** Rejected: durable state
  that can drift from the graph it mirrors, where recomputation is correct under every event order
  for less code.
- **Topological waves precomputed at publish.** Rejected: a schedule that assumes nothing fails, and
  one `blocked` pull request invalidates the rest with nothing noticing.
- **A cron.** Rejected on [ADR-0048](0048-the-close-gate-s-reconciler-rides-session-end-because-a-cron.md)'s
  evidence unchanged: GitHub throttles scheduled runs under the same load being reconciled against.

## Consequences

**Being in the graph makes a slice ready; being published by lane 03 makes it dispatchable.** The
reconciler reads every open issue, so transitive unreachability is computed across the whole graph,
but it only ever dispatches an issue whose body carries the `## Parent PRD` heading
`shared/render-body.ts` writes. Without that scope rule, every unblocked issue on the tracker would
get a Sonnet implementer pointed at it and a pull request opened.

**A blocker this reconciler cannot see leaves its dependents blocked, never unreachable.** An issue
past the page boundary is not evidence of anything, and a finding filed about a graph it could not
read is a finding the reader cannot act on.

**The acceptance criterion for readiness is a property, not two transitions.** #178's two transition
tests both pass against a design that is wrong under reordering, because both fix the order. What is
asserted instead is order-independent and subsumes them: for every permutation of a merge/close
sequence, the dispatched set equals the set derivable from final state alone.
