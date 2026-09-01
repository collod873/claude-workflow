---
status: constraint
date: 2026-09-01
amends: ADR-0057
reversal: Reversing it means deleting the enrol lane and the topic-derived repository list it enumerates, rebuilding `bin/install` as a command a person has to remember to run again, and re-auditing every already-enrolled repository to confirm it still holds what that command would have installed by hand.
---

# Enrolment is a repository topic, and an enrol lane writes stubs on every push to main

ADR-0057 made `bin/install` derive every list it acts on, but it was still "one command run from
this clone" — remembered per repository, per lane change. There is no installer script. Enrolment
is a topic on the target repository; a push to `main` here that changes the stub set fires an
enrol lane writing stub workflows, labels, and repository settings (ADR-0093) into every
repository carrying that topic, unattended.

This keeps ADR-0057's rule — every list is derived — and retires the command: the repository list
comes from `GET /search/repositories?q=topic:<topic>`, never a file either side carries. One
fine-grained PAT, write-scoped to every enrolled repository, lives here, referenced only by this
push-to-`main` job, never one a pull request can trigger (ADR-0053).

**Rejected:** a `workflow_dispatch` run by hand per repository — the drift ADR-0057 rejected.

**Accepted cost.** A stale or over-broad topic silently enrolls a repository; the topic decides,
not the token's selection.
