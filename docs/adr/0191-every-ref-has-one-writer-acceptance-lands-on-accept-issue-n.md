---
status: constraint
date: 2026-09-14
supersedes: ADR-0186
reversal: acceptance and implement share one ref again, so every reader is back to decoding who wrote which commit - and implement goes back to checking out trunk, where the test it must make pass does not exist
---

# Every ref has one writer: acceptance lands on `accept/issue-N` and implement branches from it

[ADR-0186](0186-acceptance-lands-on-the-ticket-s-branch-because-adr-0150-del.md) put acceptance on
`implement/issue-N`, which three lanes then wrote. Reading it meant guessing the author from commit
counts and ages, and every reader guessed differently
([ADR-0189](0189-a-ticket-s-stage-is-read-from-its-artifacts-a-standing-branc.md),
[ADR-0190](0190-a-lane-s-concurrency-group-is-its-lock-no-lane-claims-a-git.md)). Worse, implement
checked out trunk, so the test it exists to make pass was never in its worktree.

Acceptance writes `accept/issue-N` and nothing else does. Implement and the mechanic branch from it
and push `implement/issue-N`. The recompute reads two ref existence checks and a pull request list:
no compare, no counting commits. Integrate retires `accept/issue-N` at merge. Each later lane is a
ref, not a heuristic.

**Rejected: attributing commits by author or message.** A fourth proxy for a question a ref name
answers exactly.
