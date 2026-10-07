---
status: constraint
date: 2026-10-07
reversal: Every repo would carry its own copy again, with sync tooling to maintain and agents left to pick between versions.
---

# Every shared tool lives once, and promoting it deletes the copy

A tool, hook, skill or setting more than one repo uses lives in one global home. The change that
promotes it deletes the repo copy in the same commit, and nothing keeps two copies in step: no sync
job, no drift check. A copy goes stale without fail, and an agent reading two versions builds to
the wrong one; the duplicate callers cut on 2026-10-07 are the latest case. A fix to the one copy
reaches every enrolled repo and every repo enrolled later. Which repo is the home for which kind of
thing is not settled here.

**Rejected: a copy per repo, kept in step by sync machinery.** It is machinery maintained for its
own sake, and the copies drift anyway.

Evidence: `docs/research/owner-rules-2026-10.md`, N6.
