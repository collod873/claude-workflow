---
status: constraint
date: 2026-08-23
reversal: Reversing it strands `eslint.config.js` with rules that have no exit, and the evidence it audits against — whether a `Verify` run ever failed naming a rule — lives in Actions run history that expires, so a rule's usefulness cannot be re-established later; ADR-0124 narrows this standing question rather than replacing it and would have to be re-argued.
---

# A lint rule is asked whether it ever fired only when standards-pass runs next, and leaves the config the moment the answer is no

CODING_STANDARDS.md names an entry's only exit: it leaves by becoming a rule in `eslint.config.js`, in the commit that deletes the entry. The rule gets a matching exit. A rule is never audited on a calendar — the question rides `/standards-pass`, the event that already adds rules: each time it runs, it also asks every enabled rule whether any `Verify` run in Actions history has ever failed naming it. A rule with zero hits since it was enabled is deleted, in a commit stating that finding as the reason.

**Rejected:** a scheduled audit. C3 forbids a clock, and C4 forbids a second ritual beside `/standards-pass` — a rule's whole adoption cost must be paid at the one event that already exists for rules, or the linter grooms itself into the obligation it was adopted to avoid.
