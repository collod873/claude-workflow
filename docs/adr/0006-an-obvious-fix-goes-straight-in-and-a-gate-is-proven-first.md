---
status: constraint
date: 2026-10-07
reversal: Obvious fixes would wait out 30 merged PRs as meters again, or unproven gates would stop work.
---

# An obvious fix goes straight in, and a gate is proven first

A rule that will plainly improve things is built at once, as a changed default at its cause, with
no trial. A rule nobody is sure of yet enters as a meter. Anything that would stop work is proven on
real runs before it may, and when it fires it sends the work back to the step that made it, never to
the owner.

**Rejected: every rule entering as a meter.** The 2026-09-24 rule made an obvious fix wait out 30
merged PRs, and the owner asked on 2026-10-06 for fixes "rather than limiting it to a hopeful
prompt".

**Rejected: a gate on the owner's say-so.** Stopping work is brutal; where and how it fires needs
evidence first.

Evidence: `docs/research/owner-rules-2026-10.md`, C1.
