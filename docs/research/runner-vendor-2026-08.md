# The runner vendor does not earn an ADR

**Ruled:** 2026-08-22 · **Resolves:** [claude-workflow#10](https://github.com/collod873/claude-workflow/issues/10)

**The ruling: GitHub-hosted runners, no change, and no ADR.** This note is the record instead, and
it names the thresholds that would reopen the question.

---

## 1. The ADR bar, applied one test at a time

`docs/adr/README.md` requires all three. This clears one and a half.

| Test | Verdict |
|---|---|
| **Hard to reverse** | **Fails.** Changing runner vendor is a one-line `runs-on:` edit per workflow. Reversible in an afternoon, with no data migration and no dependent mechanism |
| **Surprising without context** | Passes. "Why not a cheaper fleet?" is a question a future reader will genuinely ask, and the answer — eligibility, not price — is not guessable |
| **A genuine trade-off** | Passes, narrowly. Three options were priced against two workloads; one was picked for stated reasons |

One failure is enough. The honest output is a findings note, which is what
[claude-workflow#10](https://github.com/collod873/claude-workflow/issues/10) predicted it would be,
and what the map's destination allows as its third record.

The substance already sits in an ADR anyway. [ADR-0002](../adr/0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md)
rules that work executes on GitHub-hosted runners and lists managed fleets and self-hosted boxes
among its considered options. That ADR earned its place on the *venue* question, which is hard to
reverse. The vendor rides along; it does not need a record of its own to be binding.

## 2. The vendor is closed on eligibility, not on price

From [Price the managed runner fleets against both workloads](https://github.com/collod873/claude-workflow/issues/5),
measured against live vendor pricing:

- **`collod873` is a personal User account in zero organizations.** Blacksmith, Depot and Namespace
  all require a GitHub organization. Ineligible — not expensive, *unavailable*.
- **RunsOn is not a managed fleet.** Its own license §7 says *"RunsOn is self-hosted software."*
  [ADR-0002](../adr/0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md) already
  rejected self-hosted.
- **WarpBuild is the only survivor, and it loses:** **$9.79/mo against the status quo's $2.68/mo.**

The mechanism behind that number is the finding worth keeping. A fleet runner registers as
*self-hosted*, and GitHub does not bill self-hosted usage — so the 2,000 included minutes are
neither consumed nor credited. **They go unused.** Switching does not trade $14.68 for $9.79; it
trades $2.68 for $9.79.

## 3. The two workloads, ruled separately — and why one answer still covers both

[claude-workflow#10](https://github.com/collod873/claude-workflow/issues/10) was right that a single
vendor answer is *probably* wrong, because the workloads have opposite economics. They do. The answer
is still single, and the reason is not that they are alike.

**Workload A — CPU-bound CI.** ~87% of the estate; Lumaria's `CI` derives to ≈1,380 of its 1,538
billable minutes over the measured 30 days. A faster machine really does mean fewer minutes here, so
the fleet pitch is true on its own terms. It still loses on arithmetic: every eligible vendor prices
Linux at exactly **$0.002/vCPU/min**, so scaling up is cost-neutral by construction — 2,216 min × 2
vCPU × $0.004 = $8.86, and a perfect 2× speedup on 4 vCPU is 1,108 × $0.008 = $8.86, identical.
Bigger runners buy wall-clock, never money. Even a *free* 2× lands at $5.35/mo against $2.68.

**Workload B — model-latency-bound agent work.** The `claude-code-action` runs across Lumaria,
PWPP-Projects and agent-skills total roughly **250–290 billable minutes, ~13% of the estate's 2,022**.
A faster machine changes nothing but the per-minute rate, and the best achievable saving across every
vendor on this workload is **$0.69/month**.

**The ticket's own idea is the one structurally sound argument, and it has nowhere to land.** Sending
the CPU-bound half off GitHub-hosted so the free 2,000 minutes go to agent work instead of
`pnpm check` is correct reasoning — §2's unused-minutes mechanism is exactly what makes it work. But
the only destinations for that half are a managed fleet (ineligible: no organization) or a
self-hosted box (rejected by [ADR-0002](../adr/0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md)
on C4 and on RAM). So one answer covers both workloads **not because the workloads are alike, but
because only one destination is open to either of them.**

That is a contingent reason, not a structural one, which is why §5's first threshold matters more
than the price table.

## 4. The cheapest lever is not a vendor, and it is not close

Two levers beat every vendor on offer, both at $0/month.

**Per-job round-up costs about as much as all the agent work in the estate combined.** Lumaria's CI
runs **5.4 jobs per run at an 84-second median**, and each job rounds up to a whole billed minute:
10.87 raw minutes bill as 13.50. That is **+24% with zero relationship to machine speed**. Against
CI's ≈1,380 billable minutes, the round-up alone is **≈270 minutes per month** — the same order as the
entire 250–290-minute `claude-code-action` workload. Consolidating jobs reclaims it without changing
vendor, plan, or anything about the machine. Of the vendors, only Depot's per-second billing erases
it outright; Namespace's 1-minute floor reproduces it, and Blacksmith and WarpBuild do not document
it — so this is a lever the market mostly does not sell.

**The red rate is the other half.** Lumaria's CI was **29% red over the measured 30 days and 49% in
August** — 22 failures against 23 successes. Between a third and a half of the dominant cost is spent
on runs that fail, and a machine twice as fast fails twice as fast. This corroborates `GOAL.md` §4
blocker 5 from the billing side.

**Order matters:** take the free 24% before buying a per-minute discount. A vendor bought first would
be sized against inflated demand.

## 5. What would reopen this

- **An organization gets created for any other reason.** Blacksmith's 3,000 free org-minutes would
  cover the whole estate at **$0/mo while leaving GitHub's 2,000 as unused headroom** — strictly
  better than today. This is the threshold most likely to fire, and note that it is a decision about
  *creating an org*, not about picking a vendor.
- **The cap blocks, and the block is caused by CI minutes rather than agent minutes, after job
  consolidation has landed.** All three clauses required. The estate sits at **2,022 measured minutes
  against 2,000** on a rolling 30 days, so the block is plausible — but a block caused by round-up
  waste is an argument for §4, not for a vendor.
- **GitHub reinstates its postponed self-hosted platform charge.** The $0.002/min charge announced
  2025-12-16 for 2026-03-01 was *postponed, not cancelled*. If reinstated, WarpBuild's $0.004 becomes
  $0.006 — exactly GitHub's rate — while GitHub's free 2,000 stay free. Recorded because it looks like
  a reopening condition and is the opposite: it closes the question harder.

Not a price cut from any vendor on its own. At $0.00 actually charged, a discount on zero is zero.

## 6. The monthly figure

**$0.00 per month, and $0.00 every month since March 2026.** The account is on GitHub Free with the
2,000-minute private-repo allowance, and `netAmount` is $0.00 on every line item measured.

| Option | Monthly cost |
|---|---|
| **GitHub-hosted, Free plan — chosen** | **$0.00 actually charged** ($2.68 if the same usage were metered) |
| WarpBuild x86 2× | $9.79 |
| Namespace Developer | $14.68 |
| Self-hosted on a rented VPS | ~$32.00, plus a machine to keep alive |
| Blacksmith / Depot | ineligible — no organization |

Nothing on this table is worth a decision at these amounts, which is the deepest reason the question
does not earn an ADR: **the whole spread between best and worst is under $15/month, on a bill that is
currently zero.**

---

## Sources

- [claude-workflow#2](https://github.com/collod873/claude-workflow/issues/2) — the measured billing,
  `docs/research/actions-billing-2026-08.md` on branch `research/actions-billing`. Every minute and
  dollar figure above is from there, not from the ~1,700 min/mo estimate this question was chartered
  with
- [claude-workflow#5](https://github.com/collod873/claude-workflow/issues/5) — vendor eligibility,
  the unused-minutes mechanism, the $0.002/vCPU/min identity, and the per-job round-up
- [claude-workflow#7](https://github.com/collod873/claude-workflow/issues/7) — stay on Free, accept
  the cap
- [ADR-0002](../adr/0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md) — the venue
  ruling this one rides inside
