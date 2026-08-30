# A stage runs the gate its output will be judged by, before it answers

Recorded 2026-08-29.

Status: superseded by ADR-0110

A stage whose output is checked by a gate it never runs cannot fail cheaply. Every stage prompt
names the gate its answer will actually meet — for the implementer, `npm run check` — and the stage
answers only once that gate is green, or says plainly that it is not.

## Why

Lane 05's run 33282084838 built ticket #238 in 72 turns, 16 minutes and $4.00. It typechecked, it
linted, it ran the ticket's tests and got 45 green. Then the push ran `npm run check`, the clone gate
found eight duplicated fragments its baseline did not carry, the push was rejected, the claim branch
was released, and the ticket went back to unbuilt.

Nothing in the failure was hard. Seven of the eight clones were near-identical scenario blocks in a
test file the stage had just written, and folding them into two `it.each` tables took minutes. The
eighth was a real one: two lanes had grown their own copy of the same `bin/close-ticket` spawn. All
of it was trivially fixable while the stage still had the files open, and unfixable one second
after it answered.

The gate was right about every finding. What was wrong is *when* the stage met it. The implementer's
brief named the acceptance tests and the claimed files and said nothing about a push gate, so the
stage ran the checks it could infer — the ones that speak to the ticket — and never the one that
decides whether its work survives. It spent the whole budget before the only check that could
reject it got to speak.

## Considered options

**Make the push gate lenient for a lane run.** The gate would stop rejecting work, and the estate
would start accumulating exactly the duplication the gate exists to prevent — paid for later, by
someone with less context than the stage that wrote it. A gate you route around on the expensive
path is a gate for cheap paths only.

**Have the caller retry: catch the rejection, feed the findings back, run the stage again.** This is
worth building eventually, and it is not a substitute for this. A retry pays twice for a failure the
stage could have seen the first time, and it only exists at all because the first pass was allowed to
end blind.

**Let the stage discover the gate by reading the repo.** The implementer is deliberately not handed
the repository to explore — that constraint is what keeps a slice a slice. Asking it to go find its
own gate would trade the failure here for a broader read on every run.

## Consequences

A stage now spends turns on a check that usually passes. That is the trade: a few turns on every run
against a whole run lost on some of them, and the arithmetic is not close at $4 a build.

This generalizes past lane 05. Any stage whose answer is applied by a process that gates it owes the
same treatment, and the test that pins it should read the gate's name from where the gate is actually
defined — `package.json` here — rather than restating it, so a renamed script fails the test instead
of leaving a prompt pointing at a command that no longer exists.
