# A stage's answer is a structured-output tool call, not a block it hand-types

Recorded 2026-08-27.

Every stage in every lane returns its answer through `claude --json-schema`, whose JSON Schema is
derived from that stage's zod schema rather than written beside it. The API validates the tool
call before this process ever sees it, so a stage's answer can no longer be corrupted by the model
that is serialising it. Amends
[ADR-0012](0012-a-stage-s-output-block-is-the-outermost-span-and-the-payload.md), which ruled on how
to read an `<output>` block; there is no such block any more.

Run 33112792733 is what the old contract cost: 24 minutes and about a dollar slicing #145, killed by
one slip in slice 23 of 26 — the auditor ended a long `seamsConsumed` string and jumped straight to
`,"dependsOn"`, dropping the closing `]` and the whole `whyNotMerged` field with it. The other 25
slices were correct and the grading notes were good work, and all of it was discarded. Nothing
checked the 38KB of single-line JSON until the run was over and the model was gone.

## Considered options

- **Keep the block and add a repair pass.** Rejected. Repairing that bracket by hand makes the block
  parse and then fail schema validation on the missing field — the same slip, twice, and the second
  time with a guess layered on top. A repair pass is a second author for a payload that already has
  one too many.
- **Have the stage run `--validate-plan` on itself before finishing.** Rejected: it moves the check
  earlier but leaves it in the same place — inside the thing being checked. The model would still be
  grading its own transcript, and a stage that failed its own check has nothing to do about it.
- **A hand-written JSON Schema per stage.** Rejected outright, as
  [ADR-0056](0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md) rejects a
  hand-maintained contract file: a second copy is not wrong the day it is written, it is wrong the
  day the zod schema gains a field and nobody remembers the copy. zod v3 has no JSON Schema export,
  so this cost a `zod-to-json-schema` dependency — chosen over a zod v4 upgrade, which would have
  moved every schema file in the estate for a ticket that is not about zod.

## Consequences

**Every non-object root needs a wrapper, and that reaches the prompts.** A tool input schema must be
object-rooted — the API refuses anything else with
`tools.N.custom.input_schema.type: Input should be 'object'` — so `Plan` travels as `{"slices":…}`,
`SeamManifest` as `{"entries":…}`, and the shaper's discriminated union as `{"answer":…}`. Each of
the seven stage prompts shows the wrapped shape, and `prompt-skeleton.test.ts` checks those
skeletons against the wrapped schema rather than the domain one, because the wrapped schema is what
the model is actually handed.

**zod still runs on the way back, because JSON Schema cannot carry everything.** A `.refine()` has no
JSON Schema keyword behind it, so `SeamManifestEntry`'s no-newline rule is dropped by the derivation
and the API accepts an entry containing one. The API enforces the shape; zod enforces the rest. A
stage that trusted the API's validation to have been the whole check would have quietly widened its
own contract.

**The auditor's grading notes became a field.** They used to be the prose before the `<output>` tag,
recovered by splitting the raw response. A structured answer is a tool call, and this pipeline
discards the model's earlier turns, so untyped notes would simply have stopped reaching the run log.
They are now `notes` on the audit stage's answer — the one shape change this made to a domain
schema, and it is the change that keeps a capability rather than adding one.

**The failure surface is smaller but not gone.** Two refusals remain, both named: a run that produced
no structured output at all (the model never reached the tool — its `result` is prose, which parses
as nothing), and a value the API accepted that zod refuses. Both carry the offending response on the
error, so `preservingRaw` can still write it beside the handoff — #42's lesson, that a stage which
refuses a response and discards it costs whoever has to reproduce it, is untouched by this.

**Whether a schema mismatch retries in-session is still unknown.** The mechanism was verified against
CLI 2.1.247 — the tool is injected, the model calls it even when asked for prose, and all four of
this estate's derived schemas are accepted by the live API, the shaper's nested `anyOf` included. A
mismatch could not be forced from outside the model, so that behaviour was not observed. It does not
change what this code does: the checks above run whether or not the model was given a second chance
first.
