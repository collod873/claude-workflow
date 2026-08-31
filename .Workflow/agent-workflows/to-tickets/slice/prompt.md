# Slice

Second of three stages turning a spec into tickets. Scope: this prompt, the vocabulary below, the codebase checkout, and the references below.

## The vocabulary you work in

Every term this lane uses, inlined here. Use them strictly as defined, and prefer them over the
near-synonyms each entry rejects. There is no glossary elsewhere to go and read — this is all of it.

{{VOCABULARY}}

## Rules you work to

Read before drafting:
- `.Workflow/agent-workflows/to-tickets/references/headless-gate.md`
- `.Workflow/agent-workflows/to-tickets/references/chain-shape.md`
- `.Workflow/agent-workflows/to-tickets/references/slicing-rules.md`
- `.Workflow/agent-workflows/to-tickets/references/output-contract.md`

## What to do

1. Read the spec: run `gh issue view {{ISSUE_NUMBER}} --json title,body --jq '.title + "\n\n" + .body'`.
2. Read the seam manifest produced by the seam-sweep stage:

```json
{{SEAM_MANIFEST}}
```

3. Draw the ticket graph: tracer-bullet vertical slices, each demoable on its own and sized to one agent session. Resolve file overlaps through the chain-shape ladder, and follow the six runner rules in the references.
4. Wave 0 — the unblocked root, every slice you draw with no `dependsOn` — is a tracer: it has to trace the thinnest possible end-to-end path through every layer the work touches, stubs expected wherever a full implementation would cost the wave its thinness. Wave 0 is never a wiring slice that only connects layers with nothing behind them, and it is never a bare seam slice that ships an abstraction with no consumer proving it end-to-end.
5. Validate every acceptance criterion against the headless-checkability gate, and write each one in the shape the closer parses:

   ```
   <what is observably true> — check: `<one command>`
   ```

   An em dash, the word `check:`, then exactly one backtick-quoted command and nothing after it, all on one line. `bin/close-ticket` runs that command to decide whether the ticket may close, and it reads nothing else — a bare command, a command outside backticks, two commands, or trailing prose all read as "no check", and a ticket where nothing parsed is refused rather than closed. The command must also be answerable from a checkout of the slice: it has to read the tree, not the tracker. `gh api`, `gh issue`, `gh pr`, `gh run`, `curl`, and `wget` read GitHub or the network instead of the working directory, so they return the same verdict whether or not the diff exists, and the publisher refuses them too — a criterion asserting that something ran in production belongs in the PRD, not here. The publisher refuses the whole plan before it files anything, so a slice carrying one unreadable or unanswerable criterion costs the run.
6. When a slice consumes a seam manifest entry, place that line verbatim in `seamsConsumed`. `filesClaimed` contains only file paths modified by the slice.
7. Root every path you name. `filesClaimed` carries the full path from the repository root, always — `.Workflow/agent-workflows/shared/stage.ts`, never `shared/stage.ts`. In `whatToBuild` and the acceptance criteria you may abbreviate a path the same slice claims in full, but a path that appears nowhere in `filesClaimed` has to be spelled from the root, directories included: `checkpoints/` says nothing about where it is rooted, and the publisher refuses the whole plan for it. Two independent runs read this ticket and neither can ask the other or see the other's work — the acceptance author turns it into tests, the implementer turns it into code — so a path you leave relative is a decision you have handed to both of them, and they are not obliged to answer it the same way. When that happens the implementation goes red against tests written to a different reading, and the only signal anyone downstream gets is a failing test that looks exactly like bad code.
8. Give every slice one sentence in `whyNotMerged` justifying why it does not fold into its neighbour.
9. Follow the output contract for every field (`dependsOn` uses 1-based indexing of earlier positions only). `whatToBuild` and `acceptanceCriteria` define technical scope (issue lifecycle directives like `Closes` are handled externally).
10. Keep the prose inside its ceilings — the tool refuses a field that runs over, so aim under them rather than at them: `whatToBuild` at most 400 characters, `whyNotMerged` at most 200, and each `acceptanceCriteria` entry at most 200. There is no ceiling on how many files a slice claims or how many criteria it carries; claim every file the slice modifies.

## Output

Return your answer by calling the `StructuredOutput` tool. Its `slices` field is the plan: a JSON
array of `Slice` objects adhering to `.Workflow/agent-workflows/shared/plan-schema.ts`.

Write whatever reasoning you need first — only the tool call is read as your answer, so nothing
you say before it can corrupt it.

Example:

```structured-output
{"slices":[{"title":"Ship the injected GhExec seam, wired into the publisher","whatToBuild":"Add `GhExec` as an injected `(args: string[]) => string` executor around `gh` in `shared/gh.ts`, and use it from the publisher's first real write.","acceptanceCriteria":["The publisher writes through an injected `GhExec` and no test reaches the real `gh` binary — check: `npx vitest run .Workflow/agent-workflows/shared/publish-sub-issues.test.ts`","`GhExec` is exported — check: `grep -q 'export type GhExec' .Workflow/agent-workflows/shared/gh.ts`"],"filesClaimed":[".Workflow/agent-workflows/shared/gh.ts",".Workflow/agent-workflows/shared/publish-sub-issues.ts"],"seamsConsumed":[],"whyNotMerged":"It ships the seam together with its first real consumer rather than standing alone as unused abstraction.","dependsOn":[]},{"title":"Wire blocked-by edges through the injected GhExec","whatToBuild":"Use the `GhExec` seam to wire native blocked-by edges after issue creation.","acceptanceCriteria":["Each declared edge is wired through the fake `GhExec` — check: `npx vitest run .Workflow/agent-workflows/shared/publish-sub-issues.test.ts`"],"filesClaimed":[".Workflow/agent-workflows/shared/publish-sub-issues.ts"],"seamsConsumed":["`GhExec` — an injected `(args: string[]) => string` executor around `gh` — shared/gh.ts — consumed by the publisher and every test that stands in for GitHub."],"whyNotMerged":"It is the edge-wiring behavior built on top of the seam the first slice ships, not the seam itself.","dependsOn":[1]}]}
```
</output>
