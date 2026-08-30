# A ticket's check reads the tree while a spec's check reads the world

Recorded 2026-08-29.

Amends: [ADR-0096](0096-a-check-marker-is-refused-for-reading-the-tracker-instead-of.md), whose Consequences
section named this shape and left it unresolved.

[ADR-0096](0096-a-check-marker-is-refused-for-reading-the-tracker-instead-of.md) refused a
ticket's check command for reaching `gh api`, `gh issue`, `gh pr`, `gh run`, `curl`, or `wget`,
because `validateCriteriaShape` judges a slice's acceptance criteria before `bin/close-ticket`
ever runs one — against the diff a checkout holds, never against GitHub's remote state. Its own
Consequences section named the shape that refusal left with nowhere to go: a criterion asserting
something ran in production "needs a PRD closed by observing the running system, not a merge
gate."

That is the boundary this makes explicit, rather than a widening of it. A ticket closes on a
diff: `bin/close-ticket` hands its check command a working directory, and every fact worth
asserting about a diff is already sitting on disk. A spec closes on the opposite claim — that a
lane fired, a PR merged, an Actions run produced the thing the PRD asked for — and none of that
is written anywhere `git` can read; it exists only in the tracker or in a running system. `gh
api`, `gh issue`, `gh pr`, `gh run`, `curl`, and `wget` stay refused for a ticket's check, exactly
as ADR-0096 ruled, and become the ordinary vocabulary of a spec's.

## Consequences

A checker that inspects an acceptance criterion has to know which of the two it is reading before
it can judge the command inside it: the same `gh api` call ADR-0096 refuses in a ticket's check is
the expected shape once the same text sits in a spec's own closing check.
