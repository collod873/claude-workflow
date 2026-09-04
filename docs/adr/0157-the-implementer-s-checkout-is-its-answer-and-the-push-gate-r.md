---
status: constraint
date: 2026-09-04
reversal: Putting `files` back in the implementer's schema returns the six minutes a run spent retyping 100KB it had already written, re-loses the deletion #357 asked for, and hands the push gate back to a model that ran it three times at 95 seconds each on #342 and still handed husky a red tree.
---

# The implementer's checkout is its answer, and the push gate runs once in the wire with one repair round

Measured on three runs, a third of the model's wall clock went to retyping files into its answer and running `npm run check` — a verdict that never counted, because husky ran the gate again on push. The schema could not say "delete", so #357 landed a stub a human removed.

So the wire reads `git status` after the answer, as the fixer does (ADR-0121), and the model returns only its summary and out-of-brief reads. The model iterates against the turn-end venue, not the whole gate. The wire runs it once; red resumes the same session with the output, once. Still red, the branch is pushed and the owner told, because verify and the fixer already exist for a red pull request and a paid run's work is never discarded.

**Rejected:** a fresh repair agent, which re-pays orientation and does not know why the choices were made.
