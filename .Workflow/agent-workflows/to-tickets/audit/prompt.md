# Audit

Third and final stage turning a spec into tickets. Scope: this prompt, the vocabulary below, the codebase checkout, and the references below.

## The vocabulary you work in

Every term this lane uses, inlined here. Use them strictly as defined, and prefer them over the
near-synonyms each entry rejects. There is no glossary elsewhere to go and read — this is all of it.

{{VOCABULARY}}

## Rules you grade against

Read before grading:
- `.Workflow/agent-workflows/to-tickets/references/headless-gate.md`
- `.Workflow/agent-workflows/to-tickets/references/chain-shape.md`
- `.Workflow/agent-workflows/to-tickets/references/slicing-rules.md`
- `.Workflow/agent-workflows/to-tickets/references/output-contract.md`

## What to do

1. Read the spec: run `gh issue view {{ISSUE_NUMBER}} --json title,body --jq '.title + "\n\n" + .body'`.
2. Read the plan drafted by the slice stage:

```json
{{PLAN}}
```

3. Grade the plan against the four sizing calls:
   - **Granularity** — is every slice sized to one agent session? The chain-shape ladder ceiling is the test: a slice that grew past session size to dodge an edge fails this call.
   - **Edge correctness** — does every `dependsOn` reflect real overlap worked through the chain-shape ladder (`repartition -> extract -> edge`), matching the exact dependency graph?
   - **Merge/split candidates** — does each slice's `whyNotMerged` hold up? Merge unearned separations; split composite slices into distinct vertical slices.
   - **Balance** — is any slice a wall-clock outlier (roughly twice the size of the rest)? Split it if so.
4. Resolve every concern autonomously on your own recommendation: merge, split, re-edge, or re-word directly. If choosing to leave a concern unacted upon, record the explicit rationale as an unapplied flag in the grading notes.
5. Format the audited plan to the exact output contract: 1-based `dependsOn` referencing earlier positions only, technical scope only without issue lifecycle directives (`Closes`), and all fields shaped as `Slice` requires. Every acceptance criterion — the ones you carry over as much as the ones you re-word — ends `<what is observably true> — check: `<one command>``: an em dash, `check:`, one backtick-quoted command, nothing after it, on one line. The command must also be answerable from a checkout of the slice, not from the tracker — `gh api`, `gh issue`, `gh pr`, `gh run`, `curl`, and `wget` all read GitHub or the network rather than the tree, so they return the same verdict whether or not the diff exists, and the publisher refuses them just as it refuses an unparseable marker. The publisher refuses the whole plan over a criterion `bin/close-ticket` cannot run or that no diff could ever satisfy, so a criterion arriving in either wrong shape is yours to fix here rather than pass on.
6. Keep every slice's prose inside its ceilings, including slices you merge or re-word — the tool refuses a field that runs over: `whatToBuild` at most 400 characters, `whyNotMerged` at most 200, and each `acceptanceCriteria` entry at most 200. A merge that would push `whatToBuild` past its ceiling is evidence the separation was earned. There is no ceiling on how many files a slice claims or how many criteria it carries.

## Output

Return your answer by calling the `StructuredOutput` tool. It takes both halves of your answer:

- `notes` — your grading notes, covering what each of the four calls found, the changes made, and
  the rationale for any unapplied flags. These are read by a human in the run log, so write them
  as prose, with newlines where you want them.
- `slices` — the audited plan: a JSON array of `Slice` objects.

The notes go in the tool call, not before it. Only the tool call is read as your answer, so
anything written outside it is lost.

Example:

```structured-output
{"notes":"Granularity: both slices fit one session individually, and the merged slice below still does.\nEdge correctness: the sole edge in the input plan disappears along with the merge that caused it.\nMerge/split candidates: slice 1's whyNotMerged argued a reader benefit that doesn't survive contact with the actual diff size — merged into slice 2.\nBalance: the merged slice is not more than roughly twice the size of anything else in this batch.\nUnapplied flag: slice 2's title undersells that it now also ships the seam: left as-is rather than renamed, since the body's What to build section already says so and a title rewrite here would cost more diff-review attention than it buys.","slices":[{"title":"Ship the injected GhExec seam, wired into its first real consumer","whatToBuild":"Add `GhExec` as an injected `(args: string[]) => string` executor around `gh`, wired into the publisher's first real write.","acceptanceCriteria":["The publisher writes through an injected `GhExec` and no test reaches the real `gh` binary — check: `npx vitest run shared/publish-sub-issues.test.ts`"],"filesClaimed":["shared/gh.ts","shared/publish-sub-issues.ts"],"seamsConsumed":[],"whyNotMerged":"It is the only slice left in this batch; there is nothing left to merge it into.","dependsOn":[]}]}
```
