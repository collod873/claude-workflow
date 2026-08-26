# A counter names an event, a count, an issue and an action, and is measured against the history it would have read

Recorded 2026-08-26.

A **counter** is admitted to `DESIGN.md` §6 only if the ADR admitting it names four things:

| | |
|---|---|
| **Event** | What fires it, happening on its own — [ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) |
| **Count** | The number at which it acts |
| **Issue** | The issue it files at that number |
| **Action** | What that issue proposes someone do |

A number that cannot name an **action** is not a counter. It is a **sizing measurement**: the query
that would say a decision was wrong. It gets no §6 row, no venue, no build and no build-order move,
and it lives as a line in the ADR that made the decision it sizes.

And before a counter is built, it is **measured against the history it would have read**. Zero in a
corpus that already exists is a cut. Zero because the corpus does not exist yet is a deferral to the
move that creates it.

## What "countable, therefore free" admitted

§6's three counters became ten in four days, every one on that argument. It has no stopping
condition, and §6 warns about exactly that shape two paragraphs later when it cites Lumaria's inbox:
43% of four weeks of findings dead on arrival.

The argument is not wrong, it is **about the wrong resource**. Compute was never the constraint here.
`GOAL.md` C4 is about grooming and C7 is about the owner's attention, and a counter spends both the
moment it files. Counting is free; the issue is not. So the bar moves from the input to the output,
which is also what separates the two kinds — a thing that files an issue proposing an action is a
counter, and a thing that does not is a sizing measurement. One rule does the admission and the
taxonomy at once.

## Why the ADR is the sizing measurement's home, and why that is not a demotion

Four of the ten rows produce nothing: the share of red PRs reaching `blocked`
([ADR-0041](0041-the-fixer-stops-when-it-stops-making-progress-with-three-att.md)), out-of-brief reads
by module ([ADR-0042](0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md)), PR wait
time at the merge ([ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)),
and the share of specs dispatching at a zero open-question count
([ADR-0062](0062-the-prd-label-fires-the-critic-and-a-zero-open-question-coun.md)). Nobody is meant
to receive any of them.

They belong to the decision, not to the machine. ADR-0039 already demonstrates the shape without
naming it — having struck the five-day expiry it says *"if his answer latency changes, the same query
says so, for free, with nothing built."* That is a falsification condition attached to a ruling, which
is what an ADR is for. A reader who reopens the decision finds it in the record that made it; a reader
of §6 should not find it at all, because §6 describes mechanisms and this is not one.

**They are not on probation, and ADR-0031 does not reach them.** A probation is a mechanism that dies
if a condition fires, so a condition that never fires is a permanent exception. Nothing dies if a
sizing measurement is never run. What it costs instead is a **false coverage claim**, which is why the
rule is that it leaves §6 entirely rather than sitting in the table unbuilt: a row in the counter table
is read as coverage of its evidence class, and four rows nobody will ever query are C5 asserted rather
than scored.

## The measurement clause is ADR-0003 pointed backwards

[ADR-0003](0003-a-lint-rule-is-asked-whether-it-ever-fired-only-when-standar.md) asks an *enabled*
rule whether it ever fired. None of these counters is enabled, so the question cannot be asked in that
direction — and §6 has been naming that unpaid debt at larger scale without paying it: 14 lint rules,
2 `CODING_STANDARDS.md` entries and **63** ADRs, not one ever asked. That figure read 30 until
[#85](https://github.com/collod873/claude-workflow/issues/85) corrected it to 44 earlier the same day,
and 40 of the 63 landed today — the count in §6 is a hand-stamped number that was wrong within hours
of being right, which is C4's grooming law demonstrated inside the paragraph that complains about it.

Pointed backwards it can be asked today, for nothing, because every corpus these counters read already
exists: `git log`, the tracker, Actions run metadata. The precedent is
[ADR-0063](0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md), which was admitted on
exactly this test — 4 of 34 `verify.yml` runs on `main` already failed at the Gauntlet step, so the
counter fires the day it ships and *that* is the finding rather than a threshold argument.

The two-sidedness matters more than the test. A one-sided version cuts everything unbuilt, which would
delete the cross-repo counter for the sin of being early. **No signal** and **no traffic yet** are
different answers: the first is a null result about a corpus, the second is a statement about a
precondition, and only the first is a cut.

## The next admission is the audit

§6 says *everything that claims to catch something is asked whether it ever did, at the event that
would add another of its kind* — and then names no such event for counters, which is the precise
defect ADR-0031 was written about.

The event is **the admission of the next counter**. Admitting counter N+1 asks all N whether they have
filed an issue since they shipped, and a zero-count counter is deleted in the same commit with the
finding as its reason. That is ADR-0003's shape exactly — a rule's audit rides `/standards-pass`, the
event that adds a rule — and it needs no machinery, because it is a step in an ADR that is being
written anyway.

So the bar and the audit are one event, fired by something that happens on its own, and checkable by
reading `docs/adr/`. A set that never grows again is never audited again, which is correct: a set
nobody is adding to is a set nobody is arguing about.

## Considered options

- **Keep "countable, therefore free" and add a cap — no more than N counters.** Rejected. A cap
  refuses the (N+1)th regardless of whether it is the best one, and it would have refused the bypass
  counter, the only member of the set with measured traffic.
- **Give the sizing measurements their own §6 subsection.** Rejected: it is the fastest route back to
  ten rows read as ten mechanisms, and a section describing things that will never be built is
  grooming (C4).
- **Refuse the sizing measurements outright as ADR-0031 violations.** Rejected. They are the honest
  falsification conditions of the rulings that named them; deleting them makes those rulings less
  checkable, not more.
- **Audit the counters on a clock.** Rejected outright by
  [ADR-0004](0004-a-clock-may-release-a-batch-but-may-never-originate-work.md).

## Consequences

**Every counter states its contract in the ADR that admits it**, in the shape of a lane contract
([ADR-0025](0025-design-md-carries-no-lane-status-a-shipped-lane-collapses-to.md)) rather than as
prose §6 has to restate. §6's table carries the same four fields, and the shape of the row is the
counter's status.

**A counter with a precondition ships with the move that supplies it**, not before and not late. §6
already reasoned this way about the cross-repo counter — *"built and left idle rather than built
late"* — and this generalises it.

**The bar refuses two of the three counters §6 argues in.** Applied in
[ADR-0065](0065-parity-and-correction-do-not-survive-their-own-history-so-se.md), which is this
ruling's own first audit and the reason it is a separate record: the bar outlives the set it is first
applied to.

**The number to watch is how many counters the (N+1)th admission deletes.** If it is ever zero across
two consecutive admissions, the backwards question is being asked as a formality, and the audit has
become the ritual C4 bans rather than the one that discharges it.
