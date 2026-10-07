---
status: constraint
date: 2026-10-07
reversal: Every repo would carry its own copy again, with sync tooling to maintain and agents left to pick between versions.
---

# Every shared tool lives in one global home

A tool, hook, skill or setting that more than one repo uses has exactly one copy, in a global
home. The change that promotes it deletes the repo copy in the same commit, so agents always read
the one live version and a fix to it reaches every enrolled repo and every repo enrolled later.
Which repo is home for which kind of thing is settled separately.

**Rejected: a copy per repo, kept in step by sync tooling.** Copies go stale without fail and
agents build to the wrong one; the duplicate callers cut on 2026-10-07 are the latest case.

Evidence: `docs/research/owner-rules-2026-10.md`, N6.
