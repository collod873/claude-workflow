---
status: constraint
date: 2026-09-13
amends: ADR-0053, ADR-0091
reversal: Reversing means putting lane 04 back on `main`: reinstating `acceptance/land.ts`, the `acceptance-bundle` action, the `format-patch`/`git am` replay, the rebase-onto-a-moving-`main` retry, the sibling-landed-first re-author path and the repo-wide `land-${repository}` group — and re-acquiring the reason to, which is a `tests/acceptance/` directory in the immutable set that ADR-0150 deleted.
---

# Acceptance lands on the ticket's branch, because ADR-0150 deleted the rule its push to main avoided

ADR-0053 put lane 04's commits on `main` so the lane opened no pull request: nothing then modified
`tests/acceptance/`, so the immutability refusal carried no exemption and needed no identity.

ADR-0150 deleted that directory. Tests are colocated and the immutable set is `vitest.config.ts` and
`.github/`, so the rule that exemption answered is gone and the machinery avoiding it is unpaid-for.

The author pushes to `implement/issue-N`, the branch `implement` already cuts, and dispatches
`ticket-ready` itself. ADR-0091 is amended, not reversed: a model job still holds no
`contents: write`.

The contract stays beyond the implementer's reach without `main`:
`shared/implementation-landing.ts` refuses a run whose answer changed an acceptance test it is
judged by, reading the diff, not the origin.

**Rejected: batching `land`.** Buys back the serialisation, keeps the replay and the conflict path.

**Accepted cost.** Test and implementation arrive in one pull request, and a re-fire commits per
slice branch rather than all-or-nothing.
