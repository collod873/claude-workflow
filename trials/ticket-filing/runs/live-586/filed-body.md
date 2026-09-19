## What to build

`repoTopLevel()` in `.Workflow/agent-workflows/shared/render-body.ts` reads the repository's
top-level entries, and `validatePathsAreRooted` refuses any claim whose first segment is not one of
them. The slicer never sees that set. Item 7 of
`.Workflow/agent-workflows/to-tickets/slice/prompt.md` teaches the rule in prose instead, down to a
hand-typed sample of the answer: "A path is rooted when its first segment is a top-level entry of
the repository (`.Workflow`, `docs`, `bin`, `.github`, ...)". One rule, written twice, and only one
of the two copies is computed.

Carry the resolution. Export `repoTopLevel` from `render-body.ts`, hand its entries to the slice
stage as a `REPO_ROOTS` var in the slice stage's `buildVars` in
`.Workflow/agent-workflows/to-tickets/to-tickets.ts`, and name `{{REPO_ROOTS}}` in item 7 in place
of the definition and its sample. `substitute` in `.Workflow/agent-workflows/shared/stage.ts`
throws on a placeholder no var covers, so the prompt and the vars cannot fall out of step once the
placeholder is there.

Item 10 of the same prompt has already had this done to it: the claim ceiling now reads as
`claimLimit` in `.Workflow/agent-workflows/shared/ticket-shape.rules.json` rather than spelling the
number. Item 7 is the same defect one rung further along, because the slicer can be handed the
answer and not merely told where it lives.

What stays out: the roots carried are the publisher's own set, `node_modules` and `.git` included,
because a filtered list would be a second definition of rooted and the drift starts again. The
other half of the ruling, that a stage with no budget receives nothing new, is not this ticket:
to-tickets is metered in wall clock by `laneBudget`, and what this carries is one directory
listing.

The reasoning behind the rule this ticket applies is #586. The prose item 7 loses is a restatement,
and deleting it in the change that places the rule is ADR-0193.

## Why

The owner asked for the ruling on #586 and took it:

> What are the right answers and why?

Carry resolutions, rediscover judgments. A resolution is something a machine has already turned
from ambiguous into determinate; a judgment is something a reader has to form, and carrying one
substitutes an upstream reader for a downstream one, which is the independence lane 04 and lane 05
are built on (ADR-0118). Repo roots are a resolution: the publisher computes them, and the slicer
is left inferring them from four examples.

Then, on how to file it:

> Yes but you'll also need failing tests on each that are red and switched to green right

Both criteria are named by `test.fails(` lines in
`.Workflow/agent-workflows/to-tickets/carried-roots.test.ts`, which lands green and is authored
with this filing rather than by lane 04 later, with no context (ADR-0150, ADR-0159).
Neither criterion passes today: a run that turns no test green counts nothing, so each stays red
until the implementer drops `.fails` and the carriage is real. Flipping the marker alone does not
buy it, because both tests fail against today's prompt when run as ordinary tests.

## Acceptance criteria

- [ ] The prompt the slice stage is handed names every top-level entry of the repository, so the slicer reads the roots instead of inferring them - check: `npx vitest run .Workflow/agent-workflows/to-tickets/carried-roots.test.ts -t "#586.1"`
- [ ] The slice prompt states no definition of rooted, the restatement the carriage replaces - check: `npx vitest run .Workflow/agent-workflows/to-tickets/carried-roots.test.ts -t "#586.2"`

## Files claimed

- .Workflow/agent-workflows/shared/render-body.ts
- .Workflow/agent-workflows/to-tickets/to-tickets.ts
- .Workflow/agent-workflows/to-tickets/slice/prompt.md
- .Workflow/agent-workflows/to-tickets/carried-roots.test.ts
