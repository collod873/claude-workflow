# Implementer concurrency is keyed per ticket, because a fixed group cancels queued waves

Recorded 2026-08-29.

Amends: nothing. It restores
[ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md), which an
undocumented change to `implement.yml` had quietly overruled — see "What went wrong" below.

Lane 05's concurrency group is `implement-${{ github.event.client_payload.issue }}`, not `implement`.
A wave runs as wide as lane 03 cut it. Lane 08 keeps its single fixed `integrate` group, because
there is one trunk to merge onto and that is a different fact.

## Why a fixed group was wrong here

Two reasons, and the second is the one that cost work.

**It contradicted a landed ruling.**
[ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md) already decided
this: *"Implementer concurrency is whatever lane 03 cut as ready disjoint slices, absorbed by lane
08's single serialised merge."* It deleted the governor precisely so that no dial would sit between
the graph's width and the number of implementers. A fixed group is that dial, set to one, added
without amending the ADR that forbade it.

**It cancelled work, which is the opposite of what it was introduced to do.** GitHub Actions holds
**at most one pending run per concurrency group**, and a newly queued run cancels whatever was
already pending. `cancel-in-progress: false` governs the *executing* run and nothing else. A group
of N therefore admits one running plus one waiting, and silently discards the rest.

On 2026-08-30 lane 09 recomputed and reported `dispatched ticket-ready for #242, #241, #240`. #242
ran (33284271370), #240 waited (33284271618), and **#241 was cancelled before it started**
(33284271425). The dispatch log's claim of three was false for one of them, and nothing counted the
loss.

That is the failure the fixed group's own comment named as the thing it existed to prevent — *"a
cancelled run is a slice that silently never gets built"* — caused by the mechanism written to
prevent it, on a belief about `cancel-in-progress` that is not what the platform does.

## Why parallel is safe, which is what made the group unnecessary

The fixed group was defended by a real worry: parallel implementers build on a trunk that lane 08 is
serially moving under them, so two slices of one wave editing neighbouring files meet as a rebase
conflict in a lane that [#234](https://github.com/collod873/claude-workflow/issues/234) says nothing
reacts to.

The premise does not hold, because lane 03 has already resolved it. The chain-shape ladder
(`to-tickets/references/chain-shape.md`) applies to *every pair of slices that touch the same file*:
rung 2 repartitions them onto disjoint file sets, rung 3 extracts the shared foundation as a
prerequisite, and rung 4 adds a `dependsOn` edge for whatever overlap survives. An edge is exactly
what stops two slices being ready at once. **Two slices that are simultaneously ready therefore
claim disjoint files by construction** — that is the ladder's whole output, and ADR-0039's "ready
disjoint slices" is naming it.

So serialising lane 05 bought nothing the ladder had not already bought, and charged a merge cycle
per slice for it. If ready siblings ever do conflict, the defect is in lane 03's slicing, and it
should be fixed there rather than hidden behind a queue that makes it un-observable.

## Considered options

- **Keep the fixed group, dispatch one at a time from lane 09** — rejected. It would have made the
  serialisation honest (nothing queues, so nothing is cancelled) and preserved the fresh-trunk
  property. But it keeps ADR-0039 overruled, moves a scheduling decision into the reconciler where
  ADR-0084 wants only recomputation, and buys protection against a conflict the ladder already
  prevents.
- **Keep the fixed group and count the cancellations** — rejected. A counter on a self-inflicted
  loss measures the mechanism, not the estate. The lane still runs at one-fifth width.
- **Key on the ticket** — chosen. It is what ADR-0039 says, and it is the shape the sandcastle repo
  ran under load: per-entity groups (`agent-implement-issue-<N>`), never a global one, with
  parallelism bounded by the dependency graph and serialisation reserved for the merge.

## Consequences

**The serialised merge is now the throughput ceiling, alone.** ADR-0039 already said it would be and
called it load-bearing. It now actually is: a five-wide wave produces five pull requests that lane
08 merges one at a time. If that shows up as PR wait time, that is countable, and it is the trigger
to revisit — at lane 08, not at dispatch.

**A wave costs what a wave costs.** Five ready slices are five concurrent bills rather than five
sequential ones. [ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)
and [ADR-0024](0024-there-is-no-daily-spend-ceiling-and-the-governor-stops-on-qu.md) both rule that
spend is not a dial in this design; this does not reopen that.

**[#234](https://github.com/collod873/claude-workflow/issues/234) gets more load-bearing, not more
likely.** Nothing here raises the conflict rate — the ladder governs that — but a wide wave means
more merges per unit time, so a lane 08 that dies on conflict with nothing reacting stalls more
work when it does happen.

**`implement.yml`'s group is now pinned by a test.** It was the only lane whose concurrency block
nothing read; `integrate.yml`'s single fixed group and `dispatch-reconcile.yml`'s have had tests
since they were written, which is why neither drifted. `implement.test.ts` now asserts the key
carries `client_payload.issue`, so a future fixed group fails locally rather than in a lost wave.

**The platform fact is worth stating once, here, because it is not what the option name suggests:**
`cancel-in-progress: false` does not mean "never cancel". It means "do not cancel the run that is
executing". Any group that more than one entity can enter will drop queued entrants. That is why
`integrate`'s fixed group is still correct — every run in it is trying to do the same single thing
to the same trunk, so a dropped queued run is re-derived by the next recompute — and why lane 05's
was not.
