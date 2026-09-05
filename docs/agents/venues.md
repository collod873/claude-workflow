# Venues

A venue is a place a check can run. A check sits at the earliest venue that can afford it
([ADR-0010](../adr/0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md)), because what
"earliest" buys is the cost of the *repair*: a type error caught in the turn that caused it is fixed
with the context still hot. `bin/gauntlet <venue>` is the one runner for the three local venues, and
what it runs is whatever `.claude/contract.json` names
([ADR-0056](../adr/0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md)): an
enrolled repository is checked by the same runner against its own contract
([ADR-0139](../adr/0139-an-enrolled-repository-is-checked-by-the-machine-s-gauntlet.md)), and may
carry a slot as `null` to shrink the gate, never add one to grow it.

| Venue  | Fires at              | Slots                                                              | On failure                          |
| ------ | --------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `turn` | PostToolUse, per edit | `typecheck`, `lint_one` and `test_related` on the edited file      | Hands the report back to Claude     |
| `stop` | Stop, per turn end    | `typecheck`, `lint_one` and `test_related` on files changed since HEAD | Reports once, never holds the turn |
| `push` | pre-push              | `typecheck`, `lint`, `test`, `clones`, once each                  | **Refuses the push**                |
| CI     | `push: main`, dispatch | `npm run check`, which is the push venue against the target       | Red run; rings the fixer            |

Slots inside a venue run concurrently, so a venue's wall clock is its slowest slot's. A non-zero
slot is red; there is no other verdict, and no venue refuses on a duration
([ADR-0148](../adr/0148-timing-is-recorded-never-judged.md)). One `push` gate runs per machine:
`bin/gauntlet push` waits on `/tmp/gauntlet-push.lock` (`GAUNTLET_LOCK` overrides it) before it
reads a contract, so N lanes are one gate running and N−1 queued, never N gates' workers at once
([ADR-0162](../adr/0162-one-push-gate-runs-per-machine-so-lane-fan-out-queues-instea.md)). The
wait is only wall-clock; a gate inside a gate runs straight through, and `turn` never waits.

Only `push` and CI fail closed. The two in-session venues cannot refuse and are not meant to:
PostToolUse fires after the edit has landed, and a venue that wedges every turn is worse than the
defect it was catching. `.claude/hooks/gauntlet-hook.mjs` owns `turn`; the machine-global
`stop-gate.py` owns `stop`, running the contract's `stop.cmd` with a breaker, a liveness deferral
and its own run row, so nothing registered inside this checkout may run that suite a second time.
`.husky/pre-push` and `.github/workflows/verify.yml` own `push` and CI.

`push` fails closed all the way down: a gauntlet that cannot run its checks refuses the push rather
than waving it through, because unlike a hook mid-turn there is a human here who can fix it, and the
next thing downstream is `main`. The hook is one line: `npm run check`, the `all` slot of
`.claude/contract.json`, which is the full green gate in one spelling. It installs itself, because
`"prepare": "husky"` plus `npm ci` gives the runner and every fresh clone the hook with nobody
remembering a setup step; that is the whole reason a venue here is worth having, since it makes an
agent's pushes meet the gate the owner's do. `--no-verify` still skips it, and that gap is accepted
rather than open: branch protection would close it and the purchase is declined
([ADR-0071](../adr/0071-branch-protection-is-declined-so-move-10-retires-and-its-cou.md)). Lane 05
is the one caller that uses it on purpose: its wire has already run the same gate on the same tree
and decided to push red work anyway rather than lose it
([ADR-0157](../adr/0157-the-implementer-s-checkout-is-its-answer-and-the-push-gate-r.md)).

The gate is a constant: `.claude/gate-size.test.ts` sums the line count of the files above and fails
when it grows past the total recorded there (#360).
