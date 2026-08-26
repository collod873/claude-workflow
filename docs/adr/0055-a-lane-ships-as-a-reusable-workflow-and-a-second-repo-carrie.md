# A lane ships as a reusable workflow and a second repo carries a stub that tracks main

Recorded 2026-08-26.

A second repo does not get a copy of the machine. It gets a phone number: each lane is published
here as a **reusable workflow**, and the target repo carries a caller stub — a trigger and a
`uses:`, six lines with no content in them. Callers name `@main`, never a pinned tag.

Ruled by the owner 2026-08-26, with [#82](https://github.com/collod873/claude-workflow/issues/82).

## Why copying is the trap this ticket was filed to avoid

All ten lane workflows are `npx tsx .Workflow/agent-workflows/…` over **140 tracked TypeScript
files**. "Install the pipeline" therefore means vendoring 140 files and a Node toolchain into a
target repo — and five of the nine repos surveyed in
[`docs/research/gauntlet-portability-2026-08.md`](../research/gauntlet-portability-2026-08.md) have
no Node at all. Every one of those copies then has to be kept level with this repo.

That is `UPSTREAM.md` rebuilt: ~60 divergence rows, grep-able markers, a test suite asserting the
markers still hit, and a standing obligation to re-apply deltas.
[ADR-0027](0027-six-of-era-6-s-eleven-verbs-do-not-survive-the-map-and-two-s.md) deleted
`/sync-skills` for exactly this and named the reason — C4. A design that ships portability by
copying re-files the deleted verb under a new name.

**A stub cannot drift because it has no content.** The list of what a repo runs is the set of stubs
it has; there is nothing inside them to fall out of date. That is the "installer, not manifest"
shape the ticket proposed, taken one step further than the ticket proposed it: not an installer that
copies well, but a call that copies nothing.

## Considered options

- **Vendor the lane code into each repo.** Rejected above. It is the manifest, and it additionally
  requires a Node toolchain in repos that are Python, or Markdown, or nothing.
- **Publish `.Workflow/agent-workflows/` as a package and `npx` it from a stub.** Rejected, but it
  is the strongest runner-up and the thing to reach for if the credential below ever becomes
  unavailable. It needs no cross-repo read at all. It was not chosen because a private package
  needs auth anyway, a public one publishes the machine's source and its docs — which quote the
  owner verbatim and name private repos — and it adds a publish step between writing a fix and the
  estate having it. This repo's existing `release-on-prd-close.yml` releases *observations*, not
  artifacts, so there is no publishing mechanism to inherit.
- **Make this repo public** so a caller can check it out with no token. Rejected on the same
  disclosure grounds.
- **Reusable workflow, caller stub.** Chosen.

## The credential, and why this is the right place to spend it

The reusable workflow *file* crosses repos with no token — GitHub allows a private repo's workflows
to be called by other repos the same user owns, and it is a setting rather than a secret. The lane's
**code** does not: reaching `.Workflow/agent-workflows/` means `actions/checkout` against this
private repo, which needs one read-only fine-grained PAT.

That is not a new cost. It is the **third** consumer of a credential already pending:
[ADR-0050](0050-the-sweep-reads-this-repo-only-the-cross-repo-title-sweep-wa.md) parked lane 01's
cross-repo title sweep on it, `DESIGN.md` §11's question 1 names the cross-repo counter as the
second, and ADR-0050 already argued the conclusion this ADR acts on — *"All three want the same
credential, which is an argument for deciding #98 once rather than three times."* #98 decided the
*acceptance lane's* identity and ruled that a second repo acquires nothing
([ADR-0053](0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md)); that ruling is
about **who a lane runs as**, and is undisturbed. This is a different question — what a caller may
*read* — and it is the first thing in the design that actually has to pay for it.

Marginal per-repo wiring is one secret beside the `CLAUDE_CODE_OAUTH_TOKEN` an install must set
anyway, so the cost is paid once at the design level and approximately zero per repo after that.

**ADR-0053's rule binds it:** no credential may be referenced by a job a pull request can trigger.
The read PAT is read-only and scoped to contents, which is the weakest token that does the job.

## Why `@main` rather than a pinned tag

A pin is a version somebody has to move. A tag nobody moves is twenty repos frozen on an old lane
while this one advances — silent, invisible from either end, and indistinguishable from working.
That is `UPSTREAM.md`'s failure mode with better branding, and `GOAL.md` C4 predicts it directly.

`@main` trades that for a loud one: a bad push here reddens every caller at once. The trade is taken
because the failure points the safe way. A reusable workflow that breaks fails **red**, not open,
and `CONTEXT.md`'s **Fail-open** entry is the property this estate cannot survive; a stale pin fails
silently, which is the failure the whole design exists to eliminate. The estate has exactly one
operator, who is both the person who broke it and the person who fixes it, so the blast radius has
no coordination cost.

## Consequences

**W2 becomes structural across the estate.**
[ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md) ruled that what
judges a pull request must come from trunk rather than from inside the PR, and put `.github/` in the
immutable set to hold it. A reusable workflow makes the same guarantee hold *between* repos for
free: a caller repo cannot edit the lane that judges it, because the lane is not in it. The
immutable set in a caller repo shrinks to its stubs.

**This repo becomes a single point of failure for the estate**, deliberately, and its own gates are
now load-bearing for every caller. `verify.yml` and the push venue were previously protecting one
repo's `main`; after this they protect everyone's. That is an argument for move 10's branch
protection landing sooner, not a reason to reverse this.

**A caller repo's lanes are whichever stubs it has**, which is what makes
[`DESIGN.md` §11 question 1](../../DESIGN.md)'s standing recommendation — *"the gauntlet and the
cross-repo counter only"* — free rather than a feature. Partial installation needs no mode, no flag
and no mechanism: it is a shorter list of stubs.

## What would reverse this

The read PAT becoming unavailable or unacceptable, which routes to the packaged-artifact runner-up
above rather than back to copying. Or GitHub withdrawing cross-repo reusable workflows for private
repos on a Free account, which would be the same forced move.
