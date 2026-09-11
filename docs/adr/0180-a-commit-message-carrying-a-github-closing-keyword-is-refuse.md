---
status: constraint
date: 2026-09-11
reversal: Reversing it lets a `Closes #<n>`-style commit message auto-close a ticket again with no `## Closing record` and none of close-ticket's checks run, reopening the exact bypass #392 found; recovering the reversal costs rebuilding the deny branch this ADR describes.
---

# A commit message carrying a GitHub closing keyword is refused before it can reach the remote

`.claude/hooks/close-gate.py` only sees a close naming its own CLI verb: `gh issue close`, `state=closed`, `closeIssue`. #392 found a fourth route: a `git commit` message ending `Resolves #176` closes the ticket the moment GitHub parses the pushed commit, server-side, no CLI verb involved. ADR-0088 already named this cost: "a merge keyword ... goes unjudged."

`.claude/hooks/validate-bash.py` now refuses a `git commit` whose message carries a GitHub closing keyword (`close(s|d)`, `fix(es|ed)`, `resolve(s|d)` + `#<n>`), at the same Bash-tool-call venue ADR-0088 put the close gate in, and names the recovery: `bin/close-ticket <n> <base>..<head> <checkout>` once the work lands.

**Rejected: detecting the close after the fact and reopening it.** ADR-0088 retired the tracker-side reconciler because a turn-time refusal repairs itself in-session, where a post-hoc reopen costs a session already ended; rebuilding it for one more close route repeats the cost ADR-0088 removed it to avoid.
