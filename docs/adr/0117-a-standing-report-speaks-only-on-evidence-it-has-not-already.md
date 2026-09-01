---
status: constraint
date: 2026-08-31
amends: ADR-0099
reversal: Undoing it removes the novelty check and the recovery-evidence retirement from `run-watchdog.ts`, restores its early return ahead of `gh issue list`, and re-licenses every standing counter — `lost-dispatch-counter.ts`, `unreachable.ts` — to re-assert what its own issue already cites, which is the per-mechanism re-derivation this ruling exists to end.
---

# A standing report speaks only on evidence it has not already cited, and retires only on evidence its subject recovered

A mechanism that collapses many occurrences into one standing issue may comment on it only with evidence the issue does not already cite, recomputed from the issue's own body and comments — no cursor, no ledger. And a standing report retires only on evidence its subject **recovered**, never on the absence of evidence that it failed; a sweep that clipped its window retires nothing.

Commenting every sweep reaches the same destination as an issue per run: #252 carried two `Still dead` comments citing the same run. Retirement needs a different answer from ADR-0099's because the watchdog answers over a window, not a query: zero dead runs also describes a lane nobody triggered, so it requires a run of that workflow file, in the window, that executed something.

**Rejected:** retiring on absence, which turns an untriggered lane into a working one; leaving retirement to a human; a stored cursor.
