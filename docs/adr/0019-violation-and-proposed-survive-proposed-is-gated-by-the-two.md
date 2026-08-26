# VIOLATION and PROPOSED survive, PROPOSED is gated by the two-site rule, and COMPOSITION and SEAM are dropped

Recorded 2026-08-25.

The transcript auditor runs two lenses, not four. VIOLATION and PROPOSED survive; PROPOSED is
released only once a second site appears; COMPOSITION and SEAM are dropped. Ruled in
[#36](https://github.com/collod873/claude-workflow/issues/36) §Solution 2 and ratified by the owner
on 2026-08-23.

## What this amends

**`agent-skills/docs/research/finding-what-goes-wrong.md` Part 8 step 5**, which said to narrow the
transcript lens to conduct only — dropping VIOLATION along with COMPOSITION and SEAM, because *"all
three read the diff, which `/standards-pass` does better and faster."* That conclusion was drawn
from pre-fix data and is now false. The rest of that document stands; this amends step 5 and step 5
only, and a reader who meets the document without meeting this ADR will act on a superseded
conclusion.

## The evidence

Lumaria commits `d4ab813` and `0ddfb09`, landed 2026-08-21, replaced `git diff HEAD` — the working
tree, empty for any session that committed its work — with the session's own SHA range. **All 27
post-fix findings (15 sessions, 2026-08-21 → 08-23) were re-verified against the repo at both the
stamped range and current HEAD**, and the measurement underneath step 5 changed:

| | Pre-fix (42 findings, 28 sessions) | Post-fix (27 findings, 15 sessions) |
|---|---|---|
| WRONG | 1 (2%) | **0 (0%)** |
| STALE | ~18 (43%) | **2 (7%)** |
| VALUABLE | ~11 (26%) | **19 (70%)** |
| WORTHLESS | ~12 (29%) | 6 (22%) |

Per lens, across those same 27:

| Lens | Findings | Valuable | Stale | Worthless | Wrong |
|---|---|---|---|---|---|
| VIOLATION | 14 | **13 (93%)** | 0 | 1 | 0 |
| PROPOSED | 11 | 6 (55%) | 0 | **5 (45%)** | 0 |
| COMPOSITION | 1 | 0 | 1 | 0 | 0 |
| SEAM | 1 | 0 | 1 | 0 | 0 |

**VIOLATION does a job `/standards-pass` does not do at all.** Standards-pass hunts recurring smells
in order to propose new rules; VIOLATION checks **already-ratified prose rules that no linter
enforces** — the only enforcement prose standards have ever had, and `GOAL.md` blocker 3 seen from
the other side, since `CODING_STANDARDS.md` has exactly one exit (*mechanised*) and can therefore
only grow.

**PROPOSED is where the noise is**, and its failure mode is specific: it generalises a single
implementation choice into a universal rule. Hence the two-site gate — `/standards-pass`'s existing
bar, *"a smell seen once is not one."* A PROPOSED finding naming one site is recorded and never
released; it is released when a second site appears. That is what turns 45% worthless into signal.

**COMPOSITION and SEAM produced one finding each, both stale.** Too small a sample to judge as
lenses, and both were overtaken by refactors before anyone opened the inbox. They are dropped rather
than kept-and-ignored so that the auditor's cost is spent where the yield is.

## Consequences

The `Suggested CODING_STANDARDS.md line:` field goes with them. `finding-what-goes-wrong.md` Part 6
already called it *"a verdict wearing a question mark"* and counted it as the manufacturer of 30 of
the original 42 findings.

Dropping two lenses on one-finding samples is a decision made on thin data, and it is reversible: a
lens is a paragraph in a prompt. If the corpus later shows composition or seam problems arriving by
no other route, re-adding one costs a prompt edit and a re-run against stored captures — which is
the whole reason [#36](https://github.com/collod873/claude-workflow/issues/36) split capture from
the lens.
