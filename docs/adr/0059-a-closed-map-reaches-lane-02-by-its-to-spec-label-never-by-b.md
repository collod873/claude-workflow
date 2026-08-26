# A closed map reaches lane 02 by its to-spec label, never by being closed

Recorded 2026-08-26.

`DESIGN.md` §02 fired the cloud spec author on *"closing the map **or** applying a `to-spec` label."*
Only the label survives, and it fires only on a map carrying `wayfinder:dest-spec`. The `to-spec`
label is created with the lane; **it does not exist on this repo today**, which is why the trigger
half of §02 has never been more than a sentence.

## Why closing cannot be the trigger

**Roughly half of all maps close with no spec intended.** A wayfinder map carries a destination
label, and `wayfinder:dest-decision` means the effort ends on the decision itself — `/wayfinder`'s
terminal for it is *"post the closing report, close the map. Done."* Firing on the close specs every
one of them.

**A map can also close without arriving.** The ticket budget is a hard cap, and the human may end a
map on what exists. `/wayfinder` is explicit about what must not then happen: *"a handoff reader
takes one index and reads it as complete… Handing it on presents a truncated map as a finished one."*
A close-fired trigger does exactly that, automatically, with nobody in the loop to notice.

So closing is not a decision — it is what happens at the end of every map, wanted or not. The label
is the decision, and it is one gesture in the same place the human already is.

## Considered options

- **Close plus the destination label**, i.e. fire on close only where `wayfinder:dest-spec` is
  present. Rejected on the budget case alone: a capped map carries `dest-spec` and is still not
  finished, and no label distinguishes *reached* from *ran out*.
- **`/wayfinder` fires it directly.** Not available, and it says so: *"It cannot fire `/to-spec` —
  user-invoked skills are unreachable from an agent session — and does not try."*
- **The `to-spec` label, applied by hand.** Chosen. `/wayfinder`'s `dest-spec` terminal already
  prints one line telling the human to run `/to-spec` against the map; the label is that line made
  into an event.

## Consequences

**A human applies it, which is what makes it fire at all.** An event caused by the built-in
`GITHUB_TOKEN` starts no workflow run
([ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)) — so a label
applied by a job would be inert. This trigger works precisely because the actor is a person, and that
is a property to keep in view rather than a coincidence.

**`/wayfinder`'s terminal gains a second line.** The `dest-spec` row currently prints *run `/to-spec`
against this map*; it now also names the label, which is the trigger a human away from a terminal can
reach.
