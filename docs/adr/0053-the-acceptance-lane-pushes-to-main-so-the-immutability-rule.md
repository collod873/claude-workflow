# The acceptance lane pushes to main, so the immutability rule has no exemption and needs no second identity

Recorded 2026-08-26.

Amends: [ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md),
[ADR-0033](0033-a-spec-edit-re-fires-acceptance-for-every-slice-whose-test-n.md).

Lane 04 commits its tests directly to `main` from the job that wrote them. It opens no pull request,
so there is no PR that legitimately modifies the immutable set, so the refusal carries **no
exemption**:

> No pull request may change `tests/acceptance/`, the test runner's config, or `.github/`. Nobody is
> exempt, and nothing reads an identity to decide.

Every lane keeps running as the built-in `GITHUB_TOKEN`, one principal, `github-actions[bot]`. **No
GitHub App, no machine account, no new secret.**

[ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md) ruled that the
exemption rides on **author identity**, because a label or a branch prefix is a convention any agent
holding `issues:write` satisfies by typing. That reasoning is correct and is not disturbed. What it
did not consider is deleting the exemption instead of authenticating it. An exemption is the attack
surface; a rule with no exemption has none to defend.

## Why the re-entry PR was never buying anything

[ADR-0033](0033-a-spec-edit-re-fires-acceptance-for-every-slice-whose-test-n.md) ruled that a merged
spec edit re-fires the acceptance author "on a PR of its own." That clause is amended to a push. It
was not buying review: lane 04 is the authority on what the criteria mean, by construction — it reads
the spec and nothing else, and the spec wins every disagreement
([ADR-0034](0034-spec-gap-fires-the-spec-author-and-an-acceptance-test-an-imp.md)). Nothing was ever
going to sit between the acceptance author and trunk and overrule it. Everything else ADR-0033 rules
— that "affected" is a grep over criteria named verbatim, and that an in-flight implementer needs no
new machinery because its PR simply goes red — is unchanged and is the mechanism this leans on.

**This is [ADR-0051](0051-the-accept-commits-its-rulings-straight-to-main-because-a-pu.md)'s ruling
applied to a second lane**, not a new shape. The accept already commits its rulings straight to
`main` for the same reason: a pull request nobody's judgement sits behind is ceremony. `DESIGN.md`
§10 records that this repo has never opened a pull request for its own work, and that branch
protection is a purchase rather than a setting on a private Free account — so there is no protection
for this to route around.

## The credential question this was chartered to answer

The charter was [#98](https://github.com/collod873/claude-workflow/issues/98): which identity does
each lane run as, and what does W2 require of the acceptance lane's credential. The answer is that
W2 requires **no credential at all**, because W2 — *the thing that checks is never the thing that
built* — is enforced by where the code comes from, not by who signed the request. The acceptance job
runs trunk's copy of the tests
([ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md)) under trunk's copy
of the workflow ([ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)),
and neither is reachable from the pull request under judgement. An identity would only ever have been
a way to let *one* PR through that wall.

**Granularity: one principal.** Two — a builder and a checker — and per-lane were both considered
against W2 and are rejected with the exemption they exist to authenticate. The adversary W2 models is
the thing being judged, an implementer reaching for its own report card; every split past that buys
nothing against it and adds a credential to keep alive, which C4 says dies around month three.

**Storage, and what can read it.** No new secret is stored. `CLAUDE_CODE_OAUTH_TOKEN` stays the
repo's only secret, and a rule now bounds it: **no credential is referenced by a job a pull request
can trigger.** Model-spending lanes fire on `issues` and `repository_dispatch`, which run trunk's
workflow file; the immutability job needs no secret at all, being a diff. This matters because a Free
private repo cannot have environment secrets with protection rules — that is the same ~$4/month
purchase as branch protection — so a repository secret readable by any workflow in the repo is the
only storage available, and the rule above is what makes that safe rather than the storage.

**A missing credential refuses, and the immutability job fails closed.** `DESIGN.md` §03's precedent
holds: an empty `CLAUDE_CODE_OAUTH_TOKEN` is reported by name through the shared failure surface. The
immutability job carries the stronger form — it may never be skipped, whatever is absent or
unreadable, because a check that skips is `CONTEXT.md`'s **Fail-open**: in an unattended system that
is not a degraded gate, it is not a gate.

**What a second repo must acquire: nothing.** This is the input
[#82](https://github.com/collod873/claude-workflow/issues/82) asked for. There is no account to
create, no App to install, no key to copy — the mechanism is workflow files in the checkout, which is
[ADR-0002](0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md)'s one portability
mechanism and no second one.

## Considered options

- **A GitHub App with its own installation token.** Free on a personal account including private
  repos, distinct bot actor, token minted per run and expiring in an hour, nothing to renew. The
  strongest of the identity options and the one to reach for if identity is ever needed. Rejected
  here only because nothing needs it once the exemption is gone.
- **A second machine account with a PAT.** GitHub's terms allow exactly one. Rejected on C4 before
  cost: it needs an email, a collaborator invite, and a token renewed before expiry — a ritual whose
  failure mode is the pipeline stopping on a day nobody chose.
- **A job-scoped `GITHUB_TOKEN` with a distinguishable actor.** Rejected because it does not exist.
  Both lanes resolve to `github-actions[bot]` and no job-level setting changes that.
- **Keep the PR and authenticate the exemption.** `DESIGN.md` §04's shape as written. Rejected: it
  pays a credential, its storage question, its renewal, and a portability cost in every future repo,
  to protect a PR that was buying no review.
- **Push to `main`, no exemption.** Chosen.

## Consequences

**The blast radius moves, and the lane pays for it.** A pull request would have run CI on the tests
before they landed. A push means a broken batch lands on trunk and reddens every in-flight
implementer PR at once, across the whole PRD. So the lane verifies before it pushes — and the signal
is *not* green, because acceptance tests are supposed to fail before an implementation exists. It is
**every test collected, and every failure an assertion rather than an import or syntax error.** That
distinguishes correct-and-red from broken, and it is mechanical.

**It rebases rather than forcing**, for the reason
[ADR-0051](0051-the-accept-commits-its-rulings-straight-to-main-because-a-pu.md) gives: a rejected
push means something else landed, which is a thing to retry onto and never to overwrite.

**A `GITHUB_TOKEN` push triggers no further workflows**, so this cannot start a loop with the lane
that dispatched it — the same property ADR-0051 and `shape-accept.yml` already rely on. It is also
why [ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md) exists.

## What would reopen this

**Move 10, and it is scheduled rather than hypothetical.** Branch protection makes a direct push to
`main` forbidden, so lane 04 opens a pull request like everything else — and the moment it does, the
exemption returns and needs authenticating. This ADR does not settle the identity question forever;
it moves it to the day it is actually paid for, by which point the lane will have run and the choice
between the App and a machine account can be made on evidence rather than on a guess made before this
repo opened its second pull request. `DESIGN.md` §10 and
[ADR-0051](0051-the-accept-commits-its-rulings-straight-to-main-because-a-pu.md) already carry the
same expiry for lanes 01 and 05; this is the third.
