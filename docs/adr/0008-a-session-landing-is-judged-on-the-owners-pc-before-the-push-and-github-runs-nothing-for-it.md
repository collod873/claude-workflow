---
status: constraint
date: 2026-10-20
reversal: Every session landing would wait on Actions again, or on a pre-push that grades a tree other than the commit it ships.
---

# A session landing is judged on the owner's PC before the push, and GitHub runs nothing for it

`bin/land` refuses uncommitted or untracked files, then runs the full check on the exact commit before anything is pushed: what it grades is what it ships, and red leaves nothing on GitHub. Green is posted as the commit's `check` and `tickets / review` statuses, naming `land`, which main's ruleset accepts from any source, so a push that skipped `land` cannot merge. `land` merges at once. The machine's stages keep running in Actions (ADR-0007); this binds session landings, and ticket PRs land the same way (ADR-0012).

**Rejected: a pre-push as the gate.** It graded the working tree, ran in five of eleven repos, and guarded nothing once agents could not push.

**Rejected: requiring an up-to-date branch.** Each moved main reran the full check, for a race the next `land` catches.

**Rejected: an Actions `check`, or an admin merge.** The first caught nothing in 225 landings; the second merges what skipped `land`.

Evidence: #1344; agent-hooks#176; the owner, 2026-10-19 and 20.
