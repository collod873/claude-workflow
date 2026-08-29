# The push venue lints workflow files, and only the ones that differ from trunk

Recorded 2026-08-29.

`bin/gauntlet push` now runs `actionlint`, which `verify.yml` said in a comment it deliberately did
not: *"the one check that does not go through `bin/gauntlet`."* It runs only when
`.github/workflows/` differs from `origin/main`, and when it cannot run it reports that rather than
passing.

## Why this came up

A broken workflow file is the one defect CI structurally cannot report. GitHub cannot parse it, so
it never schedules it, so a `repository_dispatch` aimed at it lands on **nothing at all** — no run,
no conclusion, nothing for a reader to notice. #40 was thirteen pushes that way.

It happened again on 2026-08-29. `runner.temp` in `implement.yml`'s job-level `env:` block passed
every local gate, and lane 04's `ticket-ready` dispatch for #237 disappeared into a workflow GitHub
had already refused. CI *did* eventually go red — on the **next** push, in a step named `Lint
workflow files`, long after the dispatch it was supposed to protect was gone. Nothing re-sends a
dispatch.

That is what ADR-0010's "earliest venue that fits" is for, and it is a stronger case than the ADR's
own example. The usual argument is that the *repair* is cheaper while the context is hot. Here the
repair is not the expensive part: the lost dispatch is, and once the push has landed there is no
venue left that can prevent it.

## Why the old ruling was right, and what changed

`verify.yml`'s comment gave a real reason: the check "needs a binary the free venues would have to
download on every clone, and C4 says a mechanism that needs a ritual dies by month three." That
objection is about *installation*, and it is answered by not requiring one rather than by declaring
it acceptable.

**The linter runs only when the workflow files differ from trunk.** Trunk's copies were linted by
CI when they landed, so the only YAML this venue can say anything new about is YAML that has
changed. Nearly every push here touches no workflow file, needs no linter, and starts no container —
so nobody has to install anything to keep working. The ritual exists only for the person doing the
one thing that needs it.

**When it cannot run, it says so instead of passing.** No Docker daemon is `unchecked`, which the
gauntlet reports as exit 2 — checks that could not run, never a finding (ADR-0063). `.husky/pre-push`
fails closed on that, which refuses the push. That is the right answer and a cheap one: the only way
to reach it is to be editing a workflow file.

The image is not spelled twice. It is read out of `verify.yml`'s own `uses:` line, so the two venues
cannot drift onto different linter versions.

## Considered options

**Leave it in CI only.** The status quo, and the thing that just failed. CI's report arrives after
the event it was meant to prevent, addressed to a dispatch that no longer exists.

**Vendor the binary into the repo, or download and cache it.** No Docker dependency, and a fresh
clone stays cheap. Rejected: it is a second pin to keep in step with `verify.yml`'s, a checksum to
verify, and a platform matrix — real work to buy back a dependency this estate already has and
already uses for this exact image.

**Run it at the `turn` or `stop` venue too.** Rejected on budget. Those are 1s and 10s, a container
start is neither, and a workflow file is not edited in the tight loop those venues serve.

## Consequences

Exit 2 is now read per check rather than globally. `contract`, `corpus`, `wiring` and `workflows`
are this repo's own scripts and speak the gauntlet's three codes back, so their exit 2 means "could
not run". `tsc --noEmit` does not: it exits **2** for type errors, which is a finding and the most
common one here. Reading a 2 the same way everywhere would file every type error as a broken
gauntlet — the one report ADR-0063 tells the bypass counter to ignore, which would have made type
errors invisible to it.

What is amended is a comment in `.github/workflows/verify.yml`, which is not an ADR and takes no
`Amends:` trailer — the same distinction [ADR-0049](0049-the-run-watchdog-sweeps-on-session-end-because-workflow-run.md)
drew when it amended a sentence in `DESIGN.md`. `verify.yml` keeps its own `Lint workflow files`
step: it is the venue that answers for what actually reached `main`, and it is the only one that
runs when a push arrives with `--no-verify`.
