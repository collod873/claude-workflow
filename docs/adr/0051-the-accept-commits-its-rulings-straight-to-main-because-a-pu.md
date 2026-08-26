# The accept commits its rulings straight to main, because a pull request would cost a second owner touch

Recorded 2026-08-26.

When the owner applies `approved`, the ADRs and `CONTEXT.md` terms the sheet drafted are committed
and pushed directly to `main` by the runner. No pull request, no review, no second click.

Ruled by the owner on 2026-08-26, with move 4b.

## Considered options

- **Open a pull request the owner merges.** Rejected on the number this lane is built around.
  `DESIGN.md` §01 budgets lane 01 at **2 owner minutes, batched**, and §0's cost table makes the
  whole short path *one* owner touch. A pull request adds a second one — and it adds it *after* the
  decision has already been made, which is the worst kind: nothing about merging it is a judgement,
  so it is pure ceremony sitting on the one owner point this lane has.
- **Push nothing; file the ADRs when lane 02 runs.** Rejected against
  [ADR-0005](0005-accepting-a-shaped-idea-is-what-files-its-adrs.md), whose whole content is that the
  ruling has to exist *before* the spec so the spec cites it rather than re-deciding it. Deferring
  the write reconstructs the retrospective habit that ADR replaced.
- **Push to `main` directly.** Chosen. It is what this repo already does — §10 records that it has
  never opened a pull request, and that branch protection is a purchase rather than a setting on a
  private Free account, so there is no protection for this to route around.

## Consequences

**This is scaffolding with a known expiry, and the expiry is already scheduled.** Move 10 buys
branch protection and required checks. On that day everything that writes has to open a pull request
and let it auto-merge on green, and this lane is one of the things that changes — the same sentence
§10 already writes about lane 05.

**The blast radius is bounded by what the accept can write.** It appends ADR files that `bin/new-adr`
just created and inserts a `CONTEXT.md` entry under an existing heading. It never edits an ADR that
already existed, never creates a `CONTEXT.md` heading, and writes nothing at all when the sheet
carried no marked-and-titled decision. A wrong ruling is a wrong file in `docs/adr/`, which
`docs/adr/README.md` already has a stated remedy for: write a new one that says what it amends.

**A `GITHUB_TOKEN` push triggers no further workflows**, which is what keeps this from being able to
start a loop with the lane that produced the sheet.

**It rebases rather than forcing.** The checkout is minutes old and a rejected push means something
else landed while the owner was reading — a thing to retry onto, never to overwrite.
