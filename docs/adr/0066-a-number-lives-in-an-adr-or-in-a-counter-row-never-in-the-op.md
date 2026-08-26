# A number lives in an ADR or in a counter row, never in the open-questions list, and a corpus withheld by behaviour cuts a counter but not a measurement

Recorded 2026-08-26.

Amends: [ADR-0026](0026-the-build-order-and-the-filed-open-questions-live-as-issues.md), which moved
the build order and the filed open questions out of `DESIGN.md` §11 and left the **unmeasured
numbers** behind in it.

They leave too. Every number this design carries is a **counter** — an event, a count, an issue and
an action ([ADR-0064](0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md)) — or a
**sizing measurement**, the query that would say a decision was wrong, living in the ADR that made
it. §11 is the list of decisions the design still owes. A number nobody has collected is not an owed
decision, and parking one there is how it stays uncollected while looking scheduled.

## Ship-and-watch is not a third bucket

[#97](https://github.com/collod873/claude-workflow/issues/97) asked for three: dissolve,
measure-first, ship-and-watch. ADR-0064's two categories consume the third.

A **counter** *is* ship-and-watch, by construction — something watches, and it files. A **sizing
measurement** is not ship-and-watch and never was: nothing watches it, nothing is meant to, and it is
run once by whoever reopens the decision. Calling it watched is the false coverage claim ADR-0064
removed from §6, restated one level up.

**Measure-first is not a bucket either.** It is ADR-0064's measurement clause, and that clause
applies to **counters only**, because only a counter has a build for a prior measurement to gate. A
sizing measurement gets *"no §6 row, no venue, no build and no build-order move"* — there is nothing
for a measurement to come first of.

So the sort is two placements and a dissolve list.

## The third case in the measurement clause: a corpus withheld by behaviour

ADR-0064 names two: *zero in a corpus that already exists is a cut; zero because the corpus does not
exist yet is a deferral to the move that creates it.* Lane 01 stands in neither.

Lane 01 is **built and shipped** — `shape.yml`, `shape-accept.yml`, `marker.ts`, `probation.ts`,
`sheet.ts`. It has produced **zero decision sheets**, because **zero of this repo's 108 issues carry
the `idea` label**. All 24 `shape.yml` runs are `skipped`, and correctly so: the guard works, the door
has never been opened. Every item in this repo has arrived by the owner filing directly.

No move supplies that corpus. Move 4b is done. Deferring to it would be a deferral to an event no
build will cause, which is exactly the permanent exception
[ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) rules against.

**The third case is asymmetric, and the asymmetry is the ruling.**

- For a **counter**: a corpus withheld by behaviour is a **cut**. Built, it sits idle forever;
  deferred, the deferral never expires. Both are ADR-0031's exception wearing different clothes. It
  re-enters through ADR-0064's front door the day traffic exists — one paragraph to restore.
- For a **sizing measurement**: a **no-op**. It costs nothing while idle because nothing is built and
  nothing claims coverage, and **an empty result is a legal answer to a falsification query** — it
  says the decision has not yet been tested, which is true and worth knowing. It stays in its ADR and
  returns nothing until there is something to return.

That is what makes lane 01's two numbers safe where they are, and it is the general rule ADR-0064's
clause was missing.

## ADR-0031's shape is the general answer for counters and never for numbers

#97 asked whether ADR-0031's count-with-a-threshold generalises. ADR-0064 drew half the boundary: a
probation is a mechanism that dies if a condition fires, and nothing dies if a sizing measurement is
never run. This adds the other half. ADR-0031 **does** reach a counter whose corpus is withheld by
behaviour, because that is a probation whose event may never happen — ADR-0031's own subject, one
layer out from the refuter it was written about.

## The sort

Nine were already placed and are restated here only so the set is closed.

| Number | Placement | By |
|---|---|---|
| `not_planned` closes, 3 grow / 20 delete | counter | [ADR-0037](0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md), [ADR-0065](0065-parity-and-correction-do-not-survive-their-own-history-so-se.md) |
| A dispatch that never arrives | counter, at 1 | ADR-0065 |
| A red tree reaching `main` | counter, at 3 | [ADR-0063](0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md) |
| A finding recorded at a second site | counter, at 2 | ADR-0065 |
| Share of red PRs reaching `blocked` | sizing measurement | [ADR-0041](0041-the-fixer-stops-when-it-stops-making-progress-with-three-att.md) |
| Out-of-brief reads by module | sizing measurement | [ADR-0042](0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md) |
| PR wait time at the merge | sizing measurement | [ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md) |
| Share of specs dispatching at zero open questions | sizing measurement | [ADR-0062](0062-the-prd-label-fires-the-critic-and-a-zero-open-question-coun.md) |
| Counters deleted by the next admission | sizing measurement | ADR-0064 |

Six were not. Each is placed below.

### The share of items routed long — sizing measurement, ADR-0029, empty

[ADR-0029](0029-marks-route-an-item-the-five-decision-cap-is-what-refuses-it.md) already states it and
already states its status: *"a guess until sheets exist to count."* That sentence is the placement,
and it is correct as written. Corpus: zero sheets, by the behavioural case above. It returns empty and
blocks nothing.

### The sweep's kill rate — replaced, then placed in ADR-0052

§11's question 3 is **the wrong number**, and this is the one cell that changed rather than moved.

Its stated motivation — *three model stages spend before a line exists* — **dissolves on
[ADR-0024](0024-there-is-no-daily-spend-ceiling-and-the-governor-stops-on-qu.md)**: there is no spend
ceiling, the chain is under a dollar, and cost is not an input to this design. What survives is *is
the shaper earning its stage*, and a bare kill rate cannot answer it: **it cannot tell a correct kill
from an over-refusal.** A sweep that refuses everything and a sweep that refuses exactly the right
things produce the same number.

The number that discriminates already exists in the design.
[ADR-0052](0052-a-comment-clears-a-stage-1-refusal-because-the-change-reques.md) gives a stage-1
refusal a clearing path — a comment — so **the share of stage-1 refusals cleared by a comment** is the
falsification condition: near zero and the sweep is refusing correctly; high and it is refusing things
the owner wants. It lives in ADR-0052, the ruling it would falsify. Corpus: zero, behavioural case,
returns empty.

Stage 3 already has its own answer and needs nothing here: `probation.ts` is ADR-0031's count, at 20
silent sheets. Stage 1 needs no probation of its own — it is Haiku, it runs before the shaper spends,
and ADR-0052 makes a wrong kill recoverable by one comment.

**§11's question 3 is struck.**

### Intake templates are per-repo copies — dissolved

§11's question 6 asked where a copied template stops being a copy — *"at two repos that is a file; at
twenty it is `/sync-skills`."*
[ADR-0057](0057-the-installer-derives-every-list-it-acts-on-and-overwrites-o.md) answered it after §11
was written: `.github/ISSUE_TEMPLATE/` is on the installer's **Wires** list, derived and overwritten
on re-run, never merged. It does not degrade with repo count, and `/sync-skills` — which
[ADR-0027](0027-six-of-era-6-s-eleven-verbs-do-not-survive-the-map-and-two-s.md) deleted — is not what
twenty repos need.

It was never a number: it names no count and no action. **§11's question 6 is struck.**

### How often the immutability alarm fires — sizing measurement, ADR-0032, empty

[ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md)'s diff refusal is a
**gate**, not a counter: it already acts, by refusing the pull request. The rate is what sizes the
decision to keep it as an alarm alongside restore-from-tip, so it is that ADR's falsification
condition. Corpus: zero — `tests/acceptance/` does not exist and this repo has opened zero pull
requests, ever. Here a build *does* supply the corpus (move 5), which makes it ADR-0064's ordinary
second case; as a sizing measurement it is a no-op either way and returns empty until then.

### How often `regenerate && diff` fires — sizing measurement, ADR-0056, empty

The falsification of
[ADR-0056](0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md)'s claim that the
check contract must be generated — a claim resting on four repos, two of them already wrong about
themselves. Move 11 supplies the corpus. Empty until then, and this is the sample-size caveat #82
attached to it, recorded where the decision is.

### A missing `Amends:` trailer — a counter, and §6 never sorted it

Ruled separately in
[ADR-0067](0067-the-missing-trailer-check-is-a-counter-because-it-files-wher.md), because it adds a
row to §6 rather than placing a number, and because admitting a counter fires ADR-0064's audit.

## Consequences

**§11's "Not yet filed" list is down to questions 1 and 2**, which are one deferred owner decision
wearing two hats: how far the pipeline spreads, and — riding on it — whether the acceptance lane
applies to non-code work. Questions 3 and 6 are struck here, 4, 5 and 7 were already retired. The list
now holds only what it is for.

**§11 carries no numbers, and the rule that keeps it that way is mechanical**: a number belongs to a
decision or to a mechanism. If it belongs to a decision, it goes in that decision's ADR. If it belongs
to a mechanism, it goes in the §6 row with all four fields. There is no third home, so there is
nowhere for one to be parked.

**Three sizing measurements return empty because lane 01 has never run**, and that is not a defect in
them. It is, however, the first time this design has noticed that a **built, shipped, correctly-wired
lane has zero traffic** — 24 skipped runs and no `idea` label in 108 issues. That is not #107's class
(a dispatch that never arrived); it is the door working and nobody using it. Whether the micro door
earns its build is a question about lane 00, not about these numbers, and it is not opened here.

**The number to watch is how many numbers the next ruling parks somewhere other than these two
homes.** One is a slip. A second says the two homes are missing a case, and the honest response is to
find it rather than to widen §11 again.
