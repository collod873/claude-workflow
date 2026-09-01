# The acceptance author is shown the files its ticket claims, rendered into its prompt rather than reached through a tool

Recorded 2026-08-29.

Lane 04's author is given the current contents of every path under its ticket's `## Files claimed`,
inlined into the prompt. It still has no toolbelt. "From the spec alone" continues to govern what
the test *asserts*; it no longer governs whether the author may know the *form* of the file it
asserts about.

Amends: [ADR-0030](0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md) for lane 04
only — the shaper's ruling is unchanged.

## What asked for it

Lane 04's first production run, on #201, and it had never had one: the lane was built, tested and
uncalled, so `tests/acceptance/` had never existed on `main`. Given four criteria it wrote four
tests, landed all four through the push gate, and two were wrong. Both were wrong about a file's
shape rather than about a criterion:

- a YAML mini-parser matching `^on\s*:` against `acceptance.yml`, which writes `"on":` — quoted,
  because YAML 1.1 reads a bare `on` as the boolean `true`
- an assertion that the string `acceptance` appears in `to-tickets.yml`'s dispatch job, which by
  construction names no event type at all: under
  [ADR-0091](0091-the-token-that-spends-a-model-and-the-token-that-starts-the.md) the model job
  writes each request to a file and the dispatch job posts the lines verbatim

The second one contradicted the criterion quoted three lines above it. Neither is a model being
careless — both are the only thing a blind author can do when a criterion names a file it cannot
see, which is to imagine one.

That cost is not theoretical and it is not paid by the author. An acceptance test is expected to be
red until its ticket is built, so nobody reads a red one as a defect; `vitest.config.ts` includes
`tests/acceptance/`, so a wrong test is a permanently red `npm test` on trunk that no implementer
can fix, because `tests/acceptance/` is immutable to them (ADR-0032, ADR-0053). A test that is
wrong about a file's form never turns green, so it is worse than no test: it is a gate that has
stopped meaning anything while still costing every run.

## Why inlined rather than an allow list

[ADR-0060](0060-the-spec-author-reads-the-repo-through-an-allow-list-and-can.md) gives lane 02's
spec author `Read,Grep,Glob`, because an author that cannot read the code it specifies against
writes a spec nobody can build. The same argument reaches lane 04 — and stops one step short of the
same instrument.

The spec author needs to *discover* what exists; discovery is search, and search needs a tool. This
author does not. It already knows every file it may look at, because lane 03 wrote them down in the
ticket, and a slice's claim is sized to one session. So the whole reach can be resolved before the
model starts, which makes "reads its claimed files and nothing else" a property of what reached the
prompt rather than a line the model was asked to honour — ADR-0030's own reasoning, applied to reach
instead of to search.

## Considered options

- **`--allowedTools Read`, as lane 02 has.** Rejected: it grants the entire checkout to buy the two
  or three files the ticket names, and the bound that matters would then be a sentence in a prompt.
- **Leave the author blind.** Rejected on the evidence above — a 50% wrong-test rate on the lane's
  only production run, with the cost landing on trunk rather than on the run.
- **Show it the files, capped.** Rejected: a truncated file is the half-seen state this removes, and
  a model shown two thirds of a workflow guesses about the last third exactly as it guessed about
  all of it. The bound is the slice's claim, which lane 03 already sizes.
- **Show it the files, uncapped, with no tool.** Chosen.

## Consequences

**The author can now see work already done, which is a new way for it to be wrong.** A claimed file
that already exists is the *before* state, and a model that reads it as the finished article writes
a vacuously green test — the failure `author/prompt.md` already names as useless, now reachable from
a second direction. The prompt says so explicitly rather than leaving it implied. Nothing detects
it: the push gate classifies collection errors and non-assertion failures, and a test that passes
for the wrong reason looks exactly like one that passes.

**A slice claiming a large file pays for it every re-fire**, since `refireAcceptance` re-authors
through the same path. Acceptable at the sizes lane 03 produces; the lever if it stops being
acceptable is the slice's claim, not a cap here.

**`extractFilesClaimed` moved to `shared/ticket-shape.ts`.** Two lanes now ask the same question of
the same heading, and one parser is the answer.
