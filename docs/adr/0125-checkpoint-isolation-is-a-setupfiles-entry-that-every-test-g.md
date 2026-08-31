# Checkpoint isolation is a setupFiles entry that every test gets, not a helper every test file remembers to call

Recorded 2026-08-31.

`isolate-checkpoints.setup.ts` is wired into `vitest.config.ts`'s `setupFiles` and gives **every test
in the suite** its own `CHECKPOINTS_DIR`, from a `beforeEach` it registers itself. The exported
`isolateCheckpointsPerTest` helper and the eighteen test files that imported it are gone.

## Why

`runStage` consults a real on-disk checkpoint before it spawns — `<stage>.json` under
`CHECKPOINTS_DIR`, keyed on `sha256(HEAD + "\0" + the substituted prompt)`. On a key hit it returns
the stored response through `output.parse` and never calls `exec`. So two tests that share a commit
and a prompt share an answer, and the one that loses gets a verdict its own fake `StageExec` never
produced, with every in-memory collaborator it injected sitting untouched and innocent.

#272 built the isolation and stopped one file short of wiring it. `vitest.config.ts` is in
`IMMUTABLE_SET`, so the lane that built it could not touch the one file the setup was written for —
its own doc comment says *"Vitest `setupFiles` entry"* — and the isolation shipped as an exported
helper each test file called in its own `beforeEach`, with its own paragraph re-explaining the same
hazard. Eighteen files did. `ratify/ratifier.test.ts` did not.

#299 is what that costs. Two of its tests render a byte-identical ratifier prompt; at one commit
that is one key and one `ratifier.json`, so whichever ran last wrote the file and the other read
that verdict back on the next run. The report called it flaky and blamed module state in `ratify/`.
It was neither: it is deterministic per commit — the next commit changes every key at once and the
suite goes green — and the state was a file on disk one directory over. A failure that looks
intermittent and cannot be reproduced from the code it points at is how a repo learns to re-run its
gauntlet until it passes.

## Considered options

- **Add the missing `beforeEach` to `ratifier.test.ts`.** Rejected as the whole fix. It repairs one
  file and leaves the mechanism that produced it: a convention eighteen files remember and the
  nineteenth forgets is not a mechanism, it is a lottery with good odds.
- **A gate that scans test files for the call.** Rejected. It needs to decide which test files
  transitively reach `runStage`, which is an import-graph question with no cheap honest answer — and
  it buys a check on a convention that the `setupFiles` entry removes the need for entirely.
- **Isolate once per test *file* rather than per test.** Rejected: #299's two tests are in one file.
  Two tests in one file sharing a prompt is the *normal* case here, because a test file drives one
  lane against one set of fixtures.
- **Keep both the helper and the global hook.** Rejected — two mechanisms for one job, and no
  reader can tell which one is load-bearing.

## Consequences

**It cost a hand batch, and that is the point of recording it.** `vitest.config.ts` is immutable to
every pull request, so this landed by the owner directly, the way #201 did. The pipeline cannot
build this class of fix for itself; a ticket that needs one has to say so.

**Every test in the repo now gets a `CHECKPOINTS_DIR`, including the ~1,600 that have never heard of
a stage.** The cost is a string join per test — the per-test directory is not created, because
everything that writes a checkpoint `mkdirSync`es its parent and everything that reads one fails
open when it is absent.

**The guard is a test, not an assertion about the config.** `shared/stage.test.ts` ends with two
`it` blocks that render one prompt for one stage with different canned answers, which is #299's pair
reproduced deliberately. They go red if the entry is removed, or if the isolation is ever weakened
back to per-file. Asserting on `vitest.config.ts`'s text instead would be the unsatisfiable shape
[ADR-0120](0120-an-acceptance-test-may-not-turn-on-a-file-no-pull-request-ma.md) refuses.
