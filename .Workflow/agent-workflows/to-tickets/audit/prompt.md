# Audit

Third and final stage turning a spec into tickets. Scope: this prompt, `CONTEXT.md`, the codebase checkout, and the references below.

## Rules you grade against

Read before grading:
- `.Workflow/agent-workflows/to-tickets/references/headless-gate.md`
- `.Workflow/agent-workflows/to-tickets/references/chain-shape.md`
- `.Workflow/agent-workflows/to-tickets/references/slicing-rules.md`
- `.Workflow/agent-workflows/to-tickets/references/output-contract.md`

## What to do

1. Read `CONTEXT.md` first. Use repository terms strictly as defined.
2. Read the spec: run `gh issue view {{ISSUE_NUMBER}} --json title,body --jq '.title + "\n\n" + .body'`.
3. Read the plan drafted by the slice stage:

```json
{{PLAN}}
```

4. Grade the plan against the four sizing calls:
   - **Granularity** — is every slice sized to one agent session? The chain-shape ladder ceiling is the test: a slice that grew past session size to dodge an edge fails this call.
   - **Edge correctness** — does every `dependsOn` reflect real overlap worked through the chain-shape ladder (`repartition -> extract -> edge`), matching the exact dependency graph?
   - **Merge/split candidates** — does each slice's `whyNotMerged` hold up? Merge unearned separations; split composite slices into distinct vertical slices.
   - **Balance** — is any slice a wall-clock outlier (roughly twice the size of the rest)? Split it if so.
5. Resolve every concern autonomously on your own recommendation: merge, split, re-edge, or re-word directly. If choosing to leave a concern unacted upon, record the explicit rationale as an unapplied flag in the grading notes.
6. Format the audited plan to the exact output contract: 1-based `dependsOn` referencing earlier positions only, technical scope only without issue lifecycle directives (`Closes`), and all fields shaped as `Slice` requires.

## Output

First, write grading notes covering what each of the four calls found, the changes made, and the rationale for any unapplied flags.

Then emit only a raw `<output>` block containing a JSON array of `Slice` objects — the audited plan:

Example:

Granularity: both slices fit one session individually, and the merged slice below still does.
Edge correctness: the sole edge in the input plan disappears along with the merge that caused it.
Merge/split candidates: slice 1's whyNotMerged argued a reader benefit that doesn't survive contact with the actual diff size — merged into slice 2.
Balance: the merged slice is not more than roughly twice the size of anything else in this batch.
Unapplied flag: slice 2's title undersells that it now also ships the seam: left as-is rather than renamed, since the body's What to build section already says so and a title rewrite here would cost more diff-review attention than it buys.

<output>[{"title":"Ship the injected GhExec seam, wired into its first real consumer","whatToBuild":"Add `GhExec` as an injected `(args: string[]) => string` executor around `gh`, wired into the publisher's first real write.","acceptanceCriteria":["`npm test` exits 0 with a test that injects a fake `GhExec` and asserts no test calls the real `gh` binary"],"filesClaimed":["shared/gh.ts","shared/publish-sub-issues.ts"],"seamsConsumed":[],"whyNotMerged":"It is the only slice left in this batch; there is nothing left to merge it into.","dependsOn":[]}]</output>
