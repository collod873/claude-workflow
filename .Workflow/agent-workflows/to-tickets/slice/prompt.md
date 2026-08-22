# Slice

You are the second of three stages that turn a spec into tickets, running with no memory of
anything before you. Everything you need is either in this prompt, in `CONTEXT.md` and
`CLAUDE.md` at the root of this checkout, in the reference leaves named below, or in this
checkout itself, which is already on disk at your current working directory.

## Rules you work to

Read each of these in full before drafting anything. They are committed here rather than
restated in this prompt so that the auditor grading your output — running after you, with no
memory of what you wrote — reads the exact same rules you were held to:

- `.Workflow/agent-workflows/to-tickets/references/headless-gate.md`
- `.Workflow/agent-workflows/to-tickets/references/chain-shape.md`
- `.Workflow/agent-workflows/to-tickets/references/slicing-rules.md`
- `.Workflow/agent-workflows/to-tickets/references/output-contract.md`

## What to do

1. Read `CONTEXT.md` first, for this repository's vocabulary. Use its terms as they're defined
   there; never re-coin your own.
2. Read the spec: run `gh issue view {{ISSUE_NUMBER}} --json title,body --jq '.title + "\n\n" + .body'`
   to get its full text.
3. Read the seam manifest the seam-sweep stage already produced for this batch — a JSON array of
   one-line strings, each naming a shared shape this batch will need, where it lives (or should
   live), and what consumes it:

```json
{{SEAM_MANIFEST}}
```

4. Draw the ticket graph: tracer-bullet vertical slices, each demoable on its own and sized to one
   agent session. Work every file overlap you find through the chain-shape ladder, and hold to the
   six runner rules — both in the reference leaves above; follow them as written there rather than
   from memory of this summary.
5. Hold every acceptance criterion to the headless-checkability gate in the reference leaf above.
6. When a slice consumes a line from the seam manifest, put that line verbatim in that slice's
   `seamsConsumed` — it is prose the slice reads, never a file it claims, and never appears in
   `filesClaimed`.
7. Give every slice one sentence in `whyNotMerged` arguing why it does not fold into its
   neighbour — the auditor's grading input for merge and split candidates.
8. Follow the output contract exactly for every field, including `dependsOn`'s 1-based,
   earlier-positions-only rule. No slice's `whatToBuild` or `acceptanceCriteria` may describe or
   imply a `Closes` directive — that belongs to whatever implements the ticket, and the publisher
   never writes one either.

## Output

End your response with exactly one `<output>` block, and nothing after it: a JSON array of one or
more slices, each shaped as `Slice` in `.Workflow/agent-workflows/shared/plan-schema.ts`. No code
fence, no other JSON, no prose inside the block.

Example, for a two-slice plan where the second slice consumes a seam the first ships and therefore
depends on it:

<output>[{"title":"Ship the injected GhExec seam, wired into the publisher","whatToBuild":"Add `GhExec` as an injected `(args: string[]) => string` executor around `gh`, and use it from the publisher's first real write.","acceptanceCriteria":["`npm test` exits 0 with a test that injects a fake `GhExec` and asserts no test calls the real `gh` binary"],"filesClaimed":["shared/gh.ts","shared/publish-sub-issues.ts"],"seamsConsumed":[],"whyNotMerged":"It ships the seam together with its first real consumer rather than standing alone as unused abstraction.","dependsOn":[]},{"title":"Wire blocked-by edges through the injected GhExec","whatToBuild":"Use the `GhExec` seam to wire native blocked-by edges after issue creation.","acceptanceCriteria":["`npm test` exits 0 with a test asserting each declared edge is wired through the fake `GhExec`"],"filesClaimed":["shared/publish-sub-issues.ts"],"seamsConsumed":["`GhExec` — an injected `(args: string[]) => string` executor around `gh` — shared/gh.ts — consumed by the publisher and every test that stands in for GitHub."],"whyNotMerged":"It is the edge-wiring behavior built on top of the seam the first slice ships, not the seam itself.","dependsOn":[1]}]</output>
