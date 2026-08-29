# An acceptance test is immutable because CI runs trunk's copy, not because a diff check catches the edit

Recorded 2026-08-26.

Status: superseded by ADR-0053, ADR-0054, ADR-0102

Amends: [ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md), which does not hold
this check back — see "This does not wait on lane 05's fixer" below.

The acceptance job checks `tests/acceptance/` out of `main`'s tip before it runs, so whatever an
implementation PR did to those files never reaches the verdict. The refusal on a non-empty diff
under the immutable set ships as well, but it is the *alarm*, not the guarantee: it tells us an
implementer tried. `DESIGN.md` §04 described only the alarm, and a detection-only rule is a gate you
have to trust rather than one you can rely on.

**The immutable set is closed, not approximate.** `tests/acceptance/**` is not a boundary on its
own: this repo's `vitest.config.ts` carries an explicit `include` allowlist, so an implementer can
leave every test byte-identical and delete one line to stop them running, and a shared helper or
fixture imported from outside the directory is the same hole one level down. The set is therefore
**the directory plus the test runner's config**, and it carries a rule that makes the path filter
complete: **an acceptance test may not import anything outside its own directory.** The cost is
duplication — no shared helpers in that tree — which is the right trade for a suite whose entire job
is to be untrusting, and it is what makes the restore sound, since restoring the directory restores
everything the tests depend on.

**Venue and trigger:** Actions, on `pull_request`, its own job in `verify.yml` running *before* the
gauntlet — it is a diff test costing a second, and it invalidates the run beneath it.

**The exemption is the attack surface, so it rides on identity.** The re-entry PR (ADR-0033) must
modify `tests/acceptance/`, so the refusal needs an exemption, and whatever marks a PR exempt is
precisely what an implementer would forge. A label or a branch prefix is a convention any agent with
`issues:write` can satisfy by typing. The check therefore reads the PR's **author identity**, which
means **the acceptance lane needs its own credential**, distinct from whatever dispatches
implementers. That is a real cost and it is the price of the check meaning anything.

**Restore from `main`'s tip, never from the merge base.** A merge-base restore judges a slice against
the criteria that were live when its implementer started, so a slice whose spec has since moved could
go green on a spec nobody is building any more. Tip is also what makes ADR-0033's in-flight case work.

## Considered options

- **Detect the modification and refuse; run the PR's copy** — `DESIGN.md` §04's original shape.
  Rejected as the whole answer. It makes the premise depend on the completeness of a diff filter, and
  the `vitest.config.ts` hole above is proof that the obvious filter is not complete.
- **Restore silently and don't refuse** — rejected. The bad diff still lands on trunk, and nothing
  ever tells us an implementer reached for its own report card. That signal is worth a job.
- **Restore, then refuse** — chosen. The restore is the guarantee; the refusal is the alarm.

## Consequences

**This does not wait on lane 05's fixer, and [ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md) does not hold it back.**
Two reasons, and the ADR is amended to say so. First, the only thing that can violate this check is a
dispatched implementer, so the check has no traffic until lane 05 exists — it ships alongside its own
violator rather than ahead of it. Second, ADR-0011's failure mode is a refusal that *parks* work
because clearing it needs reasoning nobody automated yet; the repair here is
`git checkout main -- tests/acceptance/`, deterministic and known in advance. A red whose fix is one
command does not park anything.

**Branch protection is not what enforces it.** Protection is move 10 and costs money, so a required
check refuses no merge today. Lane 05 auto-merges on green and lane 08's warden merges — the **merge
actor reads the check**, so a red refuses without protection. Protection at move 10 later closes the
case where something merges without going through either.
