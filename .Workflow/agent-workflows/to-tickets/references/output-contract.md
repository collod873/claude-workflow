# The output contract

Every slice in a plan is shaped exactly like `Slice` in
`.Workflow/agent-workflows/shared/plan-schema.ts`:

```ts
const Slice = z.object({
  title: z.string().min(1).max(200),
  whatToBuild: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  filesClaimed: z.array(z.string()),          // may be empty; empty renders as "None — no files."
  seamsConsumed: z.array(z.string()),         // manifest lines this slice consumes, verbatim
  whyNotMerged: z.string().min(1),            // one sentence, the auditor's input
  dependsOn: z.array(z.number().int().positive()).default([]),  // 1-based, EARLIER positions only
});
```

A full plan is a JSON array of one or more slices in that shape.

- **`dependsOn` is 1-based**, and every entry names an **earlier** position in the array — never
  its own position, never a later one. Position 1 is the first slice in the array.
- **An empty `filesClaimed` renders as `- None — no files.`** in the published ticket body — never
  an empty list left to render as nothing, and never a placeholder string written into the field
  itself. The sentinel is the publisher's rendering, not something a stage writes.
- **No ticket body carries a `Closes` directive**, in this stage's output or the auditor's.
  Closing a ticket belongs to whatever implements it; closing the PRD belongs to the merged PR.
