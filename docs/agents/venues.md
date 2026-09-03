# Venues

A venue is a place a check can run. A check sits at the earliest venue that can afford it
([ADR-0010](../adr/0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md)), because what
"earliest" buys is the cost of the *repair*: a type error caught in the turn that caused it is fixed
with the context still hot. `bin/gauntlet <venue>` is the one runner for the three local venues, and
what it runs is whatever `.claude/contract.json` names
([ADR-0056](../adr/0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md)) — an
enrolled repository is checked by the same runner against its own contract
([ADR-0139](../adr/0139-an-enrolled-repository-is-checked-by-the-machine-s-gauntlet.md)), and may
carry a slot as `null` to shrink the gate, never add one to grow it.

| Venue  | Fires at              | Slots                                                              | On failure                          |
| ------ | --------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `turn` | PostToolUse, per edit | `typecheck`, `lint_one` and `test_related` on the edited file      | Hands the report back to Claude     |
| `stop` | Stop, per turn end    | `typecheck`, `lint_one` and `test_related` on files changed since HEAD | Reports once, never holds the turn |
| `push` | pre-push              | `typecheck`, `lint`, `test`, `clones` — once each                  | **Refuses the push**                |
| CI     | `push: main`, dispatch | `npm run check`, which is the push venue against the target       | Red run; rings the fixer            |

Slots inside a venue run concurrently, so a venue's wall clock is its slowest slot's. A non-zero
slot is red; there is no other verdict, and no venue refuses on a duration
([ADR-0148](../adr/0148-timing-is-recorded-never-judged.md)).

Only `push` and CI fail closed. The two in-session venues cannot refuse and are not meant to:
PostToolUse fires after the edit has landed, and a venue that wedges every turn is worse than the
defect it was catching. `.claude/hooks/gauntlet-hook.mjs` owns that half; `.husky/pre-push` and
`.github/workflows/verify.yml` own the other.

The gate is a constant: `.claude/gate-size.test.ts` sums the line count of the files above and fails
when it grows past the total recorded there (#360).
