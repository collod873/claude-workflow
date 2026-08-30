# A check marker is refused for reading the tracker instead of the tree, never for reaching outside the repo

Recorded 2026-08-29.

Status: superseded by ADR-0109

[#201](https://github.com/collod873/claude-workflow/issues/201)'s fourth criterion checked
`gh api …/contents/tests/acceptance`: it parsed, it was headless, and it still could not be
answered by any diff, because it reads GitHub's remote default branch rather than the tree
`bin/close-ticket` hands it as a working directory. `validateCriteriaShape` now refuses a
check command built on `gh api`, `gh issue`, `gh pr`, `gh run`, `curl`, or `wget` — the tracker
and the network are the two things a checkout can never stand in for, merged or not.

The refusal is keyed to that, not to "reaches outside the repo": [#220](https://github.com/collod873/claude-workflow/issues/220)'s
own criteria grep `/home/collin/.agents/skills/drain/SKILL.md`, an absolute path outside this
repository, because the artifact under test genuinely lives there — and a local `grep` against
that path still reads disk, so it can see exactly what that ticket's own work produced. Banning
absolute paths, or banning `gh` outright, would have refused that ticket along with #201's.

## Consequences

A criterion that wants to assert something ran in production — a lane fired for real, an Actions
bot pushed a file — has nowhere left to go once this lands, and that is deliberate: such a claim
is not an acceptance criterion for a diff, it needs a PRD closed by observing the running system,
not a merge gate.
