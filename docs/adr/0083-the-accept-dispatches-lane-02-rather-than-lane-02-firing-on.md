---
status: constraint
date: 2026-08-27
amends: ADR-0058
reversal: Reversing means moving lane 02's trigger back onto the `approved` label and teaching `collectSheetContext` to survive a missing accept payload with a poll that has no correct timeout, re-opening a race that lane 01's ADR-filing push wins by seconds every time.
---

# The accept dispatches lane 02 rather than lane 02 firing on the approved label, because the collector reads what the accept writes

Lane 02's sheet trigger is a `repository_dispatch` sent by `accept.ts` after it posts the accept comment — not the `approved` label ADR-0058's trigger table names.

The accept's marker is written by `shape-accept.yml`, which fires on `approved`. Firing lane 02 on the same label races the two runs for the one thing the collector cannot proceed without: `collectSheetContext` throws with no accept payload. This is the common case — lane 01 files ADRs and pushes to `main` before it comments. A second label is no escape: ADR-0054's forcing fact is that an event caused by `GITHUB_TOKEN` starts no run, and `repository_dispatch` is the documented exception.

**Rejected:** polling for the marker, which has no correct timeout and fails open; welding accept and spec into one job, which would re-run the ADR filing.

**Accepted cost.** The send is ordered last; a lost dispatch leaves an accepted idea visible and re-runnable.
