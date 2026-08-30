# A non-zero open-question count no longer waits on the owner

Recorded 2026-08-30.

Amends: ADR-0100, ADR-0061

ADR-0062 built lane 02's gate on one description of what a non-zero count does: *"A non-zero count
is the only thing that reaches the owner. His answer re-runs the chain, which recomputes the
count."* The same assumption is why it left the answering rounds uncapped — *"the machine asked and
the owner is answering, and a cap would park a spec he is actively working on."* Both sentences rest
on the same premise: that the owner is the one on the other end. **That assumption has expired.**
Nothing in this lane waits on him to answer any more, so a non-zero count no longer reaches him —
capping the rounds would no longer risk parking his work, because none of the rounds are his to
work.

## ADR-0100 is amended because its input changes

ADR-0100's reconciler was built to fold "what the owner answered" into the spec body — the warm
door's critic settles rounds against his comments, and the rewrite stage reads the body *plus his
answering comments* so the count it recomputes is taken against text he actually saw. How the
reconciler folds an answer in does not change here. What changes is where an answer is allowed to
come from: a round can settle without ever reaching him, so `answeringComments` is no longer, by
definition, a transcript of his replies. The guard ADR-0100 built — *empty means no round was ever
answered, so nothing runs* — still holds; it simply no longer implies that a non-empty one is a
transcript of him.

## ADR-0061 is amended because its arithmetic loses its gate

ADR-0061 made every unsettled thing lane 02 hits a numbered open question, including the sheet's own
completeness check: *the sheet's decisions carrying a mark and no `adrTitle`, minus the open
questions naming a mark, is zero.* That arithmetic keeps its input — the same subtraction, spent with
the same absence of judgement ADR-0014 requires — and loses its gate: it no longer holds a spec back
until the difference reaches zero **by way of the owner resolving it**. A mark with nowhere written
down still becomes a numbered open question, because the sheet still knows more than any downstream
artifact does; what it no longer does is wait on a reader who is not coming. It is counted now, the
way a [Counter](docs/adr/0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md) is
counted, rather than refused, the way a Gate is refused — CONTEXT.md's own distinction between the
two. ADR-0061's own Consequences called the count "load-bearing twice — it is what the owner
answers, and it is what dispatches the slicer." It is load-bearing once now.

## Why ADR-0100 and ADR-0061 carry the trailer, and ADR-0062 does not

The expired sentence is ADR-0062's own, but ADR-0062 is not this ADR's target. It already carries
`Status: superseded by ADR-0085`, and ADR-0085 itself carries `Status: superseded by ADR-0100` — a
reader who lands on ADR-0062 today is already redirected twice before reaching anything current.
Landing a third trailer on a record two supersessions deep spends a back-stamp nobody following the
chain will ever read; the whole point of [ADR-0045](0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md)
is that the pointer earns its keep at the page a reader actually stops on. ADR-0100 is that page for
the runner path, and ADR-0061 never left the chain — it was never superseded, and its own prose still
asserts the premise this ADR retires. Both amendments land where the assumption still lives; none
lands where it used to live.

## Considered options

- **Amend ADR-0062 directly, since the sentence quoted above is its own.** Rejected on the argument
  above — a trailer on a twice-superseded record repairs nothing a reader will see, and the same
  mistake is the one this ticket exists to correct rather than repeat.
- **Leave CONTEXT.md's glossary entry alone as harmless colour.** Rejected. The glossary is what a
  later reader checks a term against, and an entry asserting a channel that no longer exists is the
  same failure in prose that an unreachable export is in code.

## Consequences

**ADR-0061's "load-bearing twice" reads as "load-bearing once."** The count still dispatches the
slicer; it no longer doubles as the thing the owner answers, because nothing in the mechanism ever
made him its required reader.

**Nothing about who may answer changes.** The critic and the reconciler still read whatever
answering text exists when they run (ADR-0085, ADR-0100). This ADR does not forbid the owner from
commenting on a spec — it stops describing his comment as required or summoned.

**CONTEXT.md's Open question entry is corrected in this change**, since a non-zero count is no
longer described as reaching him at all.
