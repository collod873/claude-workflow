---
status: constraint
date: 2026-08-27
reversal: Reversing means re-teaching all seven stage prompts to hand-type an output block, restoring the block parser and its span rules, unwrapping every derived schema, rewriting `prompt-skeleton.test.ts`, and dropping `zod-to-json-schema` — while re-accepting that one serialisation slip discards a whole 24-minute run, as it already did.
---

# A stage's answer is a structured-output tool call, not a block it hand-types

Every stage returns its answer through `claude --json-schema`, derived from that stage's zod schema rather than written beside it. The API validates the tool call, so an answer can no longer be corrupted by the model serialising it. There is no `<output>` block any more (ADR-0012).

Run 33112792733 is what the old contract cost: 24 minutes and about a dollar slicing #145, discarded because one slice of 26 dropped a bracket in 38KB of single-line JSON.

**Rejected:** a repair pass — a second author guessing at a payload that already has one too many; self-validation inside the stage being checked; a hand-written schema per stage, ADR-0056's second copy that goes wrong the day zod gains a field.

**Accepted cost.** Tool inputs must be object-rooted, so non-object roots travel wrapped and the prompts show the wrapped shape; zod still runs on the way back, since `.refine()` has no JSON Schema keyword.
