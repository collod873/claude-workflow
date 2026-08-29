# An expected-red acceptance test is not a local finding, so the gauntlet's test slot stops at the code suite

Recorded 2026-08-29.

Amends: ADR-0010

`package.json#scripts.test` — the command `.claude/contract.json`'s `test` slot names, and so the
command every `bin/gauntlet` venue runs — is now `vitest run .Workflow .claude`. `tests/acceptance/`
is judged where it can be judged: `acceptance/push-gate.ts` at landing, and `verify.yml`'s
`restore-and-run-acceptance` job per dispatched slice. `npm run test:acceptance` runs the directory
on demand.

## What went wrong

Lane 04 landed `tests/acceptance/242-adr-amends-0096.test.ts` on `main` at 2026-08-29T20:50Z, for a
slice nothing had built yet. From that moment `bin/gauntlet stop` failed at every turn-end and
`bin/gauntlet push` refused every push, on one red test asserting an ADR that does not exist. The
owner was locked out of his own repository by a gate reporting, correctly, that undelivered work is
undelivered.

The window is normally minutes — lane 04 lands a slice's test and lane 05 starts building it. PRD
#233 stalled between those two lanes, and the window stayed open for an hour.

## Why this is a venue error and not a weakened gate

Two places in this repo already rule that a red acceptance test is the expected state:

`vitest.config.ts`: *"An acceptance test is expected to be red until the ticket it names is built,
which is what makes it an acceptance test rather than a report on working code — so a red `npm test`
here is the suite doing its job, and the venue that decides whether one may land is
`acceptance/push-gate.ts`, not this list."*

`acceptance/push-gate.ts`: a test that collected and failed with an `AssertionError` *"ran against
the real subject and found it wanting — expected, for a test written before the ticket that
satisfies it."* That gate refuses only the other shape, a test that never collected.

The gauntlet made no such distinction. It read every red the same way, which meant the one venue
with no way to tell "your code is broken" from "this work is not built yet" was the venue holding
the owner's keyboard. ADR-0010 puts a check at the earliest venue that **can run it**; the local
venues can run this test but cannot judge it, and a check that cannot be judged where it fires is
not an early check, it is a stuck one.

Nothing is skipped. The set of things that judge `tests/acceptance/` is unchanged — it never
included the gauntlet's verdict as a decision-maker, only as a side effect of `vitest run` with no
argument.

## What this costs

An acceptance test for a slice already delivered stops being re-run on every local push. Its
protection now comes from `verify.yml`'s per-slice job at the time that slice is dispatched, and from
the code suite thereafter. That is a real reduction in how often a delivered criterion is
re-asserted, accepted deliberately: the alternative on offer was teaching the gauntlet
`push-gate.ts`'s `AssertionError` classification, which buys back the coverage at the price of a
second copy of that judgement living in bash.

## Amends

ADR-0010 said a check sits at the earliest venue that can afford it. This adds the second half it
assumed: and that can act on the answer.
