---
status: constraint
date: 2026-10-19
reversal: Every session landing would wait on a runner, a webhook and auto-merge again, and land would go back to being changed to wait better.
---

# A session landing is judged on the owner's PC before the push, and GitHub runs nothing for it

The full check runs in pre-push, blocking and red in the terminal, on the exact commit, with every
rule the PR check ever ran since 2026-10-08. The pre-push posts that result as the commit's `check`
status, and main's ruleset accepts it from any source. A push that skipped the hook carries no
status and cannot merge. `bin/land` merges at once; nothing waits on GitHub to start. The machine's
own stages, slicer through closer, keep running in Actions (ADR-0007); this binds the session path
only, and ticket PRs until their own ruling.

**Rejected: an Actions `check` as a second opinion.** It re-read the PC's receipt in seconds,
caught nothing after 2026-10-08, and cost a median minute, up to 13, and 30 or more when Actions was
degraded.

**Rejected: merging past the gate with admin.** A push that skipped the hook would merge.

Evidence: #1344; the owner, 2026-10-19.
