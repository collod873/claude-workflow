# A finding a green gate already covers is refused before any refuter reads it

Recorded 2026-08-26.

Lane 07 fires **on CI green** — which is to say lint, typecheck, the test suite, and lane 04's
immutable acceptance tests have all already run against this diff and said nothing. A finding that
restates what one of those gates covers is therefore noise **by construction**, and ruling it out
takes no judgement at all.

So a structural refusal sits ahead of the refuter. A finding is dropped, with no model spent, when
either holds:

- it names **no `path:line` inside the diff under review** — the same evidence shape
  `bin/ticket_shape.py`'s `PATH_LINE_RE` already enforces on a closing record, reused rather than
  reinvented; or
- it names a **rule or check a green gate already enforces** — an `eslint.config.js` rule id, a type
  error, a named test or acceptance criterion. The gate ran, it passed, and the finding is arguing
  with a verdict already on the record.

Only what survives both reaches
[ADR-0035](0035-lane-07-ships-with-one-refuter-and-a-refusal-that-names-no-r.md)'s single refuter.

## Why a free gate rather than a bigger fleet

This is the second lesson of
[ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md) applied one lane
over. Of the two things that turned that corpus from 26% valuable to 70%, neither was a model:
fixing the lens's input, and adding the **two-site gate** — a deterministic rule that took PROPOSED
from 45% worthless to signal. §6 makes the same argument at estate scale: *the current system spends
models on everything it already covers and counts nothing in the places it doesn't.*

It is also [ADR-0010](0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md)'s shape.
The earliest venue that can run this check is before the model call, its budget is microseconds, and
what earliest buys is that the expensive stage never sees the item at all.

## Considered options

- **Let the refuters handle it.** Rejected. It pays a model to answer a question that arithmetic
  answers, and it is the specific waste ADR-0035 sized the fleet against.
- **A model judging "is this already covered?"** Rejected. The gates that ran are named artifacts
  with named outputs; matching against them is a lookup. A model asked to do a lookup will
  occasionally be creative about it, and a filter that is wrong in the *drop* direction loses
  findings silently.
- **Deterministic refusal on both conditions.** Chosen.

## Consequences

The refusal is **not** a lens and it produces no issue — it is a refusal in §4's sense, firing
before a run spends model time, and it is free when it fires.

It has one failure mode worth naming: a real defect that a green gate *appears* to cover but does
not — a passing test that asserts the wrong thing. That finding is dropped here and nothing counts
it. It is the same class of miss §07 already accepts by design (*a false alarm that reaches the
owner costs more than a caught bug missed here*), and lane 04's own immutability alarm is the thing
watching for tests that were made to pass rather than made to be right
([ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md)).
