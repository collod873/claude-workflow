# The output contract

Every slice in a plan adheres to the `Slice` schema defined in `.Workflow/agent-workflows/shared/plan-schema.ts`.

A full plan is a JSON array of one or more `Slice` objects.

- **`dependsOn` indexing**: 1-based indices naming earlier positions only (values strictly less than the slice's own 1-based index). Position 1 represents the first slice in the array.
- **`filesClaimed`**: Array of relative file paths modified by the slice. Set to `[]` when no files are claimed.
- **Technical scope only**: `whatToBuild` and `acceptanceCriteria` define implementation boundaries. Issue lifecycle directives (`Closes`) are handled by external automation.
