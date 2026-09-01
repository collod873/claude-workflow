---
status: constraint
date: 2026-08-22
reversal: Reversing it re-homes every lane's execution — the workflow files that are the pipeline, and the no-local-foreman shape they assume — onto a machine that must be kept awake and registered, and re-admits a venue allowed to close tickets without the gate that refuses a bad close ever having run there.
---

# Work executes on GitHub-hosted runners, never on the workstation

Every kind of work the pipeline does — triage, specification, implementation, verification, close-out — runs in a GitHub Actions job. The workstation is a console, not a venue; a cloud session reads and decides only.

The eligibility rule: **a venue may run a kind of work only if it can with the workstation powered off, from the repository's committed contents alone** — and may close a ticket only if the gate that refuses a bad close ran in that same venue.

**Rejected:** a self-hosted runner on the workstation — the owner will not have work run on his computer. A rented VPS passes workstation-off but is a second machine to keep alive (C4). A cloud session holds no repo credentials at setup, so it would close tickets with no gate.

**Accepted cost.** Free's 2,000 monthly minutes bind and block. Portability is one mechanism: the repository.
