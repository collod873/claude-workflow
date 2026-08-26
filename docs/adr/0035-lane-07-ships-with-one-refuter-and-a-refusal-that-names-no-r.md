# Lane 07 ships with one refuter, and a refusal that names no reason does not count

Recorded 2026-08-26.

Lane 07 ships **one** Sonnet refuter per finding, not three. It runs behind the structural refusal
of [ADR-0036](0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md), so it only ever
reads findings a machine could not rule on. The direction of change is **grow on evidence**, and the
evidence is [ADR-0037](0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md)'s
counter.

At N=1 there is no majority to be in, so the refuter is a **veto**. A veto combined with §07's
*"default to refuted when uncertain"* means one hedging Sonnet kills every finding the lane ever
produces. So the default is bounded rather than removed: **a refusal must name its reason** — the
gate that already covers it, the path by which the finding is unreachable, or the line of the diff
it does not in fact touch. A refusal naming nothing is stripped mechanically and the finding
survives, which is the same shape as
[ADR-0028](0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md)'s malformed
assumption mark: the test needs no judgement at check time.

## The number this was sized against

`DESIGN.md` §12 ⚠#5 and issue [#83](https://github.com/collod873/claude-workflow/issues/83) both
state that three refuters is a guess with *no measured false-alarm rate to size it against*. That
was false when written. [ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md)
holds the only corpus of agent findings this estate has ever graded — 27 findings across 15
sessions, judged by the owner:

| | 42 findings, pre-fix | 27 findings, post-fix |
|---|---|---|
| VALUABLE | ~26% | **70%** |
| WORTHLESS | ~29% | **22%** |
| STALE | ~43% | 7% |

At ~22% worthless and this repo's low single-digit PR volume, roughly one noise finding reaches the
owner every second PR. C7 caps his queue at ~7. **Three refuters is a fleet sized for a flood the
only real number says is not coming.**

The two interventions that actually moved those columns were **neither of them a model**: fixing the
lens's input (one commit replacing `git diff HEAD` with the session's real SHA range, which took
STALE from 43% to 7%) and a free deterministic gate (the two-site rule, which is what turned
PROPOSED's 45%-worthless into signal). ADR-0036 is that second lesson applied here.

## Considered options

- **Three, as drafted.** Rejected. Inherited from the Foundry draft, which `DESIGN.md` §0 says has
  never been scored against anything, and C1 already refuses this shape one lane up — §01 rejects
  the Foundry's three-adversaries-plus-synthesiser as the era-4 death.
- **Three now, shrinking once the vote split is known.** Rejected, and it is the option that looked
  strongest. Three Sonnets given one prompt and one context are not independent draws: their
  agreement measures the prompt, not the finding, so unanimity would be uninterpretable. The number
  that decides the fleet's size — *was the surviving finding worth the owner's time* — is observable
  at **any** N, so nothing about starting at three is needed to produce it.
- **One, growing on evidence.** Chosen. ADR-0019 dropped two lenses on a **one-finding** sample and
  justified it by reversibility — *"a lens is a paragraph in a prompt."* A refuter is that same
  paragraph, so the argument is symmetric and licenses acting on thin data in this direction too.
- **Zero — the structural refusal alone.** Rejected, but narrowly. It would ship a review lane with
  no model filter at all, and the 22% figure is measured on standards findings rather than on defect
  findings in a diff, so it does not transfer cleanly enough to bet the whole filter on.

## Consistency with lane 01

§01's refuter is on probation for the same reason and it is **not** the same mechanism, which is
worth stating because the two invert:

| | Lane 01 | Lane 07 |
|---|---|---|
| Attacks | the shaper's **recommendations** | the reviewers' **findings** |
| Firing looks like | a surviving refutation **added** to the sheet | a finding **removed** from the owner's queue |
| Sustained silence means | it never found anything — it is not earning its stage | it never killed anything — it is not earning its stage |

The shared shape is that in both lanes **silence is the good outcome per finding and the bad outcome
in aggregate**, which is exactly why
[ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) had to give lane
01's probation a firing condition that silence alone could not satisfy forever. Lane 07 inherits
that, with one difference ADR-0037 records: lane 07's counter is **two-sided**, because a lane whose
refuters kill everything is a failure lane 01 cannot have.

## Consequences

`DESIGN.md` §07's cost line drops from *2 Opus per PR plus 3 Sonnet per finding* to *2 Opus per PR
plus at most 1 Sonnet per surviving finding*, and the lane stops being the most expensive one per
unit of work.

Being wrong here is cheap and visible: ADR-0037's counter files an issue proposing a second refuter
at three false alarms. Being wrong in the other direction — a fleet that quietly kills everything —
is what the same counter's other threshold exists for.
