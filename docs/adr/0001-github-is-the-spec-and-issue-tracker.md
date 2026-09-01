---
status: constraint
date: 2026-08-21
reversal: Reversing it rewrites `close-gate`'s issue-body parser, `publish-issue-graph`'s native sub-issue and blocked-by edges and `triage.yml`'s `issues.opened` trigger, leaves the close gate fail-open until that rewrite lands, and strands every PRD and ticket already living as a GitHub issue behind a sync layer nobody can stop maintaining.
---

# GitHub is the spec and issue tracker

A spec is a `PRD:` issue and a ticket is a child issue; how work is specified, sliced and closed is recorded on GitHub, not in a dedicated tracker and not in files.

PRs, CI and merge stay on GitHub regardless, so a second tracker adds rather than replaces — it must pay for a sync layer *and* a new home base, and C4's adoption law says anything needing a new home base dies by roughly month three.

**Rejected:** Linear/Height/Notion — better views, but every ticket state change mirrors a GitHub object and the mirror needs grooming. Files in the repo — no sync layer, but no `issues.opened`, no assignee, no native blocked-by edge.

**Accepted cost.** Enforcement is issue-shaped: `close-gate` parses a `## Closing record` off an issue body; `publish-issue-graph` builds native sub-issue edges. Moving tracker rewrites the gate, and the gate is fail-open until it lands.
