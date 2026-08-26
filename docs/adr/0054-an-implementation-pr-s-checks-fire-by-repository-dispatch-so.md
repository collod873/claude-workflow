# An implementation PR's checks fire by repository_dispatch, so the workflow that judges it is always trunk's

Recorded 2026-08-26.

Amends: [ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md).

Lane 05's implementer opens its pull request with the built-in `GITHUB_TOKEN`, then sends a
`repository_dispatch` carrying the PR number. The verification workflow fires on that dispatch, not
on `pull_request`. A `repository_dispatch` run **always executes the workflow file from the default
branch**, so the definition that judges a pull request can never be a file inside it.

`.github/` joins the immutable set alongside `tests/acceptance/` and the runner's config
([ADR-0053](0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md) states the closed
rule). The dispatch is the **guarantee**; the diff refusal is the **alarm** — exactly the division
[ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md) drew for the tests
themselves, applied one level up to the thing that runs them.

## The hole this closes

ADR-0032 established that `tests/acceptance/**` is not a boundary on its own, because
`vitest.config.ts` carries an explicit `include` allowlist and an implementer can leave every test
byte-identical while deleting one line to stop them running. The same hole exists one level higher
and ADR-0032 did not reach it: **on a `pull_request` event GitHub runs the workflow file from the
pull request, not from trunk.** So an implementer never had to touch a test or the runner's config —
it deletes the acceptance job from `verify.yml` and ADR-0032's restore-from-tip never executes. The
tests are untouched. They simply never run, and the pull request goes green in silence.

Restoring from trunk is only a guarantee if the instruction to restore also comes from trunk.

## Why a dispatch rather than a label, a branch prefix, or a pull_request trigger

The forcing fact is that **an event caused by the built-in `GITHUB_TOKEN` starts no workflow run** —
GitHub blocks it to prevent recursion, `shape-accept.yml` and
[ADR-0051](0051-the-accept-commits-its-rulings-straight-to-main-because-a-pu.md) already depend on
it. The rule is about the token, not the event, so it kills the whole family of workarounds at once:
opening the PR, labelling it afterwards, opening it already labelled, and pushing another commit all
create nothing.

`workflow_dispatch` and `repository_dispatch` are the two documented exceptions. This repo already
runs three workflows off `repository_dispatch` — `run-watchdog.yml`, `close-gate-reconcile.yml` and
`audit.yml` — so the mechanism is proven here rather than proposed.

`repository_dispatch` is chosen over `workflow_dispatch` because it takes its workflow file from the
default branch unconditionally, where `workflow_dispatch` runs the file on whatever ref it is given
and would reintroduce the hole if ever dispatched against the PR's branch. A property that holds by
construction beats one that holds if every caller passes the right argument.

## Considered options

- **`on: pull_request`, with a second credential so the PR triggers it.** What `DESIGN.md` §04
  implied. Rejected twice over: it costs a credential (see
  [ADR-0053](0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md)) and it still runs
  the pull request's own copy of the workflow, so it does not close the hole the credential was
  bought to protect.
- **A label applied after opening, triggering `pull_request: labeled`.** Rejected on the forcing fact
  above — a label applied by the built-in token creates no run.
- **`workflow_dispatch` against `main`.** Works, and closes the hole as long as every caller passes
  `--ref main`. Rejected for depending on a caller getting an argument right.
- **`repository_dispatch`.** Chosen.

## Consequences

**`verify.yml` keeps its `push: main` trigger and loses `pull_request`.** The `push` half is
telemetry that a commit which skipped the free venues still met the gauntlet, and nothing here
changes it. `DESIGN.md` §06's note that a branch push would otherwise fire the workflow twice once
lane 05 opens pull requests is resolved by there being no `pull_request` trigger at all.

**The dispatch is a thing that can silently stop arriving**, which is the failure `run-watchdog.yml`
exists for (#41) — a workflow run that executes zero jobs must reach a human. An implementer PR whose
dispatch never lands looks exactly like one whose checks have not finished yet. Lane 08 must not
merge a pull request with no completed verification run, which is a stronger condition than "no red
check" and is where this ADR binds the merge actor.

**It costs one API call in the implementer's job**, after the PR is opened and before it exits.

**`.github/` being immutable is what stops an implementer editing the dispatch out of its own lane.**
The two halves are load-bearing together: trunk's workflow file judges the PR, and the PR may not
change what trunk's workflow file will be.
