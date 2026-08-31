# A recomputing counter closes its standing issue when its count reaches zero

Recorded 2026-08-29.

Status: superseded by ADR-0117

[ADR-0064](0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md) makes a counter name
the event that fires it, the count it acts at, the issue it files and the action that issue
proposes. It says nothing about the issue's end, so every standing report this repo files is opened
by a mechanism and can only be closed by a hand. A counter that **recomputes its whole set every
run** knows when the set is empty, and must close its standing issue at that moment. A counter that
only ever sees one item at a time does not know, and must not try.

## Why the omission had teeth

[#216](https://github.com/collod873/claude-workflow/issues/216) was filed at 02:59Z naming
[#209](https://github.com/collod873/claude-workflow/issues/209) and
[#213](https://github.com/collod873/claude-workflow/issues/213) as unreachable behind blockers that
closed without delivering. Both delivered within the hour — #209 at 03:47Z, #213 at 04:02Z, six and
four criteria verified. The report was wrong from 04:02Z onward and stayed open anyway, because
`reportUnreachable` in `dispatch/reconcile.ts` returned early on an empty finding list and never
reached the standing issue at all. The one state in which the report has nothing to say was the one
state in which it was never looked at.

That is worse than a stale issue. The counter's whole claim is
[ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md)'s — *a refusal ships only once
something can clear it* — and a report nothing can clear is the park it was built to replace, with
an issue number attached. The reader who acts on it re-cuts slices that already shipped.

## The line is recomputation, not counter-ness

The unreachable counter derives its whole answer from the tracker on every run and stores nothing —
`reconcile.ts`'s header says so explicitly. Zero findings therefore means *nothing in the tracker is
unreachable*, which is exactly the fact the standing issue would have to assert to stay open.

`watchdog/lost-dispatch-counter.ts` is the other shape. It fires per PRD, sees one PRD, and its
`clean` action is a statement about that PRD and no other. It never holds the set, so it can never
observe the set empty; making it close the standing issue on its own clean run would close a report
about twelve other PRDs on evidence about one. Same marker pattern, opposite epistemics — and the
distinction is the ruling, not the mechanism.

## Consequences

**The retirement is a closing record, not a silent close.** The comment declares `No diff.` in
`close-gate.py`'s own grammar, because a standing report's lines are cleared by other tickets'
diffs and never by one of its own. `signalBody` writes no `## Acceptance criteria` heading, so
`No diff.` is the correct declaration for every issue this counter opens — the gate and the counter
agree by construction rather than by luck.

**Closing the report never retires the mechanism.** The marker is what the next run keys on, so a
later zero-to-nonzero transition opens a fresh issue and the reader gets a new notification rather
than a reopened one they have already read past. That is the intended behaviour: a signal that goes
quiet and then speaks again is a new event.

**A failed close costs the run nothing.** It is logged and dropped, on the rule the dispatch loop
already follows — the next recompute finds the same zero and the same open issue, so the close is
late, never lost.

**The zero path now pays one `gh issue list`.** Previously free. It rides session end, once per
run, against a hundred-issue page this repo has never filled — the cost of a counter that can
finish.
