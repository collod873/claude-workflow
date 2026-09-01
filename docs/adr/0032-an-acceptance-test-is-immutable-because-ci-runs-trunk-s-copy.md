---
status: superseded
date: 2026-08-26
amends: ADR-0011
superseded_by: ADR-0053
reversal: Running the PR's own copy again would give up the trunk-tip restore, the closed immutable set that includes vitest.config.ts, the no-outside-imports rule the acceptance tree is written under, and the separate lane credential the exemption rides on; ADR-0053, ADR-0054 and ADR-0102 already carry the successor.
---

# An acceptance test is immutable because CI runs trunk's copy, not because a diff check catches the edit

Superseded by ADR-0053. Re-admitted 2026-08-31: the ruling this file carried no longer
governs, and the successor states what replaced it.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
