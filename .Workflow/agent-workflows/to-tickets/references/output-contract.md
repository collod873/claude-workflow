# The output contract

Every slice in a plan adheres to the `Slice` schema defined in `.Workflow/agent-workflows/shared/plan-schema.ts`.

A plan reaches the pipeline through the `StructuredOutput` tool the CLI injects from that schema, never as text in a message. The tool takes an **object**, because a tool input schema has to be object-rooted, so a plan travels as `{"slices": [...]}` — one or more `Slice` objects under `slices`. The audit stage's tool takes the same `slices` plus a `notes` string, its grading of the plan it was given.

Nothing outside the tool call is read as the answer. Reasoning written before it costs nothing and is discarded; the notes an auditor wants a human to see go in `notes`, not in prose.

- **`dependsOn` indexing**: 1-based indices naming earlier positions only (values strictly less than the slice's own 1-based index). Position 1 represents the first slice in the array.
- **`filesClaimed`**: Array of relative file paths modified by the slice. Set to `[]` when no files are claimed.
- **Technical scope only**: `whatToBuild` and `acceptanceCriteria` define implementation boundaries. Issue lifecycle directives (`Closes`) are handled by external automation.
