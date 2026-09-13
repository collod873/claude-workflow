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

## The estate is a registry, not a directory to read back

Depcruise sees imports, so rule 2 says nothing about a `shared/` module that opens
`.github/workflows/*.yml` and parses a lane's wiring back out of it. That reach is the same
crossing by another door, and it is closed: `shared/lane-wiring.ts` **is** the estate, and
`npm run lane-wiring` emits every reusable workflow and every Stub from it. A `shared/` module
that needs a lane's doors, entrypoints, wires, labels or grants asks the registry
(`laneFacts`, `LANE_WIRING`); it does not read the YAML. `shared/lane-map.ts` still walks a
lane's TypeScript, which is a read of what the lane's code does at runtime rather than of how it
is wired, and is the one reach left.

Editing `.github/workflows` by hand is therefore never the change: edit the registry, run
`npm run lane-wiring`, and commit what it writes. `shared/lane-emit.test.ts` fails the estate
that disagrees.

## How it runs

`npx depcruise --config .dependency-cruiser.cjs .Workflow/agent-workflows`, from `npm run lint`.
Every rule is an error, so one violation fails
the run. There is no baseline and nothing to regenerate: a violation is fixed at its source.
