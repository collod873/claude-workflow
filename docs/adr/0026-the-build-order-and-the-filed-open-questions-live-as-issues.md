# The build order and the filed open questions live as issues, not as prose

Recorded 2026-08-26.

**`DESIGN.md` §10's seven unbuilt moves become issues with native blocked-by edges, and an open
question that has an issue becomes a one-line link.** What stays in the document is the part GitHub
carries badly: *why* the order is the order, and the framing that tells a session which questions are
the owner's and which are merely unmeasured.

Ruled by the owner on 2026-08-26 in
[#81](https://github.com/collod873/claude-workflow/issues/81). Applies
[ADR-0001](0001-github-is-the-spec-and-issue-tracker.md) — GitHub is the state machine, and a fact
not in a committed file or a GitHub object does not exist — to the two places in `DESIGN.md` that
were tracking state in prose.

## The build order

Moves 4a, 4b, 5, 6, 7, 8a, 8b, 9 and 10 are filed as issues, each blocked-by the moves above it. The
✅/◐ column disappears, because a closed issue is the same claim made by an object that updates
itself. This is the graph lane 03 already publishes, pointed at the roadmap that describes lane 03.

§10 keeps only the argument: **feedback, then repair, then refusal**
([ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md)) and why that splits blocker 5
across opposite ends of the list; the bootstrap's expiry, and that this repo does not grow files to
serve era-6 skills until it lands; and the honest accounting that moves 2–4 are weeks where the owner
is *more* in the loop, not less. None of that is status, and none of it survives being cut into
issue bodies.

**No new mechanism fires the migration.** It is a one-time move, done by
[#75](https://github.com/collod873/claude-workflow/issues/75). After it, each move issue closes when
its work lands.

## The open questions

The duplication the roadmap column had, the questions list had too. §11 Q5 — *does an unread document
get deleted automatically* — **is** issue
[#85](https://github.com/collod873/claude-workflow/issues/85). §12's ⚠#5, *three refuters is a
guess*, **is** issue [#83](https://github.com/collod873/claude-workflow/issues/83). Two homes for one
question is the same rot, one section lower.

So: **a question that has an issue is a link. A question not yet filed stays as prose until it is.**
The unfiled ones are what a session most needs to see, which is why the list is not deleted outright.

§12's scorecard grid dissolves into the same list. A ⚠ cell and a §11 question are the same object —
an unanswered question with an owner — and the proof arrived before this was ruled: ⚠#8 *dissolved*
rather than resolving when the owner ruled there is no spend ceiling
([#79](https://github.com/collod873/claude-workflow/issues/79),
[ADR-0024](0024-there-is-no-daily-spend-ceiling-and-the-governor-stops-on-qu.md)). That is how a §11
question behaves and not how a scorecard cell does. Six of the nine ⚠ cells were "a number nobody has
measured", which is §11's *measured, not owner* verbatim.

The §11 framing survives: **⬤ owner** questions are about destination, scope or spend and are his
alone; **measured** questions have a right answer nobody currently holds the number for, and handing
one to him as a choice rebuilds the sizing quiz commit `68b071f` deleted.

## A grill does not get its own row

A move issue is **blocked-by the grilling issues that decide it**, and that edge is the whole
statement that a decision is owed first. Move 7 is blocked-by
[#83](https://github.com/collod873/claude-workflow/issues/83) and
[#84](https://github.com/collod873/claude-workflow/issues/84); move 9 by
[#84](https://github.com/collod873/claude-workflow/issues/84).

The alternative — a paired grill issue per move — files issues whose only content is *"go decide the
thing that already has an issue."* The `wayfinder:grilling` label already exists and already carries
those tickets.

**Consequence worth naming:** the wayfinder map
[#76](https://github.com/collod873/claude-workflow/issues/76) currently owns the grilling tickets and
closes when the way is clear. The move issues outlive it, which is the right way round — a map is
scoped and temporary, a build order is not.

## Consequences

- `DESIGN.md` §10 shrinks to its ordering argument plus a link to the tracker.
- `DESIGN.md` §11 keeps its unfiled questions and its owner/measured framing; filed ones become
  links.
- `DESIGN.md` §12 is removed. Its C1 arithmetic folds into §0 — see
  [ADR-0025](0025-design-md-carries-no-lane-status-a-shipped-lane-collapses-to.md).
- Each new move issue carries the collapse criterion ADR-0025 requires, enforced by the close gate.

## What would reverse this

The roadmap needing to be read somewhere GitHub is not reachable, or the blocked-by graph proving
too coarse to express an ordering the prose could. Either is a new ADR amending this one.
