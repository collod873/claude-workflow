---
status: constraint
date: 2026-08-26
reversal: Reversing it means stripping the `Status: superseded by ADR-NNNN` lines already stamped onto records that ADR-0045's counter and the tracker's permalinks both read, and re-opening automatic deletion of prose against three read signals that were measured and found either to discriminate nothing or to select exactly the records the amendment chain requires be kept.
---

# An unread document cannot be detected, so the backwards question back-stamps prose instead of deleting it

An unread document cannot be detected, so nothing prunes prose on a read signal. The backwards question **back-stamps**: a superseded record gains a pointer to the record that superseded it. Deletion survives only where a mechanical exit already exists — ADR-0003's lint rules and `CODING_STANDARDS.md` entries. `docs/research/` gets an issue filed against it, never a delete.

**Rejected:** three read signals, all measured. The session corpus records loading, never influence. Inbound citations: all 44 ADRs have one, so the test discriminates nothing. `DESIGN.md` citations alone: the only discriminating signal finds the superseded ADRs — exactly what must never be deleted, because the amendment chain is the record.

Also struck: the condition *pruning can never reach something the owner wrote*, attributed to ADR-0006, which contains no such sentence. Unimplementable — 129 commits, all authored `Collin Lodato`.
