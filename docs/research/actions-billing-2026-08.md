# GitHub Actions billing — what the estate actually spends

**Read:** 2026-08-21 · **Resolves:** [claude-workflow#2](https://github.com/collod873/claude-workflow/issues/2)

**Status:** Minutes, dollars and run counts are **measured** — pulled from GitHub's billing usage
API and the Actions runs API on 2026-08-21, over a rolling 30-day window (2026-07-23 → 2026-08-21)
plus per-calendar-month totals. Per-workflow **billable** splits are **derived**, not measured, and
each derivation is shown; the timing endpoint is unusable on this plan (see [Method](#method)).
Wall-clock minutes are measured but are not billable minutes. Projections are labelled as such at
the point of use.

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

**Projection (not measured).** If 292 min/day is the new normal, the month lands at roughly
**9,050 minutes** — 7,050 over the cap, which at $0.006/min is **≈ $42/month**. The cap itself
would be crossed in about seven more days.

If the last three days are a burst from the 2026-08-19→21 analysis push — the window that produced
`GOAL.md`, `INDEX.md` and the fleet-architecture handoff, all dated 08-21 — then the estate is at
July's ~82% and there is no bill at all.

**Which of those two it is cannot be determined from this data.** It needs another week of
observation, and that is the single most useful thing to know before spending money.

---

## Where the minutes go — last 30 days

**Window: 2026-07-23 → 2026-08-21.** Private repos only.

| Repo | Minutes | Share |
|---|---|---|
| **Lumaria** | **1,538** | **76.1%** |
| app-starter | 192 | 9.5% |
| PWPP-Projects | 163 | 8.1% |
| agent-skills | 123 | 6.1% |
| 3D-Printing | 6 | 0.3% |
| **TOTAL** | **2,022** | — |

**2,022 minutes against a 2,000-minute allowance.** On a rolling 30-day basis the estate is already
at the cap. It has not been *charged* because billing is per calendar month and no single month has
crossed — July closed at 1,647 and August is mid-cycle — but there is no headroom left in the
current rate of work.

### Per workflow, same 30 days

Run counts and conclusions are **measured**. Wall-minutes are measured but are **not** billable
minutes — see the app-starter caveat below.

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

**Derived split for Lumaria's 1,538 minutes** — CI runs six jobs per run, each rounded up to the
whole minute (83 × 6 = 498 job-runs at minimum); triage runs one job and 37 of its 139 runs were
skipped, which bill nothing; License Gate runs one job:

| | Derived billable | Share of Lumaria |
|---|---|---|
| **CI** | **≈ 1,380 min** | **≈ 90%** |
| Triage | ≈ 105–140 min | ≈ 8% |
| License Gate | ≈ 16 min | ≈ 1% |

**Estate-wide, the same shape holds.** Summing the Claude-driven `claude-code-action` workload
across all three repos that run it — Lumaria, PWPP-Projects, agent-skills — gives roughly
**250–290 billable minutes, about 13% of the estate's 2,022**. The remaining ~87% is plain
CPU-bound CI.

### Two caveats that matter

**Wall-clock is not billable time.** app-starter's `CI` shows 4,351 wall-minutes across 9 runs and
`License Gate` 4,323 across 6 — yet the repo billed **192 minutes total** for the whole window.
Those runs sat queued or waiting, and `updated_at - run_started_at` counts the idling. This is why
the billing API is treated as the source of truth throughout and wall-clock is only ever used to
apportion within a repo whose total is already known.

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

Between a third and a half of the dominant cost is being spent on runs that fail. A sampled failing run had four
of its six jobs red — `build`, `unit`, `lint` and `typecheck` — while `changes` and `integration`
passed.

Two things follow:

1. **No runner vendor addresses this.** A machine twice as fast fails twice as fast. Cutting the
   red rate is a larger saving than any per-minute discount on offer, and it costs nothing.
2. **It corroborates `GOAL.md` §4 blocker 5.** The pre-merge gate is gone, and 12 broken commits
   reached `main` in five days. A 49% red CI is what that looks like from the billing side.

This document does not rule on whether the failures are real breakage or infra flake — the sampled
run is genuine `build`/`unit`/`lint`/`typecheck` breakage, not runner error, but one sample is not
a rate. That distinction belongs to whoever acts on it.

---

## What the options cost, at the projected rate

Priced against the ~9,050 min/month projection, which is the pessimistic case:

| Option | Monthly cost | Note |
|---|---|---|
| Do nothing, stay on Free | **≈ $42** | 7,050 min over at $0.006/min |
| GitHub Team | **≈ $40** | $4/user + 6,050 min over |
| Cut the 29–49% red rate | **≈ $21–30** | Free to attempt; no vendor involved |
| Third-party fleet | not priced here | See [claude-workflow#5](https://github.com/collod873/claude-workflow/issues/5) |

At July's rate instead of the projection, every row is **$0**.

The absolute numbers deserve stating plainly: the worst realistic case for the whole estate is
**about forty dollars a month**. That is a real input to the vendor ruling — it bounds how much
effort any migration can be worth.

---

## Method

- **Source of truth:** `GET /users/collod873/settings/billing/usage`, per-month, aggregated by
  repository and by day with `jq`. The older
  `/users/{user}/settings/billing/actions` endpoint is **retired** and returns HTTP 410.
- **Requires the `user` OAuth scope**, which the session token did not carry. Added on 2026-08-21
  with `gh auth refresh -h github.com -s user`; `repo` alone is not sufficient for billing.
- **Run counts and conclusions:** `gh run list` and `GET /repos/{owner}/{repo}/actions/runs`,
  filtered to `created >= 2026-07-23` for the 30-day tables and `created >= 2026-08-19` for the
  burst-window contrast.
- **The per-run timing endpoint is unusable on this plan.**
  `GET /repos/{owner}/{repo}/actions/runs/{id}/timing` returns `billable.UBUNTU.total_ms: 0` for
  every run sampled, including runs the billing API bills for. The per-workflow split above is
  therefore **derived** from job counts × runs × per-job minute rounding, cross-checked against the
  measured 1,538-minute Lumaria total for the 30-day window. Treat it as an attribution estimate,
  not a measurement.
- **Not captured:** Actions storage (billed in GigabyteHours, also $0.00 net) is excluded
  throughout; it is immaterial at this scale.
