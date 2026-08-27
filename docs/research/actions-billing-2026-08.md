# GitHub Actions billing — what the estate actually spends

**Read:** 2026-08-21 · **Amended:** 2026-08-26 ·
**Resolves:** [claude-workflow#2](https://github.com/collod873/claude-workflow/issues/2)

**Status:** **Per-calendar-month** minutes, charges and run counts are **measured** — pulled from
GitHub's billing usage API and the Actions runs API on 2026-08-21. Wall-clock minutes are measured
but are **not** billable minutes; the timing endpoint is unusable on this plan, so no per-workflow
billable split can be measured at all (see [Method](#method)).

**The rolling-30-day arithmetic was struck on 2026-08-26 and is not in this document.** It was
labelled measured, could not be reproduced against any API call, and was cited as a design anchor
before it was struck — see [What was struck, and why](#what-was-struck-and-why) at the foot. Nothing
below carries a rolling-window figure, a per-repo minute split, or a dollar projection. If you came
here for a spend or concurrency anchor, there isn't one, and
[ADR-0024](../adr/0024-there-is-no-daily-spend-ceiling-and-the-governor-stops-on-qu.md) rules that
runner minutes are not an input.

---

## The headline

**Nothing has ever been charged.** `netAmount` is `$0.00` on every line item from March through
21 August 2026. The account is on the **Free** plan with 35 private repositories, so the included
allowance is **2,000 minutes/month** for private repos.

But the trend is the finding, not the total:

| Month | Private-repo minutes | % of 2,000 cap | Charged |
|---|---|---|---|
| May 2026 | 205 | 10% | $0.00 |
| June 2026 | 147 | 7% | $0.00 |
| July 2026 | **1,647** | **82%** | $0.00 |
| Aug 2026 (1–21) | **1,369** | 68% *so far* | $0.00 |

July is the step change, and it is explained: Lumaria's CI moved from self-hosted to
`ubuntu-latest` at `80d10ae` on 2026-07-08. The estate went from spending nothing to spending
most of its allowance in one commit.

### Public repos are free and do not count

`claude-ds` and `nihongo` are public; GitHub-hosted minutes on public repos are unlimited and free.
This matters because it makes the raw monthly totals misleading — **June's headline 2,152 minutes
was 2,005 minutes of public `claude-ds`**, leaving only 147 chargeable minutes. Every figure in
this document excludes both public repos.

---

## August is not a flat run rate, and that is the whole story

An average across the month hides what is actually happening:

| Window | Minutes | Per day |
|---|---|---|
| Aug 1–18 | 493 | **27** |
| Aug 19–21 | **876** | **292** |

**A 10.7× jump in the last three days.** Daily detail:

```
08-01  13     08-11  28     08-19  215
08-02  51     08-12  46     08-20  379
08-03   1     08-15  41     08-21  282   (partial day)
08-04  27     08-16  127
08-05  52     08-17  70
08-09   2     08-18  35
```

Whether that is the new run rate or a burst cannot be determined from this data. The 08-19→21
window is also the analysis push that produced `GOAL.md` and the fleet-architecture handoff, both
dated 08-21, which is exactly the shape of a burst.

*A month-end projection and its dollar cost were derived from the 292 min/day figure here. Both
were struck 2026-08-26 — see [What was struck, and why](#what-was-struck-and-why).*

---

## What ran — last 30 days

**Window: 2026-07-23 → 2026-08-21.** Private repos only.

*A per-repo minute split for this window, and the rolling-30-day total it summed to, were struck
2026-08-26 — see [What was struck, and why](#what-was-struck-and-why). What survives below is run
counts, which come from a different API and were never in doubt.*

### Per workflow

Run counts and conclusions are **measured**. Wall-minutes are measured but are **not** billable
minutes — see the app-starter caveat below. Nothing here apportions billable minutes, because
nothing can (see [Method](#method)).

| Repo | Workflow | Runs | Failed | Skipped | Wall-min |
|---|---|---|---|---|---|
| Lumaria | **CI** | 83 | **24 (29%)** | 0 | 478.3 |
| Lumaria | Triage new issues | 139 | 0 | 37 | 139.7 |
| Lumaria | License Gate | 16 | 1 | 0 | 14.2 |
| PWPP-Projects | Triage new issues | 48 | 1 | 5 | 109.9 |
| PWPP-Projects | tests | 40 | 6 | 0 | 34.2 |
| agent-skills | Triage new issues | 96 | 2 | 20 | 101.4 |
| app-starter | CI | 9 | 5 | 0 | *see caveat* |
| app-starter | License Gate | 6 | 0 | 0 | *see caveat* |
| app-starter | Sandcastle-era workflows (12) | 48 | 0 | **48** | ~2.4 |

What the run counts alone support, with no minute figures attached: **Lumaria's CI is the heavy
workload** — it runs six jobs per run against everything else's one, so its 83 runs are ~498
job-runs where triage's 139 runs are 102 billable job-runs after 37 skips. Job-runs are a proxy for
cost, not a measure of it.

*A billable-minute split for Lumaria's workflows, and an estate-wide share for the Claude-driven
`claude-code-action` workload, were derived from the struck per-repo split and went with it.*

### Two caveats that matter

**Wall-clock is not billable time.** app-starter's `CI` shows 4,351 wall-minutes across 9 runs —
**483 minutes per run** for an ordinary CI job — and `License Gate` 4,323 across 6, at 720 minutes
per run. Those runs sat queued or waiting, and `updated_at - run_started_at` counts the idling. The
repo's actual billed total for the window was smaller by more than an order of magnitude. This is
the document's most reusable finding: **`updated_at - run_started_at` is not a cost signal**, and
any future attempt to measure spend from the runs API rather than the billing API will be wrong in
this direction.

**app-starter is still running era-5 machinery.** Twelve Sandcastle-era workflows —
`Implement: PR #n`, `Review: PR #n`, `Update branch: PR #n`, `Auto-merge: arm PR #n` — fired 48
times in the window and were **skipped every time**. They cost essentially nothing, but Sandcastle
was retired 2026-07-02 and its label state machine is still installed and still triggering. Noted
here because it is evidence for
[claude-workflow#4](https://github.com/collod873/claude-workflow/issues/4), not because it is a
cost problem.

## The cheapest available lever is not a vendor

**Lumaria's CI was 49% red in August — 22 failures against 23 successes** (plus one cancelled). In
the last three days, 11 failures against 21 successes. Over the full 30-day window the rate is
lower but still bad: **24 failures in 83 runs, 29%**. August is materially worse than the month
before it.

Between a third and a half of the runs on the estate's heaviest workflow are failures, and a failed
run bills the same as a passing one. A sampled failing run had four of its six jobs red — `build`,
`unit`, `lint` and `typecheck` — while `changes` and `integration` passed.

Two things follow:

1. **No runner vendor addresses this.** A machine twice as fast fails twice as fast. Cutting the
   red rate is a larger saving than any per-minute discount on offer, and it costs nothing.
2. **It corroborates `GOAL.md` §4 blocker 5.** The pre-merge gate is gone, and 12 broken commits
   reached `main` in five days. A 49% red CI is what that looks like from the billing side.

This document does not rule on whether the failures are real breakage or infra flake — the sampled
run is genuine `build`/`unit`/`lint`/`typecheck` breakage, not runner error, but one sample is not
a rate. That distinction belongs to whoever acts on it.

---

## What the options cost

**This document no longer prices the options.** The costing table was derived entirely from the
struck month-end projection, so it went with it — and the ruling that followed makes the question
moot rather than merely unanswered.

Ruled by the owner, 2026-08-26:

> *"We are actively using GitHub minutes. That over-2000 number was obviously broken and you can't
> seem to find it so stop trying and stop referencing a number that was sourced incorrectly. I am
> not worried about the minutes right now — if we ever hit the minutes limit then I will rethink
> things, not before."*

[ADR-0024](../adr/0024-there-is-no-daily-spend-ceiling-and-the-governor-stops-on-qu.md) carries this
as **runner minutes are not an input**. The trigger for revisiting is a
GitHub bill, not a projection: **nothing has ever been charged**, and until something is, there is
no cost question here to answer. A runner-vendor comparison remains filed as
[claude-workflow#5](https://github.com/collod873/claude-workflow/issues/5) and is not blocked on
this document.

The one lever that survives is free and unpriced: **cut the 29–49% red rate**. It needs no vendor,
no plan change and no measurement, and it is the section above.

---

## What was struck, and why

Struck 2026-08-26 under
[claude-workflow#101](https://github.com/collod873/claude-workflow/issues/101). The figures below
were labelled **measured** and could not be reproduced against any API call. They were cited in
[#84](https://github.com/collod873/claude-workflow/issues/84)'s grilling round as the anchor for
implementer concurrency before the owner struck them.

They are **removed rather than crossed out**, deliberately: a struck number left on the page is
still a number a session can grep, quote and reason from, which is the failure this edit exists to
stop. What was removed:

- The **rolling-30-day total** and its "at the cap" reading.
- The **per-repo minute split** for that window, which summed to it.
- The **derived per-workflow billable splits** for Lumaria and the estate-wide `claude-code-action`
  share, which were apportioned within that split.
- The **month-end projection** extrapolated from the 292 min/day burst, and the **dollar figures**
  derived from it, including the options costing table.

**Do not re-derive them.** The owner's position above is standing, not provisional. If a future
session needs a real number, the reproducible path is the per-calendar-month billing API call in
[Method](#method) — which is what the surviving monthly table came from — and the answer it gives
today is `$0.00`.

**What survives, and was never in doubt:** nothing has ever been charged; the per-calendar-month
minute table and the July step change at `80d10ae`; wall-clock is not billable time; and Lumaria
CI's 49% August red rate.

---

## Method

- **Source of truth:** `GET /users/collod873/settings/billing/usage`, per-month, aggregated by
  repository and by day with `jq`. The older
  `/users/{user}/settings/billing/actions` endpoint is **retired** and returns HTTP 410.
- **Requires the `user` OAuth scope**, which the session token did not carry. Added on 2026-08-21
  with `gh auth refresh -h github.com -s user`; `repo` alone is not sufficient for billing.
- **Run counts and conclusions:** `gh run list` and `GET /repos/{owner}/{repo}/actions/runs`,
  filtered to `created >= 2026-07-23` for the 30-day tables and `created >= 2026-08-19` for the
  burst-window contrast. These are the surviving 30-day figures; they are run counts, not minutes.
- **The per-run timing endpoint is unusable on this plan.**
  `GET /repos/{owner}/{repo}/actions/runs/{id}/timing` returns `billable.UBUNTU.total_ms: 0` for
  every run sampled, including runs the billing API bills for. **There is therefore no way to
  measure a per-workflow billable split on this account**, and this document no longer attempts one
  — the derived splits it used to carry were struck with the per-repo total they apportioned.
- **Not captured:** Actions storage (billed in GigabyteHours, also $0.00 net) is excluded
  throughout; it is immaterial at this scale.
