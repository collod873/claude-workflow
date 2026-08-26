# A probation held to an event that may never happen becomes a count

Recorded 2026-08-26.

Lane 01's refuter is retired on a count, not on a convening. At the **20th sheet posted with zero
surviving refutations**, the counter files an issue proposing the refuter's deletion.

`DESIGN.md` §01 held the refuter to §6's backwards question "at the event that would add another
agent to this lane." Nothing schedules that event, so the probation cannot fire — the same defect as
a gate with nothing behind it, which §10 already names as the reason a refusal ships only once
something can clear it.

## Considered options

- **Keep the event as written.** Rejected: a condition that waits on a decision nobody has scheduled
  is not a condition. §6's own framing — *everything that claims to catch something is asked whether
  it ever did* — only bites where the asking is triggered by something that happens on its own.
- **A clock — review the refuter monthly.** Rejected outright by
  [ADR-0004](0004-a-clock-may-release-a-batch-but-may-never-originate-work.md).
- **A count, fired by a sheet posting.** Chosen. Survivors are countable off what is already on the
  issues, and §6's counters are recomputed rather than stored, so nothing a count says can go stale.
  N=20 has precedent here: [ADR-0017](0017-release-fires-on-a-prd-close-or-on-n-unreleased-observations.md)
  already releases on 20 unreleased findings.

## Consequences

The counter **files an issue; it never deletes the stage.** That follows §6's rule that every lens
and counter produces issues and never notifications — the refuter's death arrives on the owner's desk
as work he rules on, not as an automatic amputation.

A declined proposal re-proposes only when the count has grown, inheriting the shape of
[ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md)'s two-site gate, so
the counter cannot nag.

This generalises past the refuter. It is the operational form of
[ADR-0003](0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md), and §6 names the
same unpaid debt at larger scale: 36 lint rules and 30 ADRs in a month, not one of them ever asked
whether it fired. Anything on probation in this system needs a firing condition of this shape, or it
is not on probation.
