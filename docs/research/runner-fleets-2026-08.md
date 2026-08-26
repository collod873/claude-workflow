# Managed runner fleets, priced against both workloads

Research for [#5](https://github.com/collod873/claude-workflow/issues/5), under map
[#1](https://github.com/collod873/claude-workflow/issues/1). Every page cited was read
**2026-08-21**; every price is the vendor's own published figure on that date. Rates in this
market moved on 2026-01-01, so a price without a read date is worthless.

## The answer in one paragraph

Four of the five candidates are out before price is discussed. **Blacksmith, Depot and Namespace
all require the repository to be owned by a GitHub *organization*.** `collod873` is a personal
User account and belongs to no organizations, so none of the three can be installed at all.
**RunsOn is not a managed fleet** — it is self-hosted software that runs EC2 in your own AWS
account, which this ticket explicitly scopes out. That leaves **WarpBuild**, which documents no
org requirement — and WarpBuild costs *more* than the status quo, because the status quo is free.
GitHub's own billing API says the entire estate has paid **$0.00** for Actions every month since
March 2026. Every fleet bills from the first minute, so switching forfeits GitHub's 2,000 free
private-repo minutes — worth $12/mo at list — to buy minutes that currently cost nothing.

---

## 1. The baseline: what is actually being spent

Not modelled. Read from GitHub's billing API (`GET /users/collod873/settings/billing/usage`,
read 2026-08-21), which is the real invoice.

| Month | Actions minutes, all repos | Gross at list | **Net billed** |
|---|---|---|---|
| 2026-03 | 603 | $3.62 | **$0.00** |
| 2026-04 | 56 | $0.34 | **$0.00** |
| 2026-05 | 1,219 | $7.31 | **$0.00** |
| 2026-06 | 2,152 | $12.91 | **$0.00** |
| 2026-07 | 1,647 | $9.88 | **$0.00** |
| 2026-08 (1st–21st) | 1,401 | $8.41 | **$0.00** |

June's 2,152 looks like it breached the 2,000 cap; 2,005 of it was `claude-ds`, which is public
and therefore free. Stripping the two public repos (`nihongo`, `claude-ds`), **August's private
usage is 1,371 minutes over 21 days, projecting to 2,024 for the full month — 101% of the Free
allowance, a $0.14 overage.** The estate is sitting exactly on the line, and has never crossed it.

The API also confirms the rate the ticket asked me not to assume: every `Actions Linux` row
carries `"pricePerUnit": 0.006`.

## 2. GitHub's own numbers, verified

| Fact | Value | Source (read 2026-08-21) |
|---|---|---|
| Linux x86 2-core | **$0.006/min** | [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) |
| Linux ARM 2-core | **$0.005/min** | same |
| Linux x86 larger, 4 / 8 / 16 / 32 / 64 vCPU | $0.012 / $0.022 / $0.042 / $0.082 / $0.162 per min | same |
| Linux ARM larger, 4 / 8 / 16 / 32 / 64 vCPU | $0.008 / $0.014 / $0.026 / $0.050 / $0.098 per min | same |
| Free plan, private repos | **2,000 min/mo** | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Team plan | **$4/user/mo**, **3,000 min/mo** | [pricing](https://github.com/pricing), [products](https://docs.github.com/en/get-started/learning-about-github/githubs-products) |
| Billing granularity | *"GitHub rounds the minutes and partial minutes each job uses up to the nearest whole minute."* — **per job** | [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) |
| Included minutes on larger runners | *"Included minutes cannot be used for larger runners."* | same |

**Correction to the ticket's premise.** The Jan 2026 cut was real but asymmetric.
[github/roadmap#1196](https://github.com/github/roadmap/issues/1196) publishes the old-vs-new
table: Linux x86 2-core went $0.008 → $0.006 (−25%); **Linux ARM 2-core was already $0.005 and
did not change.** Announced [2025-12-16](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/),
effective [2026-01-01](https://github.blog/changelog/2026-01-01-reduced-pricing-for-github-hosted-runners-usage/).
Any argument resting on "ARM got cheaper in January" is built on a false premise.

**The live tail risk everyone in this market is watching.** The same December announcement
introduced a **$0.002/min Actions cloud platform charge on self-hosted runner usage**, effective
2026-03-01 — and every fleet in this report registers as a self-hosted runner. GitHub then
**postponed it**: the changelog now carries *"We're postponing the announced billing change for
self-hosted GitHub Actions to take time to re-evaluate our approach."* Current docs still read
*"GitHub Actions usage is free for standard GitHub-hosted runners in public repositories, and for
self-hosted runners"*
([billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage), read
2026-08-21). Postponed, not cancelled, with no new date. If it lands, it adds $0.002/min to every
fleet's rate and hits the cheap 2-vCPU tiers hardest — WarpBuild's $0.004 becomes $0.006, exactly
GitHub's own rate. Both [WarpBuild](https://www.warpbuild.com/blog/github-actions-price-change)
and [RunsOn](https://runs-on.com/blog/github-self-hosted-runner-fee-2026/) published on it; RunsOn's
post carries a 2025-12-17 update reading *"GitHub has suspended the fee for now."*

## 3. The two workloads, measured

Both measured from the GitHub Actions API against `collod873/Lumaria` on 2026-08-21 — 30 most
recent non-cancelled runs each, job durations summed, and separately summed with each job rounded
up to a whole minute the way GitHub bills.

### Workload A — `ci.yml`, CPU-bound (biome + eslint + tsc + vitest)

| Measure | Value |
|---|---|
| Jobs per run | 5.4 |
| Raw machine-minutes per run | 10.87 mean / 10.71 median |
| **GitHub-billed minutes per run** (per-job round-up) | **13.50 mean** |
| Median job duration | 84 s |
| Run rate | ticket reference **5.4/day**; measured 9.68/day lifetime (630 runs / 65.1 days), 2.77/day over the last 30 days |

At the ticket's 5.4 runs/day: **164 runs/mo → 1,784 raw machine-min → 2,216 GitHub-billed min.**
That reference rate is conservative — Lumaria's actual July bill was 1,506 minutes.

**The rounding tax is the non-obvious number here.** 5.4 jobs per run at a median 84 s means
GitHub rounds up 5.4 times per run, turning 10.87 raw minutes into 13.50 billed — a **+24%
surcharge that has nothing to do with how fast the machine is.**

### Workload B — `triage.yml` running `anthropics/claude-code-action@v1`, latency-bound

| Measure | Value |
|---|---|
| Jobs per run | 1.0 |
| Job duration | 68 s mean / 44 s median / 143 s p90 / **317 s max** |
| **GitHub-billed minutes per run** | **1.43** |
| Trigger rate | 139 triggers over 19.1 days; **37 skipped at the `if:` guard** (zero cost) → **5.3 billable runs/day** |

**161 runs/mo → 171 raw machine-min → 230 GitHub-billed min.** One job per run means almost no
rounding tax. The `if:` guard suppressing 27% of triggers is already the single largest cost
control on this workload, and it is free.

**Combined: ~2,447 GitHub-billed minutes/month, $14.68 gross, $2.68 net after the Free allowance.**
That $2.68 — thirty-two dollars a year — is the entire prize any vendor is competing for.

---

## 4. The candidates

### Blacksmith — **ineligible**

| | |
|---|---|
| **Linux x86 $/min** | 2 vCPU **$0.004** · 4 **$0.008** · 8 **$0.016** · 16 **$0.032** · 32 **$0.064** ([pricing](https://www.blacksmith.sh/pricing), read 2026-08-21) |
| **Linux ARM $/min** | 2 vCPU **$0.0025** · 4 **$0.005** · 8 **$0.01** · 16 **$0.02** · 32 **$0.04** (same) |
| **Free tier** | *"Blacksmith provides `3000 x64 2vCPU minutes` for free per month per organization."* Consumed proportional to vCPU: a 10-min job on 4 vCPU spends 20 credits. ([docs](https://docs.blacksmith.sh/blacksmith-runners/overview.md), read 2026-08-21) |
| **Private repos** | **Supported — but note this is inference, not a stated claim.** The free tier is worded *"per month per **organization**"*, not per public repo ([docs](https://docs.blacksmith.sh/blacksmith-runners/overview.md), read 2026-08-21), and the only account-level restriction Blacksmith states anywhere is the org requirement below — never a visibility one. Blacksmith also runs a separate application-gated OSS programme for public repos, which would be redundant if the 3,000 minutes were public-only. No page says "private repositories are supported" in those words. |
| **Custom actions** | **Yes, sourced.** *"Blacksmith runners boot off of the same image(s) as GitHub's runners and have the exact same environment."* Docs link each image to GitHub's own `actions/runner-images` READMEs. Third-party actions are named explicitly in the [support terms](https://docs.blacksmith.sh/about/support-terms.md) exclusion list (*"Third-party GitHub Actions…"*) — a support-scope carve-out that presupposes they run. `actions/cache` works unmodified and is transparently redirected to Blacksmith's own cache. Docker actions, `services:` containers and `container:` jobs all supported on Linux. No source names `claude-code-action` specifically. |
| **Migration** | GitHub App install (org-level), then one line per job: `ubuntu-latest` → `blacksmith-2vcpu-ubuntu-2404`. Footgun: the App must be installed on *every* repo using a `blacksmith-*` label, because runners register org-wide. Rollback is the inverse one-line edit; not documented as a procedure. |
| **Other levers** | Dependency cache free, 25 GB/repo/week. Docker container cache free. Docker *layer* cache and sticky disks billed **+$0.50/GB/mo**. Static IPs **+$100/IP/mo**. Premium support is *"the greater of US $250 per month or 5% of the customer's monthly Blacksmith spend."* No seat fee, no platform fee. |
| **Billing granularity** | **Not documented anywhere.** Neither the pricing page, the docs, nor the ToS state per-second vs per-minute rounding. |
| **Jan 2026 change** | None from Blacksmith. Their [2025-12-16 post](https://www.blacksmith.sh/blog/actions-pricing) covers GitHub's change only. Note the internal drift: docs still say *"exactly half the cost of GitHub's per minute"* while the pricing page now says *"33% cheaper"* — GitHub's price moved, Blacksmith's didn't. |

> **Blocker.** [Quickstart](https://docs.blacksmith.sh/introduction/quickstart.md), read 2026-08-21:
> *"Blacksmith is limited to GitHub organizations and not available for personal repositories."*
> `collod873` is a User account (`gh api users/collod873 --jq .type` → `User`) in zero
> organizations (`gh api user/orgs` → empty). **Cannot be used.**

This is the painful one. Its 3,000 free org-minutes would cover the entire measured estate at
$0/mo *while leaving GitHub's 2,000 free minutes untouched as headroom* — the only candidate that
is strictly better than the status quo on price. The blocker is account structure, not money.

### Depot — **ineligible**

| | |
|---|---|
| **Linux $/min** | 2 vCPU **$0.004** · 4 **$0.008** · 8 **$0.016** · 16 **$0.032** · 32 **$0.064** · 64 **$0.128**. **ARM priced identically to x86.** ([runner types](https://depot.dev/docs/github-actions/runner-types), read 2026-08-21) |
| **Free tier** | **None.** A 7-day trial, *"no credit card required"*, with no documented usage cap. ([pricing](https://depot.dev/pricing), read 2026-08-21) |
| **Private repos** | **Supported, and the default case — it is *public* repos that need an extra step.** The [quickstart](https://depot.dev/docs/github-actions/quickstart) (read 2026-08-21) carries no setup instruction for private repos at all, and adds one only for public: *"In the **Actions > Runner groups** section in your GitHub organization settings, select **Allow public repositories**."* The [overview](https://depot.dev/docs/github-actions/overview) (read 2026-08-21) confirms both visibilities are in scope when it describes cache isolation — *"One repository can't unexpectedly read cache entries from another repository of a different trust level (for example, a public repository reading from or writing to a private repository)."* No plan gate: the [pricing page](https://depot.dev/pricing) (read 2026-08-21) segments by users and included minutes, never by repository visibility, so no tier is public- or OSS-only. Depot publishes no free tier for public repos either, which is why nothing here changes the arithmetic in §5. |
| **Plans** | **Developer $20/mo** (1 user, 2,000 Actions min incl.) · **Startup $200/mo** (unlimited users, 20,000 min) · Business custom. Overage $0.004/min. Minutes carry a **multiplier**: a 16-vCPU runner burns included minutes 8× faster. |
| **Custom actions** | **Yes, and sourced by name.** Depot's CEO published [*"Faster Claude Code agents in GitHub Actions"*](https://depot.dev/blog/claude-code-in-github-actions), which walks through `anthropics/claude-code-action` and states *"just update the `runs-on` section… to use `depot-ubuntu-latest`"*. Architecturally: Depot *"Runs the entire job using GitHub's standard runner image on the instance"* — GitHub's own runner agent, so action resolution is not Depot's surface at all. `actions/cache` works and is transparently redirected. Egress default-open. |
| **Migration** | GitHub App install, verify the org's default runner group, then `runs-on: depot-ubuntu-24.04`. Per-job, so migratable one job at a time. Rollback is the inverse edit. |
| **Billing granularity** | **Best in the field, and explicitly stated:** *"billed on a per-minute basis, tracked per second… We don't enforce a one minute minimum, so if you run a 30 second build, you'll only be billed for 30 seconds."* |
| **Known limits** | No `/dev/kvm`. Single runner label only. ~70 GB of the listed disk is consumed by the image. Windows has no Hyper-V. |
| **Jan 2026 change** | None found. All three January changelog entries are feature work. Depot appears never to announce pricing in its changelog, so absence is weak evidence. |

> **Blocker.** [Overview](https://depot.dev/docs/github-actions/overview), read 2026-08-21:
> *"To use Depot runners, your repository must be owned by a GitHub organization (not a personal
> account)."* **Cannot be used.**

Even if eligible, the **$20/mo floor** kills it at this volume. The saving vs GitHub is $0.002/min
and only on minutes *above* GitHub's 2,000 free — so the $20 fee needs 10,000 chargeable minutes
to pay for itself, i.e. **~12,000 min/mo total, roughly 5× current consumption**.

Depot's per-second billing is nonetheless the single most interesting mechanism found: it would
erase workload A's 24% rounding tax outright, with no speed claim required.

### Namespace — **ineligible**

| | |
|---|---|
| **Pricing model** | Synthetic compute units: *"1 vCPU + 2 GB RAM for 1 minute × platform multiplier"* (Linux 1×), with off-ratio shapes charged `max(vCPU, GB÷2)`. ([pricing.md](https://namespace.so/pricing.md), read 2026-08-21) |
| **Linux $/min** | 2 vCPU/4 GB **$0.002** prepaid / **$0.003** overage · 2 vCPU/8 GB and 4/8 **$0.004** / **$0.006** · 4/16 and 8/16 **$0.008** / **$0.012** · 8/32 and 16/32 **$0.016** / **$0.024** · 16/64 and 32/64 **$0.032** / **$0.048** |
| | **ARM64 is priced identically to x86** — one Linux table covers both. |
| **Free tier** | **None.** A 30-day trial of the Developer plan. |
| **Private repos** | **Supported, with no visibility distinction anywhere in the product.** The words *"private repository"*, *"public repository"*, *"open source"* and *"OSS"* appear nowhere in the [pricing page](https://namespace.so/pricing.md) or [billing docs](https://namespace.so/docs/workspaces/billing-and-limits.md) (both read 2026-08-21) — Namespace segments by compute units and plan, never by repo visibility, so no tier is public-only and none is withheld from private repos. Access is scoped by the GitHub App install, which offers *"all repositories or just a selection"* ([migration](https://namespace.so/docs/solutions/github-actions/migration.md), read 2026-08-21). Since there is also no free tier, private-repo support costs the same as anything else: full rate from minute one. |
| **Plans** | **Developer $0/mo** pay-as-you-go (32 vCPU concurrency cap, 3 h max job) · **Team $100/mo** (100,000 unit-min incl.) · **Business $250/mo** (250,000) · Enterprise custom. **No per-seat fee on any tier.** The prepaid column is what the $100/100,000 and $250/250,000 arithmetic works out to; Developer therefore pays the overage column — inferred from arithmetic, not stated. |
| **Custom actions** | **Yes, but the weakest evidence of the five.** Sourced: their images run GitHub's stock agent (*"The user in the final image must be `runner`. GitHub's runner software expects to run as this user."*), third-party action tarballs get a dedicated cache, and the runner config defines a **Restricted** access level for *"running fully untrusted third-party code"*. Job-level `container:` is supported. **But no page claims toolchain parity with `actions/runner-images`** — instead they ship `nsc github base-image describe` so you can diff it yourself, which suggests a leaner image. `claude-code-action@v1` is a composite/Node action so it needs little, but **parity is unverified**. |
| **Migration** | GitHub App install → `runs-on: namespace-profile-default` or `nscloud-ubuntu-22.04-amd64-8x16`. Only one `nscloud` label allowed. `docker/setup-buildx-action` must be **removed** if present. No systemd. `actions/cache` works but they push you to `nscloud-cache-action`, which **does not support cache keys** (*"cache uses are shared across all users of a particular profile, including main and branch runs"*). |
| **Billing granularity** | 1-minute floor with a 15-second grace: *"30 seconds of usage is 1 billable minute, 70 seconds is 1 billable minute, and 150 seconds are billed as 3 minutes."* Same rounding tax as GitHub. |
| **Cache billed separately** | **Yes, and it is a trap.** Two meters: snapshot usage **$0.002/GB-hr** charged for the whole time the volume is attached, sized by *configured* capacity — *"Snapshot usage typically dominates the cost of a cache volume"* — plus storage at $0.0048/GB-day. A 100 GB volume on a 10-minute job costs $0.033 in snapshot fees whether or not it hits. **Developer gets zero free allowance.** ([cache volumes](https://namespace.so/docs/architecture/storage/cache-volumes.md), read 2026-08-21) |
| **Jan 2026 change** | None. All five January changelog entries are feature work. |

> **Blocker.** [Migration guide](https://namespace.so/docs/solutions/github-actions/migration.md),
> read 2026-08-21: *"Namespace needs access to your GitHub organization to be able to register
> runners on your behalf"*, and the setup flow is *"click on **Connect Organization**… select which
> organization to connect."* No personal-account path is documented. **Cannot be used.**

Price-wise it would lose anyway: the Developer plan's overage rate for a 2 vCPU/8 GB shape is
**$0.006/min — identical to GitHub — with no free tier at all.** The $0.004 prepaid rate needs the
$100/mo Team plan.

### RunsOn — **not a managed fleet; out of scope by the ticket's own definition**

RunsOn draws the line itself. Its [alternatives page](https://runs-on.com/alternatives-to/github-actions-runners/)
(read 2026-08-21) buckets *"Namespace, Blacksmith, Ubicloud, Depot, WarpBuild"* as **"Third-party
hosted — managed"** and puts itself in a different bucket: **"AWS-native, your account —
self-hosted · ~10 min install."** Its [license](https://runs-on.com/legal/license/) §7 (effective
2026-06-05): *"RunsOn is **self-hosted software**. Customer installs and operates the Software in
Customer-controlled infrastructure… Seller has no access to Customer infrastructure."* Even the
trial runs in your account: *"there's no sandbox, because the product only ever runs in your
account."*

The ticket scopes self-hosted-on-a-rented-box to a separate ticket, deliberately, because it fails
and prices differently. RunsOn is that shape. Recorded for completeness:

| | |
|---|---|
| **License** | Flat **annual** fee per legal entity, keyed to monthly runner-launch volume, **no per-minute or per-seat charge**: Starter (<50k launches) **€300 / $350** · Growth (<200k) **€900 / $1,050** · Scale (<500k) **€1,800 / $2,100** · Enterprise (500k+) **€3,600 / $4,200**. ([pricing](https://runs-on.com/pricing/), read 2026-08-21; corroborated by the [2026-06-05 tier post](https://runs-on.com/blog/tier-based-pricing-for-flex-and-fleet/)) |
| **AWS cost** | Billed directly by AWS. Published all-in spot rates, us-east-1, incl. gp3 root volume: 2cpu x64 **$0.0010/min** · 4cpu $0.0017 · 8cpu $0.0027 · 2cpu arm64 $0.0009. On-demand runs 2.3–3.3× spot. |
| **Free tier** | Gated on *purpose*, not visibility: *"Nonprofit, open-source, educational, and personal non-commercial projects"*, requiring *"a public acknowledgement with a link to runs-on.com"*. Also a 15-day commercial trial. ([billing/free](https://runs-on.com/billing/free/), read 2026-08-21) |
| **Private repos** | **Supported with no gate at all** — the runners live in the customer's own AWS account and register against the customer's own GitHub, so repo visibility never reaches RunsOn's billing. The license is per legal entity by runner-launch volume, not by repo ([pricing](https://runs-on.com/pricing/), read 2026-08-21). Private repos even qualify for the free tier, because that tier tests *purpose* (*"personal non-commercial"*) rather than visibility — the one candidate here whose free tier a private repo can actually reach. |
| **Custom actions** | **Yes — the strongest per-vendor source in this whole report.** The Flex stack has an `EnableBedrock` parameter documented as *"runners can use their instance profile credentials with Bedrock-compatible AI agents such as **Claude Code** or OpenCode"*, plus a dedicated [AI agents](https://runs-on.com/docs/runners/capabilities/ai-agents/) docs page. Images are *"rebuilt and published every 15 days from the upstream official GitHub repository"* for parity. |
| **Real cost** | The AWS account, the VPC/NAT/IAM, raising your own EC2 quotas, applying every CloudFormation/Terraform upgrade by hand, and on-call for an internet-facing control plane in your own account. **v2 reaches end of life 2026-09-15 and v2→v3 is a rebuild from scratch**, not an in-place update. |

That last row is exactly the grooming obligation the charter's C4 bans and the map already flagged
as *"a grooming obligation that fails silently."* Cheapest per minute by a factor of six; most
expensive in attention, by far.

### WarpBuild — **the only candidate that survives eligibility, and it still loses**

| | |
|---|---|
| **Linux x86 $/min** | 2 vCPU **$0.004** · 4 **$0.008** · 8 **$0.016** · 16 **$0.032** · 32 **$0.064** ([cloud runners](https://www.warpbuild.com/docs/ci/cloud-runners) and [pricing](https://www.warpbuild.com/pricing), read 2026-08-21) |
| **Linux ARM $/min** | 2 vCPU **$0.003** · 4 **$0.006** · 8 **$0.012** · 16 **$0.024** · 32 **$0.048** — **25% below x86 at every size**, the only vendor here with a real ARM discount |
| **Free tier** | **$10 in signup credits, once.** *"WarpBuild pricing is purely usage based. There is no base subscription fee, no platform fee, and no seat fee, and signup includes $10 free credits."* ([vs GitHub Actions](https://www.warpbuild.com/compare/github-actions), read 2026-08-21). At the 2-vCPU rate that is 2,500 minutes, non-recurring. No public/OSS carve-out — the same page concedes *"GitHub-hosted runners remain the better choice for public repositories and for teams that stay inside GitHub's included minutes."* |
| **Private repos** | **Yes, the default case, no gate, no minimum, no plan tier.** It is **public** repos that need extra setup — the org's default runner group toggled to *"Allow public repositories"* ([public repos](https://www.warpbuild.com/docs/ci/public-repos), read 2026-08-21). Pricing is *"purely usage based"* with no visibility segment, so a private repo pays the same $0.004/min as anything else from the first minute. |
| **Organization required?** | **No documented requirement, and no documented support either.** I searched the quickstart, cloud-runners and public-repos docs: WarpBuild states neither that an org is required nor that personal accounts work. This is the one eligibility question in this report that a source could not answer. **Needs a smoke test before anything is decided on it.** |
| **Custom actions** | **Yes, but inferred, not stated.** *"WarpBuild runners are 100% compatible with GitHub-hosted runners and have the same tooling installed"*, each image linking to `actions/runner-images` ([preinstalled software](https://www.warpbuild.com/docs/ci/preinstalled-software)). *"Each runner runs in its own virtual machine"* ([security](https://www.warpbuild.com/docs/ci/security)) — full VM, which is what Docker actions need. `actions/cache@v4` compatibility is explicit via `warpbuilds/cache@v1`, enabled by default. Closest Anthropic-specific source: the [2026-08 changelog](https://www.warpbuild.com/docs/ci/changelog/2026-august) — *"WarpBuild Linux and macOS runners can now be the `self_hosted` execution environment for Anthropic's Claude Managed Agents"* — but that is a **different integration** (dashboard API key + webhook), not `claude-code-action` in a normal workflow. **No source names `anthropics/claude-code-action@v1` running in a WarpBuild job.** |
| **Migration** | Sign up (the GitHub App *"cannot be installed directly from the GitHub marketplace"*), install the App scoped to chosen repos, then one line: `runs-on: warp-ubuntu-latest-x64-2x`. Rollback undocumented; mechanically the inverse edit. |
| **Billing granularity** | **Stated only as *"CI runners are billed on a per-minute basis"*, with no minimum duration documented.** Their 2026-08-14 blog says the Claude Managed Agents surface is *"billed by the second"* — a different product. Unresolved; needs sales. |
| **Cache billed separately** | Yes on managed: storage **$0.20/GB-month**, operations **$0.0001 each**. Snapshot runners add $0.04/job restore + $0.025/hr storage. Cache is **not supported on Windows**, and expires after 7 days of disuse. |
| **Jan 2026 change** | None from WarpBuild — all four January changelog entries are feature work. Their [2025-12-15 post](https://www.warpbuild.com/blog/github-actions-price-change) covers GitHub's change and is now **stale on the key point**: it treats the $0.002/min self-hosted fee as effective 2026-03-01, which GitHub has since postponed. |

---

## 5. The two workloads, priced separately

This is the comparison the ticket exists to force. Both columns use the same
**2,447 GitHub-billed min/mo** total (2,216 CI + 230 agent), at each vendor's 2-vCPU-class Linux
x86 rate.

| Option | Gross | Free minutes applied | Platform fee | **Net $/mo** |
|---|---|---|---|---|
| **GitHub Free — status quo** | $14.68 | 2,000 | — | **$2.68** |
| GitHub Team | $14.68 | 3,000 | $4.00 seat | **$4.00** |
| WarpBuild x86 2× ($0.004) | $9.79 | 0 | — | **$9.79** |
| WarpBuild arm64 2× ($0.003) | $7.34 | 0 | — | **$7.34** |
| Namespace Developer 2×8 ($0.006) | $14.68 | 0 | — | **$14.68** |
| Namespace Team 2×8 ($0.004) | $9.79 | 0 | $100.00 | **$109.79** |
| ~~Blacksmith 2 vCPU ($0.004)~~ | $9.79 | 3,000 | — | **$0.00** — *ineligible, org only* |
| ~~Depot 2 vCPU ($0.004)~~ | $9.79 | 2,000 | $20.00 | **$21.79** — *ineligible, org only* |

**The structural fact that decides this.** A third-party fleet registers as a *self-hosted* runner,
and GitHub's docs say self-hosted usage is free — so the 2,000 included minutes are neither
consumed nor credited. **They simply go unused.** Switching therefore does not trade $14.68 of
GitHub spend for $9.79 of fleet spend; it trades **$2.68 for $9.79**. The free allowance is worth
$12/mo at list, and no fleet except Blacksmith's org-only tier offers anything to replace it.

### Workload A — CI, where the "faster machine" pitch is true

It is true, and it still does not win here. Three findings:

1. **Scaling up is cost-neutral by construction.** Blacksmith, Depot and WarpBuild all price Linux
   at exactly **$0.002 per vCPU per minute**; Namespace's unit model is the same idea. Doubling
   vCPUs doubles the rate. 2,216 min at 2 vCPU × $0.004 = $8.86; a perfect 2× speedup on 4 vCPU is
   1,108 min × $0.008 = **$8.86**. Identical. Buying a bigger machine only wins if the speedup is
   superlinear, which Amdahl forbids. **Bigger runners buy wall-clock, never money.**
2. **The lever that does work is a faster core at the same tier.** Blacksmith claims *"twice as
   fast as GitHub's decade-old server hardware for most CI jobs"* at $0.004 vs GitHub's $0.006 —
   same size, fewer minutes *and* a lower rate. Best case that is ~67% off gross. Against the
   status quo it is 1,108 + 230 = 1,338 min × $0.004 = **$5.35/mo, still $2.67 worse than GitHub
   Free's $2.68**, because the fleet bills from minute one.
3. **The lever nobody advertises is billing granularity.** 5.4 jobs per run at a median 84 s means
   per-job round-up inflates 10.87 raw minutes to 13.50 billed — **+24%, with no relationship to
   machine speed**. Depot's per-second billing with no minimum erases that outright. Namespace's
   1-minute floor reproduces it. Blacksmith and WarpBuild do not document it. On a 5-job workflow
   of short jobs, granularity is worth more than a 20% faster CPU — and it is the one axis this
   market does not compete on publicly.

### Workload B — agent runs, where the pitch is simply false

`claude-code-action@v1` runs are bound by model latency and API round-trips: 68 s mean, 143 s p90,
317 s worst observed, **one job per run**. No machine makes the model think faster, and with one
job there is barely any rounding tax to recover. The minute count is a constant; only the rate
moves.

| | Minutes/mo | Gross/mo |
|---|---|---|
| GitHub $0.006 | 230 | $1.38 |
| WarpBuild x86 $0.004 | 230 | $0.92 |
| WarpBuild arm64 $0.003 | 230 | $0.69 |

**The best achievable saving on the entire agent workload is $0.69/month.** Eighty-three cents a
year at the ARM rate. There is no vendor decision here, at any volume this estate will plausibly
reach. What *does* move this number is already in place: the `if:` guard on `triage.yml` suppresses
27% of triggers (37 of 139) at zero cost. One more guard is worth more than any runner on the
market.

## 6. What would change the answer

- **Repos move under a GitHub organization.** This is the only change that reopens the question.
  Blacksmith's 3,000 free org-minutes would cover the whole measured estate at $0/mo while leaving
  GitHub's 2,000 free minutes as unused headroom — strictly better than today. That decision is
  about creating an org, not about picking a runner vendor, and it carries its own costs (Team
  billing, org-level settings, transferring every repo).
- **CI volume roughly triples**, to where GitHub overage exceeds ~$10/mo. At current growth that is
  not near.
- **GitHub reinstates the $0.002/min self-hosted platform charge.** It would erase the fleets'
  entire margin: WarpBuild's $0.004 becomes $0.006, exactly GitHub's rate, while GitHub's 2,000
  free minutes stay free.

## 7. Findings note, not an ADR

`docs/adr/README.md` sets the bar at **all three, or skip it**. This clears none of them.

1. **Hard to reverse?** No. Every vendor documents the change as a single `runs-on:` line, per job,
   with the GitHub App as the only residue. Depot, Blacksmith, Namespace and WarpBuild each publish
   the one-line diff; RunsOn adds *"that's the only required change."* A migration can be tried on
   one job and reverted with one `git revert`. The cost of being wrong is a workflow file edit.
2. **Surprising without context?** No. "We stayed on GitHub-hosted runners" is what a reader would
   assume by default. Nothing here needs defending against a future reader's bafflement.
3. **A genuine trade-off?** No. Three candidates are ineligible on account type, one is not a
   managed fleet at all, and the survivor costs 3.7× the status quo. There were no real
   alternatives in contention, which is exactly the case the README describes as *"we did the
   obvious thing."*

So: **a findings note — this file.** It is also the outcome the map anticipated when it defined its
third record as *"which runner executes GitHub Actions: GitHub-hosted, a managed third-party fleet,
**or a recorded finding that no change is warranted**."*

The one thing worth writing down is the **conditional**, and it belongs here rather than in an ADR
because it is a fact about eligibility, not a ruling: *the fleet question is closed only while the
repos sit under a personal account.* If an org is ever created for another reason, Blacksmith
should be re-priced before anything else is decided — and at that point the decision would still be
cheap to reverse, so it would still be a note.

---

## Sources

All read 2026-08-21.

**GitHub** — [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) ·
[Actions billing concepts](https://docs.github.com/en/billing/concepts/product-billing/github-actions) ·
[Billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage) ·
[GitHub's products](https://docs.github.com/en/get-started/learning-about-github/githubs-products) ·
[pricing](https://github.com/pricing) ·
[2025-12-16 changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/) ·
[2026-01-01 changelog](https://github.blog/changelog/2026-01-01-reduced-pricing-for-github-hosted-runners-usage/) ·
[roadmap#1196](https://github.com/github/roadmap/issues/1196)

**Estate measurements** — `GET /users/collod873/settings/billing/usage`,
`GET /repos/collod873/Lumaria/actions/workflows/{ci,triage}.yml/runs`,
`GET /repos/collod873/Lumaria/actions/runs/{id}/jobs`, `GET /users/collod873`, `GET /user/orgs`

**Blacksmith** — [pricing](https://www.blacksmith.sh/pricing) ·
[runners overview](https://docs.blacksmith.sh/blacksmith-runners/overview.md) ·
[quickstart](https://docs.blacksmith.sh/introduction/quickstart.md) ·
[support terms](https://docs.blacksmith.sh/about/support-terms.md) ·
[dependency caching](https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions.md) ·
[container caching](https://docs.blacksmith.sh/blacksmith-caching/docker-container-caching.md) ·
[security](https://www.blacksmith.sh/security) ·
[2025-12-16 pricing post](https://www.blacksmith.sh/blog/actions-pricing)

**Depot** — [pricing](https://depot.dev/pricing) ·
[runner types](https://depot.dev/docs/github-actions/runner-types) ·
[overview](https://depot.dev/docs/github-actions/overview) ·
[quickstart](https://depot.dev/docs/github-actions/quickstart) ·
[cache integration](https://depot.dev/docs/cache/integrations/github-actions) ·
[egress filtering](https://depot.dev/docs/github-actions/how-to-guides/egress-filtering) ·
[troubleshooting](https://depot.dev/docs/github-actions/troubleshooting) ·
[Claude Code in GitHub Actions](https://depot.dev/blog/claude-code-in-github-actions)

**Namespace** — [pricing.md](https://namespace.so/pricing.md) ·
[migration](https://namespace.so/docs/solutions/github-actions/migration.md) ·
[runner configuration](https://namespace.so/docs/reference/github-actions/runner-configuration.md) ·
[custom base images](https://namespace.so/docs/solutions/github-actions/custom-base-images.md) ·
[caching](https://namespace.so/docs/solutions/github-actions/caching.md) ·
[cache volumes](https://namespace.so/docs/architecture/storage/cache-volumes.md) ·
[billing and limits](https://namespace.so/docs/workspaces/billing-and-limits.md) ·
[egress policy](https://namespace.so/docs/security/egress-policy.md) ·
[changelog](https://namespace.so/changelog)

**WarpBuild** — [pricing](https://www.warpbuild.com/pricing) ·
[cloud runners](https://www.warpbuild.com/docs/ci/cloud-runners) ·
[quick start](https://www.warpbuild.com/docs/ci/quick-start) ·
[preinstalled software](https://www.warpbuild.com/docs/ci/preinstalled-software) ·
[caching](https://www.warpbuild.com/docs/ci/features/caching) ·
[security](https://www.warpbuild.com/docs/ci/security) ·
[public repos](https://www.warpbuild.com/docs/ci/public-repos) ·
[feature matrix](https://www.warpbuild.com/docs/ci/feature-matrix) ·
[vs GitHub Actions](https://www.warpbuild.com/compare/github-actions) ·
[2026-08 changelog](https://www.warpbuild.com/docs/ci/changelog/2026-august) ·
[GitHub Actions price change](https://www.warpbuild.com/blog/github-actions-price-change)

**RunsOn** — [pricing](https://runs-on.com/pricing/) ·
[license](https://runs-on.com/legal/license/) ·
[free tier](https://runs-on.com/billing/free/) ·
[alternatives](https://runs-on.com/alternatives-to/github-actions-runners/) ·
[platforms](https://runs-on.com/docs/runners/platforms/) ·
[AI agents](https://runs-on.com/docs/runners/capabilities/ai-agents/) ·
[Flex configuration](https://runs-on.com/docs/maintenance/configuration/flex/) ·
[upgrades](https://runs-on.com/docs/maintenance/upgrades/) ·
[tier pricing 2026-06-05](https://runs-on.com/blog/tier-based-pricing-for-flex-and-fleet/) ·
[self-hosted fee post](https://runs-on.com/blog/github-self-hosted-runner-fee-2026/) ·
[v2 deprecation](https://runs-on.com/blog/runson-v2-deprecation/)

## Gaps

Recorded rather than filled in.

- **Blacksmith's billing granularity** is not published anywhere. Requires asking them.
- **WarpBuild's minimum billed duration** is not published; their docs say "per-minute" and a blog
  post says "per second" about a different product.
- **Whether WarpBuild works on a personal GitHub account** is stated neither way. It is the only
  open eligibility question, and it decides whether this report has one surviving candidate or zero.
- **Namespace's toolchain parity with `actions/runner-images`** is never claimed. They ship a diff
  tool instead, which reads as a leaner image.
- **Whether Namespace's Developer plan bills at the overage column** is arithmetic, not a stated
  claim.
- Enterprise pricing, Blacksmith's startup/OSS discount size, and Depot's Business tier are all
  sales-gated.
