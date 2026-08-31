# A fixer that stops making no progress files spec/gap rather than only calling the owner

Recorded 2026-08-31.

The fixer's two stops route to two places. A `capped` stop — three attempts, each moving the
failure, none landing green — is ordinary difficulty and reaches the owner as `needs-human`, as it
always has. A `no-progress` stop — two consecutive attempts leaving the identical tests failing with
the identical messages — is additionally filed as `spec/gap` at the ticket's parent PRD, because a
test that does not move under two independent attempts is a defect in the contract rather than in
the diff.

## Why

Lane 04 and lane 05 never see each other, so every ambiguity in a ticket becomes a divergence paid
for at lane 06. What makes it expensive is that the divergence has no presentation of its own: a red
acceptance test means *the implementation does not satisfy the test*, whichever side is wrong, so the
repair loop re-fires the implementer against a reading it was never given and cannot converge (#278,
worked through on #272).

`spec/gap` is the route for exactly this — ADR-0034 gave it a reader in lane 02's spec author and
ruled that where a test and the spec disagree and neither is obviously wrong, **the spec wins by
construction**, because the test was authored from the spec and nothing else and neither side is the
implementer's to settle. Until now it had one writer, lane 07's conformance reviewer (ADR-0038), and
lane 07 fires on CI green. Nothing in lanes 04–06 — where the disagreement actually happens, and
where the run is red by definition — could reach it.

## The discriminator already existed

This ruling adds no detector. `runFixer` has compared each attempt's `FailureSignature` against the
previous one since it was written, and stops when they match, on the argument that "nothing changed,
so nothing further will." That comparison is the discriminator #278 says the pipeline does not have:

- An **ambiguity** produces an immovable signature. The test asks for something no permitted diff
  contains, so every attempt fails identically no matter what it writes.
- A **hard bug** produces a moving one. Attempts fail differently as the model works the problem,
  and the loop hits its cap instead.

The signal was being computed and then spent on a label. What changes here is only where it is sent.

## Considered options

- **File `spec/gap` on every stop, capped included.** Rejected. A capped stop is three attempts that
  each changed the failure, which is evidence the diff is in play and the contract is not. It would
  make the label mean "the fixer gave up" and the spec author would be amending specs that are fine.
- **Narrow the route further — file only when the immovable failure names something the ticket never
  fixed.** Tempting, and `pathTokens` from ADR-0118 makes it buildable. Rejected for now on evidence:
  this repo has produced no `spec/gap` at all, and a second filter tuned against zero observations is
  ADR-0064's bar failed on its own measurement. The immobility test is already narrow, and the price
  of it being too wide is bounded (below).
- **Leave it at `needs-human` and let the owner route it.** Rejected — that is the status quo #278
  is about, and it spends the most expensive reviewer in the system on a classification a comparison
  already made.

## Consequences

**A false `spec/gap` costs one Opus run and then self-corrects.** ADR-0034 prices the label honestly:
a spec-author run plus an acceptance re-fire per affected slice. ADR-0079 gives that author a
refusal — a gap repairable only by scope the spec does not carry is refused, and an ordinary idea is
filed instead — so a mistaken filing terminates at the owner rather than looping. That bound is what
makes firing on the wider signal affordable.

**The ticket still gets `needs-human` on both stops.** A `spec/gap` in flight is a repair, not a
delivery, and it may refuse. Dropping the label on the strength of it would leave a stalled ticket in
nobody's list, which is the failure `shared/needs-human.ts` was written after.

**`spec/gap` has two writers now, so the filing moved to `shared/spec-gap.ts`.** One filer keeps the
label, its creation, and the routing identical whichever lane noticed. Two copies of an escalation is
how `blocked` came to be applied by two lanes to a label that had never existed at all.

**A hand-written ticket has no route.** A ticket entering at lane 06 with no `## Parent PRD` (#184)
has no spec to amend, so its no-progress stop is the owner's, unrouted — the same answer as before.
