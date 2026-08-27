# Slice

Second of three stages turning a spec into tickets. Scope: this prompt, `CONTEXT.md`, the codebase checkout, and the references below.

## Rules you work to

Read before drafting:
- `.Workflow/agent-workflows/to-tickets/references/headless-gate.md`
- `.Workflow/agent-workflows/to-tickets/references/chain-shape.md`
- `.Workflow/agent-workflows/to-tickets/references/slicing-rules.md`
- `.Workflow/agent-workflows/to-tickets/references/output-contract.md`

## What to do

1. Read `CONTEXT.md` first. Use repository terms strictly as defined.
2. Read the spec: run `gh issue view {{ISSUE_NUMBER}} --json title,body --jq '.title + "\n\n" + .body'`.
3. Read the seam manifest produced by the seam-sweep stage:

```json
{{SEAM_MANIFEST}}
```

4. Draw the ticket graph: tracer-bullet vertical slices, each demoable on its own and sized to one agent session. Resolve file overlaps through the chain-shape ladder, and follow the six runner rules in the references.
5. Validate every acceptance criterion against the headless-checkability gate.
6. When a slice consumes a seam manifest entry, place that line verbatim in `seamsConsumed`. `filesClaimed` contains only file paths modified by the slice.
7. Give every slice one sentence in `whyNotMerged` justifying why it does not fold into its neighbour.
8. Follow the output contract for every field (`dependsOn` uses 1-based indexing of earlier positions only). `whatToBuild` and `acceptanceCriteria` define technical scope (issue lifecycle directives like `Closes` are handled externally).

## Output

Return your answer by calling the `StructuredOutput` tool. Its `slices` field is the plan: a JSON
array of `Slice` objects adhering to `.Workflow/agent-workflows/shared/plan-schema.ts`.

Write whatever reasoning you need first — only the tool call is read as your answer, so nothing
you say before it can corrupt it.

Example:

```structured-output
{"slices":[{"title":"Ship the injected GhExec seam, wired into the publisher","whatToBuild":"Add `GhExec` as an injected `(args: string[]) => string` executor around `gh`, and use it from the publisher's first real write.","acceptanceCriteria":["`npm test` exits 0 with a test that injects a fake `GhExec` and asserts no test calls the real `gh` binary"],"filesClaimed":["shared/gh.ts","shared/publish-sub-issues.ts"],"seamsConsumed":[],"whyNotMerged":"It ships the seam together with its first real consumer rather than standing alone as unused abstraction.","dependsOn":[]},{"title":"Wire blocked-by edges through the injected GhExec","whatToBuild":"Use the `GhExec` seam to wire native blocked-by edges after issue creation.","acceptanceCriteria":["`npm test` exits 0 with a test asserting each declared edge is wired through the fake `GhExec`"],"filesClaimed":["shared/publish-sub-issues.ts"],"seamsConsumed":["`GhExec` — an injected `(args: string[]) => string` executor around `gh` — shared/gh.ts — consumed by the publisher and every test that stands in for GitHub."],"whyNotMerged":"It is the edge-wiring behavior built on top of the seam the first slice ships, not the seam itself.","dependsOn":[1]}]}
```
