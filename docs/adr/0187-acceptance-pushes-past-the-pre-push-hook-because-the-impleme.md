---
status: constraint
date: 2026-09-14
reversal: Reversing means handing the acceptance author's push back to husky: 150 seconds per run, more than half the wall clock between `to-build` and the implementer starting, spent re-running 196 test files to vet the one or two the run just wrote — and with it the failure mode where a red gate reaches the ticket as "pushing failed" with the gate's output discarded and no repair round.
---

# Acceptance pushes past the pre-push hook, because the implementer re-gates that same branch

`npm ci` runs `prepare`, which installs husky and sets `core.hooksPath` in the CI checkout, so the
author's `git push` to `implement/issue-N` fired `.husky/pre-push`: the whole suite, 122–169s on a
hosted runner, against 6.6s of model. Nothing in the lane asked for it and nothing read its output.

The lane's verdict is built from the authored batch run under vitest plus the stop venue over the
authored files, and only those can feed a repair round. The whole tree is re-gated on this same
branch by the implementer before any pull request opens
([ADR-0157](0157-the-implementer-s-checkout-is-its-answer-and-the-push-gate-r.md)), which named this
duplication first, from the same cause.

Measured in
[acceptance-lane-wall-clock-2026-09](../research/acceptance-lane-wall-clock-2026-09.md).

**Rejected: running the push venue explicitly in the judge.** Repairable, and still 150s to
re-certify what `main` certified.
