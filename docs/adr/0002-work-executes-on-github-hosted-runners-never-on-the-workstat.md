# Work executes on GitHub-hosted runners, never on the workstation

Recorded 2026-08-22.

Every kind of work the pipeline does — triage, specification, implementation, verification, close-out
— executes in a GitHub Actions job on a GitHub-hosted runner. The workstation is a console for
talking to Claude, not a venue that work runs in. A Claude cloud session is a reading and deciding
surface, not an execution venue.

## The eligibility rule

> **A venue is eligible to run a kind of work only if it can run that work with the workstation
> powered off, from the repository's committed contents alone.**

Two clauses, both testable against a proposed piece of work, and a proposal has to pass both:

| Clause | Fails when |
|---|---|
| **Workstation off** | The work needs Collin's machine to be up, reachable, or logged in — a self-hosted runner, a local daemon, a worktree on his disk |
| **Committed contents alone** | The work needs something the runner cannot get by checking out the repo — a credential typed into a settings page, a file that lives only in `~/`, a fleet fetched from a repo the job has no token for |

Held against the three venues on the table:

| Venue | Workstation off | Committed contents alone | Verdict |
|---|---|---|---|
| GitHub-hosted Actions runner | yes | yes, by construction — the job's first step is a checkout | **eligible for all work** |
| Self-hosted runner (workstation or rented box) | **no** (workstation) / yes (VPS) | yes | **rejected**, below |
| Claude cloud session | yes | **no** — the setup phase holds no GitHub credentials | **read and decide only** |

## Why the workstation is out, and it is not the load finding

