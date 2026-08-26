# The shape of the machine is an owner point: agents do not judge whether a mechanism should exist

Recorded 2026-08-26.

Agents are reliable at building a mechanism and unreliable at asking whether it should exist, because
the thing under review is their own work. So which mechanisms exist, where agents sit, and where a
check goes are the owner's call — a third owner point in `GOAL.md` §2, alongside visual verdicts and
destination.

## Considered options

- **Covered by destination and scope** — rejected. Scope is how much of a thing to build; shape is
  whether the thing is a mechanism at all. The governor cleared every scope question it was ever
  asked and still should not have existed.
- **Covered by W2** (*the thing that checks is never the thing that built*) — rejected as sufficient,
  accepted as the reason. W2 is stated about code and is enforced at the code level. Nothing pointed
  it at the design, which is how a mechanism gets proposed, built, and reviewed by the same fleet.
  This ADR is W2 aimed one level up.
- **A skeptic agent instead of the owner** — rejected on the measurement below. An adversarial
  reviewer is still an agent scoring an agent's design; the five kills came from the one participant
  who does not gain by the mechanism existing.

## Why the record supports it

The governor survived five days of agent review and died to a single owner question
([ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)). Across the same
window twenty owner touches were rubber-stamps and five were engagements, and **all five killed a
mechanism.** No agent-originated review has killed one.

That is the bar `CONTEXT.md` sets for an owner point — a judgement agents have been measured getting
wrong, not one that merely feels like a human's. Shape clears it more cleanly than either entry
already on the list.

## Consequences

- **`DESIGN.md` §0's five ⬤ owner rows stay five.** Those count where the owner is required inside
  the pipeline, per work item. This one fires per *proposed mechanism*, at the scoring rule in §0 —
  outside every lane, and rare. The two counts measure different things and neither moves the other.
- **It is answered at intake, not at review**, so it costs no new venue. C1's test already demands
  model stages and owner minutes as numbers, and `GOAL.md` §2 already refuses a proposal with an
  unanswered test. Shape is the question those answers are *for*.
- **This does not amend [ADR-0006](0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md).**
  Agents still draft ADRs and vocabulary and the owner still signs. What changes is that a proposed
  *mechanism* is not carried by the signature — an agent may draft the argument for one, and the
  ruling on whether it exists is the owner's.
