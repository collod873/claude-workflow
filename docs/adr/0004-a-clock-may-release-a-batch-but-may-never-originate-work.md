---
status: constraint
date: 2026-08-23
reversal: Reversing it re-opens `schedule:` triggers across the workflow set and forces every recurring reader in the design — spec-drift, decision-consistency, coupling, transcript audit, the governor — to have its event trigger re-derived, in machinery like `dispatch/reconcile.ts` and `ratify/scope.ts` that was written to have no clock in it at all.
---

# A clock may release a batch, but may never originate work

No mechanism fires because time passed. A timer is permitted in one role: releasing a batch events have already filled — and a timer firing against an empty batch must produce nothing, cost nothing, say nothing.

The test: **can this fire when nothing has happened since it last fired?** If yes it is a cadence and forbidden. If firing against no new evidence is structurally impossible, the timer only decides *when* a queued result is delivered — scheduling, not origination.

**Rejected:** the Foundry's six cadences and its *"cron is for audits nobody would think to ask for."* C3 comes from the owner: work ships in bursts, so a weekly audit fires four times against an untouched repository and reads the one busy week once. Each cadence was re-attached instead — spec-drift to a merge, decision-consistency to a ruling being recorded, coupling to the Nth landing in a module.
