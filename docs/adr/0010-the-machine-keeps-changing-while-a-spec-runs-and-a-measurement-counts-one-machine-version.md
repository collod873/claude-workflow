---
status: constraint
date: 2026-10-19
reversal: A spec would wait on a frozen machine, or every number would average across machine versions nobody runs.
---

# The machine keeps changing while a spec runs, and a measurement counts one machine version

A spec is measured at its done check: wall time, rework, stalls and spend, cut by the machine
version each run referenced. Countermeasures the machine needs land as soon as they are ready, during a spec
included, since a broken spec needs them to finish and one held back leaves its symptom to recur.
Runs under an older version are history: they say what that version cost, never what the current
one does, and no number averages across versions. A session asked for a clean read gives the
segmented one.

**Rejected: holding the machine still for a spec to be measured.** Eight machine merges landed
during Lumaria#1086 and the spec needed them; a freeze would have left it stuck or finished it on
known faults, and the number would describe a machine nobody runs by the time it is read.

Evidence: `docs/research/owner-rules-2026-10.md`, N12;
`docs/research/spec-time-by-machine-version-2026-10.md`; `docs/research/spec-1086-2026-10.md`; the
owner, 2026-10-14.
