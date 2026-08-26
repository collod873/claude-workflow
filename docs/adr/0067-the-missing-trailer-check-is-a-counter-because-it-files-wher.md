# The missing-trailer check is a counter because it files where the back-stamp writes, and it is section 6's fifth

Recorded 2026-08-26.

[ADR-0045](0045-a-superseded-adr-is-named-by-a-trailer-its-successor-writes.md) says it plainly —
*"the counter catches its own absence… the counter files it"* — and
[ADR-0065](0065-parity-and-correction-do-not-survive-their-own-history-so-se.md) sorted ten things and
this was not one of them. It is admitted here, with the four fields
[ADR-0064](0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md) requires.

| | |
|---|---|
| **Event** | An ADR or research note committed to `main` |
| **Count** | 1 |
| **Files** | An ADR carrying a supersession verb and a link to a lower-numbered ADR but no `Amends:` trailer; a `docs/research/` note with no `Resolves:` field |
| **Action** | Write the trailer, or state that it is not a supersession |
| **Sees** | 8 — drift |

## Why it was missed

[ADR-0046](0046-the-backwards-question-writes-rather-than-reports-so-it-need.md) ruled the
**back-stamp** out of §6: *"it writes rather than reports… §6's counters file issues that reach the
owner through the brief; this one commits a repair nobody receives."* That is correct and undisturbed.

But move 8c carries **two** mechanisms, not one, and they were treated as one because they read the
same trailer graph:

- The **back-stamp** derives `Status: superseded by ADR-NNNN` from a trailer that exists. It writes.
  No row — ADR-0046 stands.
- The **missing-trailer check** finds a supersession whose trailer does *not* exist. It cannot write
  anything, because the fact it needs is the fact that is absent. It **files**.

A bar whose test is *what issue does it file* has nothing to ask the first and a clear answer for the
second. They travelled together out of §6 on the first one's ticket.

## The backwards measurement, and it is not close

Run against `docs/adr/` on 2026-08-26, which is the corpus ADR-0064 requires before a counter is
built:

- **66 ADRs. Two carry an `Amends:` trailer** — ADR-0053 and ADR-0054, both written the same day the
  convention was.
- **27 carry a supersession verb and a link to a lower-numbered ADR with no trailer.** ADR-0045
  estimated *"~20 existing cases"* for its one-time backfill; the raw candidate count is consistent
  with that once citations are filtered out by hand, which is what makes the backfill a human pass
  rather than a standing heuristic.
- `docs/research/` has grown from seven documents to nine, and **three now carry no issue pointer at
  all** — `claude-cloud-sessions-2026-08.md`, `session-prompts-2026-08.md`,
  `verification-boundaries-2026-08.md`. ADR-0045 measured two of seven. **The backlog grew while the
  field stayed unbuilt**, which is the clearest evidence available that a convention with no reader
  does not hold.

This is the [ADR-0063](0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md)
admission exactly: it fires on the day it ships, and that is the finding rather than a threshold
argument.

**One is the right count** for the same reason it is right for the lost-dispatch counter (ADR-0065):
a missing trailer is a defect in the record, not a trend. A second missing trailer is not more
information than the first.

## `bin/new-adr --amends` was mandated and never built

ADR-0045 ruled that *"`bin/new-adr` gains an `--amends NNNN` flag that writes it."* It has no such
flag today. The tool that was supposed to make the trailer free was never built, which is why
compliance is 2 in 66 rather than climbing from the date of the ruling — and it is `docs/adr/README.md`'s
back-stamp convention repeating one level down, on the same day the ruling that named that failure
was written.

The flag ships with move 8c. It is not a separate decision; it is the counter's repair path, and
without it the counter files an issue whose action is *do a thing the tooling makes awkward*.

## Row 8 gains its first mechanism that files

§6's coverage ledger lists row 8 — *drift: this was true and stopped being* — as covered by the spec
lens, the decision-log lens, and the backwards question. The first two are **unbuilt**, and the third
**writes rather than reports** (ADR-0046). So row 8's entire filing coverage was zero, in a table
whose whole purpose is to stop C5 being asserted rather than scored.

## ADR-0064's admission audit fires here, and returns zero for a structural reason

Admitting the fifth counter asks the other four whether they have filed since they shipped. **None has
shipped**: bypass and lost dispatch ride [move 8d](https://github.com/collod873/claude-workflow/issues/115),
`not_planned` rides [move 7a](https://github.com/collod873/claude-workflow/issues/99), cross-repo
rides [move 12](https://github.com/collod873/claude-workflow/issues/114). Zero can be deleted because
zero have run.

ADR-0064 says *"if it is ever zero across two consecutive admissions, the backwards question is being
asked as a formality."* ADR-0065 was the first admission and cut two of ten; this is the second and
cuts none — and from outside those two readings are indistinguishable. So the clause needs its
precondition said out loud: **the audit is vacuous until a counter has shipped**, and a zero return
before the first counter runs is arithmetic rather than a formality. The warning applies to
consecutive zeros in a set that has traffic. The first admission after move 8d lands is the first one
that can fail this test.

## Considered options

- **Leave it inside the back-stamp and let move 8c file whatever it finds.** Rejected. That is the
  §6 row read as coverage of row 8 without a row existing — the inverse of ADR-0064's complaint, and
  it hides a mechanism instead of overstating one. A thing that files the owner an issue is a thing
  §6 must list.
- **Fold it into the cross-repo or bypass counter.** Rejected: different event, different class,
  different repo scope.
- **Cut it and rely on the one-time backfill.** Rejected on its own measurement. The backfill fixes
  the 27; nothing stops the 28th, and `docs/research/` growing from two-of-seven to three-of-nine is
  that failure already in progress.

## Consequences

**§6's counter table has five rows**, and every one of them names an event, a count, an issue and an
action. Rows 7, 8, 9 and 10 each hold at least one mechanism that files.

**It ships with [move 8c](https://github.com/collod873/claude-workflow/issues/104)**, the back-stamp
— same trailer graph, same pass — rather than with move 8d's run-metadata counters. Move 8c gains
`bin/new-adr --amends` and the one-time backfill alongside it.

**The number to watch is whether a trailer goes missing after the backfill lands.** Before it, the
counter is reading a backlog written under no convention, which proves nothing about the convention.
The first missing trailer written *after* `--amends` exists is the one that says the discipline does
not hold without the counter — and, if none ever appears, that the counter can be deleted at its next
admission audit.
