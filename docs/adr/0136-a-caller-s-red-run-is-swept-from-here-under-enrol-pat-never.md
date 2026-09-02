---
status: constraint
date: 2026-09-02
reversal: Every enrolled repository would hold a credential that writes to this repository's tracker, rotating in all of them at once, and any one compromised caller could file against the machine every other caller runs.
---

# A caller's red run is swept from here under ENROL_PAT, never filed home by the caller

ADR-0135 routes a red run by its failing path but never says who files the ticket. A caller's
`GITHUB_TOKEN` cannot write here, and neither secret enrolment ships outward reaches this tracker.

The obvious answer — enrolment writes a third secret, a PAT carrying `issues: write` here — hands
every enrolled repository a key to the machine every other one runs, and rotating it becomes a pass
over the whole estate.

So the sweep runs here instead, over the topic ADR-0133 already enumerates, under `ENROL_PAT`,
which already reaches every enrolled repository. No new outward credential exists, and the estate
holds nothing that writes to the machine. It rides the `session-captured` dispatch (ADR-0004,
ADR-0049) and recomputes from the tracker like `run-watchdog`, storing nothing.

The accepted cost: a machine-side defect is seen at the next session end rather than at the moment
of failure.
