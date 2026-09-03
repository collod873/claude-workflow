# Module boundaries

Three rules over `.Workflow/agent-workflows`, the only tree with lanes to keep apart. They live
in `.dependency-cruiser.cjs`; this page says what they mean.

1. **no-lane-to-lane**: a lane may not deep-import another lane. `shared/` is every lane's only
   legal crossing. Two lanes needing one fact means the fact moves into `shared/`, or rides an
   event or a published seam; it never means one lane reaching into the other.
2. **shared-no-lane**: `shared/` may never import a lane. A door does not reach back through the
   rooms it serves.
3. **no-circular**: no import cycles, anywhere in the tree.

Rules 1 and 2 read only production modules: a `*.test.ts` file may import another lane's subject
or fixture to exercise it, since the boundary is about what ships coupled, not what a test
reaches. Rule 3 applies to every file: a cycle through a test is still a cycle.

## How it runs

`npx depcruise --config .dependency-cruiser.cjs .Workflow/agent-workflows`, from `npm run lint`
(the `lint` script's wiring is a separate change). Every rule is an error, so one violation fails
the run. There is no baseline and nothing to regenerate: a violation is fixed at its source.
