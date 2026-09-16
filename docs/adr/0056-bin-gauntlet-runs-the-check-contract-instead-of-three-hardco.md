---
status: constraint
date: 2026-08-26
reversal: Hardcoding the checks again means `bin/gauntlet` naming `tsc`, `eslint` and `vitest` itself, every enrolled repository with another linter or no Node suite falling out of the gate, and `.claude/contract.json` losing the only reader that proves its commands still run.
---

# bin/gauntlet runs the check contract instead of three hardcoded tools

`bin/gauntlet <venue>` runs the slots `venue-slots.json` names for that venue, and each slot's
command is whatever the target's `.claude/contract.json` says. The gauntlet names no tool of its
own. A slot the contract lacks is skipped, so a repository can shrink its gate but never grow it.

The third hardcoded tool was a vendor choice, not a check category: a TypeScript repository linting
with biome could never pass. Running the contract also gives the file its reader, since a slot
naming a dead command fails at every venue that runs it.

A slot names a check a reader can run, never a hook entry point: a hook takes its payload on stdin,
so run bare it exits 0 having checked nothing. `why` names a declaration site, such as
`package.json#scripts.test`, never a measurement that rots.

**Rejected: hardcoding `tsc`, `eslint` and `vitest`.** One of nine surveyed repositories could run
the gauntlet at all.