[Verify whether drain workers oversubscribe the box](https://github.com/collod873/claude-workflow/issues/3)
measured the hammering symptom and found it was a **configuration** fault, not a hosting one: nothing
caps Lumaria's vitest worker pool, so one `vitest run` opens to all 32 cores at 9.9 GB peak RSS, and
`--maxWorkers=6` is 11% faster on 2.8× less memory. That finding says the load does **not** argue for
moving compute anywhere, and this ADR does not cite it as if it did.

The workstation is out for a reason that finding cannot reach: **the owner does not want work running
on his computer.** That is a statement about what the machine is for, not about whether it can cope.
A tuned box that still has to be awake for the pipeline to run is the thing being rejected, and no
amount of headroom changes that.

This is also why a rented VPS running a self-hosted runner is rejected rather than treated as the
cheap answer. It passes the workstation-off clause, but it is a second machine with a grooming
obligation — an offline runner leaves jobs queued rather than failing them, and C4's adoption law
says a mechanism needing an active ritual to stay true dies by roughly month three regardless of
quality. The minutes it would save are not worth a box to keep alive.

## The minutes cap is accepted, not solved

GitHub-hosted runners meter. [Read the actual GitHub Actions bill](https://github.com/collod873/claude-workflow/issues/2)
found the estate already at roughly 2,022 minutes on a rolling 30 days against Free's 2,000 included
private minutes, and moving execution onto Actions only pushes that up — a `claude-code-action` run
is bound by model latency, so it bills wall clock.

The ruling is to **stay on Free and let the cap bind**, which is
[Rule on the Actions minutes cap](https://github.com/collod873/claude-workflow/issues/7)'s decision
unchanged, not an amendment to it. Free with no payment method **blocks** at the cap rather than
billing, so the failure mode is the pipeline stopping mid-month — visible, safe, and self-reporting.
The number nobody has is what this architecture actually costs per month; the block is how it gets
measured. The two levers on record if and when it binds — GitHub Pro at $4/mo for 3,000 minutes, or
metered billing — stay undecided until there is a real number to decide against.

## The three rulings this decision was chartered to make

### The gate runs in the runner, beside the work

Verification moves to Actions with everything else. It runs as a step in the same job that produced
the change, against the checkout that job already has.

What this costs is the current drain loop's shape, and the loop does not survive the move. Today
`/drain` runs a foreman on the workstation that merges each worker branch into a local drain branch,
runs the contract's gate command against that branch in its own checkout, and pushes only once at the
end — a serial merge-gate-close critical section over history GitHub cannot see
(`drain/SKILL.md:89-103`, `:165-167`). Nothing about that survives a venue where the workstation is
absent and the runner's only view of the work is a pushed ref. Verification stops being a local
critical section and becomes a job on a ref.

This is stated as a consequence rather than a migration plan on purpose: the pipeline is being built
new, and the local foreman loop is not being ported.

### Portability is one mechanism: the repository

Whatever the pipeline is built out of — workflow files, actions, scripts, skills, hooks, or something
not yet named — it lives in the repository that uses it. A GitHub-hosted runner starts empty, so
anything not in the checkout does not exist. That is the same mechanism `triage.yml` already proves in
production, where a missing skill fails the run loudly instead of going green having done nothing.

There is no second mechanism, and specifically the converge-at-setup route is not one.
[Test whether a cloud session reads the skills and hooks its setup script installed](https://github.com/collod873/claude-workflow/issues/11)
proved that route works — a cloud session loads the skills and fires the hooks its own setup script
wrote, and a `disable-model-invocation: true` skill survives intact. It is rejected anyway, on the
second clause of the eligibility rule: the setup phase holds no GitHub credentials, so the route
carries only text typed into a settings textarea — unversioned, unreviewable, and undetectably stale
until a cache expiry rebuilds it. One mechanism that is in git beats two where the second cannot be
reviewed.

### A Claude cloud session never closes a ticket

This is option B of the three the question was charted with, and it falls out of the eligibility rule
rather than needing its own argument. A cloud session fails the committed-contents clause, so it is
not eligible for any work whose correctness depends on something arriving from the repository — and
closing a ticket is exactly that kind of work. The enforcement layer is repo-local, so a session that
closes an issue in a repo whose gate never reached it closes with no gate at all and still shows
green. That is the third fail-open hole surfaced by
[Establish what a Claude cloud session can actually reach and be fired by](https://github.com/collod873/claude-workflow/issues/6),
and this ruling closes it by removing the capability rather than by delivering a gate.

The eligibility test, in the same form as the rule above:

> **A venue may close a ticket only if the gate that refuses a bad close ran in that same venue, from
> the checkout.**

Actions passes. A cloud session does not. The long-lived plaintext `GH_TOKEN` that would have made a
cloud session pass — a credential the docs describe as readable by anyone using the environment — is
rejected with the route that needed it.

What a cloud session keeps is the phone: grilling, research, reading live state, commenting, deciding.
[#6](https://github.com/collod873/claude-workflow/issues/6) measured both of those lenses clearing,
and live state working today with no setup at all. That is the surface
[ADR-0001](0001-github-is-the-spec-and-issue-tracker.md) left explicitly unsettled, and this ADR
settles only the execution half of it.

## Scored against the charter

**C3 — event-driven, never a clock.** Passes, and improves on the status quo. Actions fires on
repository events, which is what C3 asks for; `triage.yml` on `issues.opened` is the shape. The
warning attached is Sandcastle's: 1,365 of its 2,120 orchestration runs were no-ops, but that was a
*cron* fault, not an Actions fault. No workflow built here gets a `schedule:` trigger.

**C4 — zero grooming.** This is the clause the runner choice turns on. A GitHub-hosted runner has no
grooming surface: no machine to keep awake, no agent to keep registered, no cache to keep warm. Both
self-hosted options fail it, and the setup-script route fails it too — a payload that goes stale
invisibly is a grooming obligation whether or not anyone calls it one. The one grooming cost accepted
is the minutes cap, and it is accepted specifically because it announces itself by stopping.

**C6 — short, disposable sessions.** Passes, and it is the clearest win. Work that runs in a job does
not hold a session open on the workstation waiting for it, so the local session ends at dispatch
rather than at completion. The cost is that a job is slower in wall clock than the same work on a
32-core box — irrelevant for agent work, which is latency-bound, and paid for on the CPU-bound half by
not being sat in front of.

## Considered options

- **Self-hosted runner on the workstation.** What Sandcastle did, and free. Rejected on the
  workstation-off clause, which is the owner's ruling and not negotiable against a cost saving.
- **Self-hosted runner on a rented VPS.** Passes workstation-off. Rejected on C4 — a second machine
  to keep alive — and on capability: roughly $32/mo buys one 4 vCPU/16 GB box against 20 concurrent
  ephemeral runners, and [#3](https://github.com/collod873/claude-workflow/issues/3) found RAM is the
  binding constraint, so 16 GB reimports the bottleneck.
- **A managed runner fleet.** Already closed, and not on price:
  [Price the managed runner fleets against both workloads](https://github.com/collod873/claude-workflow/issues/5)
  found `collod873` is a personal account in zero organizations, and Blacksmith, Depot and Namespace
  all require an organization. The one eligible vendor loses on price anyway.
- **Split the venue** — event-fired work on Actions, `/implement` and `/drain` local because the owner
  is sitting there. Rejected: it keeps the workstation as a venue, which is the thing being removed,
  and it makes the eligibility rule conditional on who happens to be at the desk.
- **GitHub-hosted runners on Free.** Chosen.

## What would reopen this

- **The cap binds and the number is bad.** The block is the measurement. A real monthly figure is what
  makes the Pro-versus-metered choice decidable, and that choice is not this ADR's.
- **A kind of work that cannot run in a job.** Something needing a persistent process, a GPU, a
  desktop session, or an interactive login. None is on the horizon; if one arrives, it is a new
  venue question, not a revision of this rule.
- **A second operator.** Same expiry condition [ADR-0001](0001-github-is-the-spec-and-issue-tracker.md)
  carries. Shared execution changes what a runner is for.

Not the workstation's capacity, and not the price of a rented box. Both were measured and neither is
what this decision rests on.
