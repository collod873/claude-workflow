---
status: constraint
date: 2026-09-05
reversal: Undoing this puts the machine's own layout back in the machine's code, so the acceptance lane refuses every batch it authors against a target whose tests are not `.test.ts` under `.Workflow/` — a full author round and a repair round spent before the refusal, per ticket.
---

# A target's suite roots and test suffixes are read from the target's own vitest, never assumed to be the machine's

Enrolment already requires the target to carry its own vitest config
([ADR-0156](0156-an-enrolled-target-runs-vitest-under-a-config-of-its-own.md)), and that config is
the only honest answer to *where does a test live here*. So `shared/suite-layout.ts` asks it —
`vitest list --filesOnly` under the target's own config — and derives the roots and the suffixes
from what comes back. A checkout with no config to ask falls back to the tree: every directory
holding a test is a root.

Nothing downstream names a tree or a suffix. The acceptance author is told its target's, and this
repository's own fixture and linter rules ride in a separate file it is handed only when the target
is this repository.

**Rejected: a `suite` block in `.claude/contract.json`.** A second place to state what the runner
already states, and one more file for every enrolled repository to get wrong.
