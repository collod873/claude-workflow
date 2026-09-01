---
status: constraint
date: 2026-08-27
reversal: Reversing means putting a `CONTEXT.md` read back into every to-tickets stage prompt, deleting the lane's `vocabulary.md` and the test pinning it, and giving up the property that makes the lane safe to run as a reusable workflow in a caller repo whose `CONTEXT.md` is another domain's glossary — a failure that produces plausible tickets and no error.
---

# A lane carries the vocabulary it works in rather than reading the repo's

No to-tickets stage reads `CONTEXT.md`. The lane owns `.Workflow/agent-workflows/to-tickets/vocabulary.md` — the six entries a slicing uses, copied verbatim — and every stage prompt takes it by `{{VOCABULARY}}` injection.

An instruction to read a file is something a model can decline, and ADR-0044 ruled an unread document cannot be detected; `runStage` throws on an uncovered `{{VAR}}` before spending model time, which makes the vocabulary a precondition rather than a request. And ADR-0055 ships each lane as a reusable workflow: in a caller repo `CONTEXT.md` is absent or another domain's glossary, and a stage told to use its terms strictly as defined would take that as authority on what a slice is — silently, producing tickets.

**Rejected:** trimming `CONTEXT.md`, whose other entries are load-bearing elsewhere; a shorter lane-owned file that is still read, since a deleted leaf fails open.

**Accepted cost.** `vocabulary.test.ts` pins the copy, in the repo that owns `CONTEXT.md`.
