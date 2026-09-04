---
status: constraint
date: 2026-09-04
amends: ADR-0133
reversal: Reversing it means teaching the acceptance and fixer lanes to read a runner out of
  `.claude/contract.json` and report failures per runner. Getting back means rediscovering, from a
  target whose tests never ran, that the machine writes the tests it then has to run.
---

# An enrolled target runs vitest under a config of its own

The acceptance lane authors `test.fails` tests and runs them; the fixer lane re-runs them. Both
spawn vitest. Neither can spawn a runner it does not know how to read a failure out of, so
enrolment has always required vitest without saying so, and `.claude/contract.json`'s nullable
runner slots implied otherwise.

Worse, a target with no config of its own does not run bare: vitest climbs out of the checkout and
takes the machine's config from the directory above, so the canary's target ran under the
machine's setup files and failed to collect a test it had just written.

So the target's own config is the requirement, and the run names it explicitly. A target without
one is refused by name, rather than silently borrowing whatever config sits above it.
