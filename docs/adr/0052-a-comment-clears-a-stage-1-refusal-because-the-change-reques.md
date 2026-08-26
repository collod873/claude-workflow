# A comment clears a stage-1 refusal, because the change-request verb already exists

Recorded 2026-08-26.

Lane 01's stage-1 refusal fires only on an idea's **first** run. A comment on a refused idea re-runs
the chain with the refusal suppressed, and the same two-round cap that bounds a change request
bounds this.

Extends [ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md), which requires that
nothing be promoted to refusing until the thing that clears its red already exists.

`DESIGN.md` §01 states the refusal — *an idea that already exists or that an ADR has already ruled
on* — and names nothing that clears it. That is the defect ADR-0011 rules against, arriving in a new
place: an idea the sweep misjudges is parked, and parked work is a queue that drains onto the owner.
Re-applying `idea` cannot clear it, because the same sweep on the same evidence refuses again.

## Considered options

- **A `force-shape` label the owner applies.** Rejected. It is a fifth verb on a lane whose whole
  argument is that the owner's interaction is two minutes and four labels, and it would exist to be
  used a handful of times a year — C4's shape exactly, a mechanism needing an active ritual nobody
  remembers by month three.
- **Let the owner close the issue and re-file it.** Rejected: it destroys the idea's verbatim body,
  which §00 exists to preserve, and hands the sweep a fresh issue with the same words to refuse
  again.
- **Make the refusal advisory — comment and shape anyway.** Rejected. Then it is not a refusal, and
  the chain spends the shaper on every duplicate. §01 funds the refusal precisely so it *never
  spends the shaper*.
- **The comment clears it.** Chosen. §01 already has a comment verb — a change request that re-runs
  the shaper — and *this idea is not the same as #42* is a change request. No new verb, no new
  label, and the owner's disagreement is on the record beside the evidence he disagreed with.

## Consequences

**The clearing act is the same one the owner would perform anyway.** He reads a refusal citing #42,
he thinks it is wrong, and the thing he does about it is say so — which is now the mechanism rather
than a message to nobody.

**It spends from the same budget.** A refused idea has used one of its three runs, so an owner who
clears a refusal gets two sheets rather than three. That is right: the sweep pass was real work, and
uncapping it because the first outcome was a refusal is how a cap stops meaning anything.

**The refusal is counted as a round**, which is what makes the sentence above true, and is why
`marker.ts` gives a refusal a trailer of its own despite it carrying no payload.

**The suppression is total from round 1, not evidence-specific.** A second, genuinely different
duplicate found on the re-run does not refuse. That is deliberate — matching the owner's objection
against the sweep's new evidence is a judgement, and putting one there would recreate the thing
[ADR-0014](0014-a-model-may-translate-evidence-into-a-gate-s-grammar-but-nev.md) removes. The prior
art still reaches the sheet, where he reads it.
