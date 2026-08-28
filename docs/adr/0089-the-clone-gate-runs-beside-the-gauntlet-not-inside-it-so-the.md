# The clone gate runs beside the gauntlet, not inside it, so the turn-end venue never pays for it

Recorded 2026-08-28.

`docs/agents/clone-gate.md` rule 6 puts the clone gate in the `test` and `all` slots and in CI, and
keeps it out of `stop`. Here those are the same command: `stop` is `bin/gauntlet stop`, and every
gauntlet venue above `turn` runs whatever the `test` slot names — so wiring the gate into `npm test`
would have put a two-second token scan on the end of every turn, which is the tax rule 6 exists to
refuse.

So the gauntlet is not the gate's scheduler at any venue. `bin/gauntlet` exports `GAUNTLET_VENUE`
into the test command, `bin/clone-gate` declines when it sees it, and the gate is run once each by
`npm run check` (the `all` slot, which `.husky/pre-push` now invokes in place of `bin/gauntlet push`)
and by a step of its own in `.github/workflows/verify.yml`. Amends [ADR-0010](0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md)
only in the sense it already allowed for: this is the first check whose budget stops it at `push`.

## Consequences

`bin/gauntlet push` on its own is no longer the whole push gate — `npm run check` is. A venue that
means to gate a push has to say `npm run check`, and the two CI steps that discriminate the
gauntlet's exit 1 from its exit 2 keep working on the gauntlet half only.
