---
status: constraint
date: 2026-08-26
reversal: Reversing it cannot restore the argument prose the collapse deletes from `DESIGN.md`, `README.md`'s status paragraph and `GOAL.md` §4, and its no-renumbering corollary is load-bearing for section citations in `close-gate.ts`, `verify.yml`, `gauntlet-hook.mjs` and several ADRs that would all silently resolve to the wrong section.
---

# DESIGN.md carries no lane status; a shipped lane collapses to its six-field contract

A lane's status is the shape of its section, and nothing else. A section written as a contract is shipped; one still carrying design prose is unbuilt. No status marks, no scorecard — **the collapse is the edit that ships it**, so nothing is updated when a lane ships.

A shipped lane collapses to six fields: Fires on, Refuses, Cost, Sees, **Binds**, Lives in. Binds is new — the facts another lane's design must obey (a venue budget, a bypassability, a cap). Every sentence arguing why a shipped lane was built that way dies with it; a fact living only inside the argument moves into Binds or becomes an ADR first.

**Rejected:** a status mark — a manifest of one; three status passages had already rotted, and nothing machine-reads them.

**Accepted cost.** Removed section numbers are never reused, because `DESIGN.md` sections are cited from ADRs, workflow files and code.
