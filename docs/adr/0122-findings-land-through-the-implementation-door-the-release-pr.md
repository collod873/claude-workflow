---
status: constraint
date: 2026-08-31
amends: ADR-0017
reversal: Reinstating the release-PR channel means rebuilding a deleted workflow, schema and bookmark, unwiring the ratifier from the `implementation-opened` dispatch that gets it judged by lane 06 and merged by lane 08, and giving up the `Machinery-Commit: true` stamp and immutable-set refusal that keep audit landings out of the next audit's scope and inside the bypass counter's sight.
---

# Findings land through the implementation door; the release-PR channel is deleted

A finding that clears the audit lane's two-site gate goes to a ratifier: a full-tool stage turning it into a lint rule with every site it flags fixed in the same branch, a `CODING_STANDARDS.md` entry, or a reasoned rejection. The batch lands as one pull request through the `implementation-opened` dispatch every implementer uses. The release-PR channel it replaces, with its workflow, schema and bookmark, is deleted.

ADR-0017's triggers survive verbatim; its "released as one decision" does not. That channel produced 18 pull requests, ten merged inside fifteen minutes on a checklist whose mechanised half was empty, by a path the bypass counter could not see.

**Accepted cost.** A ratifier pull request draws lane 07's review and the fixer's repairs like any other; it may not touch the immutable set, and every commit carries `Machinery-Commit: true` so a landing never feeds the next audit.
