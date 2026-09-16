---
status: constraint
date: 2026-08-29
reversal: Dropping the refusal from `shared/render-body.ts` lets lane 03 publish ticket criteria no merged checkout can ever answer, and widening it to every command that leaves the repository refuses tickets whose artifact lives elsewhere on disk and every spec's closing check.
---

# A ticket's check is refused for reading the tracker instead of the tree, never for reaching outside the repo, and a spec's check reads the world

Lane 03 refuses a ticket criterion whose `check:` command is built on `gh api`, `gh issue`, `gh pr`,
`gh run`, `curl` or `wget`. A ticket closes on a diff: `bin/close-ticket` hands the check a working
directory, and the tracker and the network are the two things a checkout can never stand in for.
One ticket checked `gh api …/contents/tests/acceptance`, which reads GitHub's default branch, not
the tree under test.

The refusal is keyed to that, not to reaching outside the repository. A local `grep` against an
absolute path still reads disk, and can see what the ticket's own work produced.

A spec closes on the opposite claim, that something happened in the running system, so those same
commands are the ordinary vocabulary of a spec's closing check.

**Rejected: refusing absolute paths or `gh` outright.** It refuses tickets whose artifact genuinely
lives outside the repository, and every spec check.
