# Lane 08 closes the ticket it merged, and a ticket that will not close never reddens the merge

Recorded 2026-08-28.

Lane 08 shells to this repository's own `bin/close-ticket` after the merge, for the ticket the pull
request body names. A nonzero exit from that command leaves the ticket open with a comment saying
why, and leaves the lane green: the merge is already on trunk, and no verdict about a criterion can
take it back.

## Why the lane closes at all

The chain could open a ticket, build it, and merge it. It could not finish one. Lane 08 merged
[#193](https://github.com/collod873/claude-workflow/pull/193) and stopped; #190 stayed open with no
`## Closing record`, indistinguishable on the tracker from work nobody had started. That is
[#183](https://github.com/collod873/claude-workflow/issues/183)'s thesis — *work closes on artifacts
existing, never on lanes running* — landing in the one place that makes the tracker lie about what
has shipped. The closing mechanism already existed and nothing called it.

## The ticket comes from the body, not from GitHub's linkage

`gh pr view --json closingIssuesReferences` is the obvious source and it is the wrong one **here**.
#193's body ended in `Closes #190` and #190's timeline carried `referenced` and `cross-referenced`
and no `connected` event at all — GitHub had already declined to make the link, which is why the
merge closed nothing. Asking GitHub which issues a pull request closes would ask it to repeat the
answer that was already wrong. Reading `Closes #<n>` out of the body asks the pull request what it
says, and the body is written by lane 05's own `openPrAndDispatch`, one sender, one form.

## Why a failed close is not a failed lane

`bin/close-ticket` refuses more often than a green run implies, and every refusal is legitimate: a
criterion's `check:` command exits nonzero, or the body's criteria come back every-one-unverified
([#215](https://github.com/collod873/claude-workflow/issues/215) — zero of any number is not
evidence). All of that happens **after** `gh pr merge` has landed the commit on trunk. A lane that
went red there would say the merge failed, and the next dispatch would try to merge it again. So the
close is fail-open by construction, and the record moves to where a person will see it: a comment on
the ticket, naming the merge and quoting what `close-ticket` reported. `CONTEXT.md`'s **Fail-open**
warning is about a *check* that skips; this is not a check — the check is `bin/gauntlet push`, which
already ran and already gates the merge.

That is why cause is not modelled. A criterion that failed, a ticket with nothing checkable, and a
script that could not run at all differ in cause and not one bit in consequence: ticket open, said
so on the ticket. Nothing downstream branches on the difference, so nothing downstream is offered
it.

## Considered options

- **A second workflow step running `bin/close-ticket` from the YAML.** Rejected: the step would have
  to re-derive from the outside — by parsing the PR again — the ticket and the commit range
  `integrate.ts` already holds, and `.github/` is immutable
  ([ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)), so every later
  correction to that derivation costs a hand-landed commit on `main` instead of an ordinary pull
  request. The workflow file changes once, for the `issues: write` scope the close genuinely needs.
- **Waiting for lane 07's review to post first.** Lane 07 fires off the same dispatch and may still
  be reviewing a pull request lane 08 has already merged. Rejected: its verdict is advice on a diff
  and cannot change what a criterion's `check:` command observes, and waiting would hold a model's
  latency inside the `integrate` concurrency group — the merge lock a single fixed group exists to
  keep short.
- **Closing before ringing the `graph-changed` doorbell.** Rejected for the same budget: the
  criteria are the ticket author's own commands and can take minutes, and a successor whose last
  blocker just landed should not queue behind them.
- **Closing after the merge, green whatever the close returns.** Chosen.

## Consequences

**The lane now runs author-written commands.** Every criterion's `check:` marker executes on the
runner, in the merged checkout, under `GITHUB_TOKEN`. That is the same trust boundary
`bin/close-ticket` already carried when a session ran it by hand, and the same one the gauntlet
carries, but it is now unattended — the criteria a slicer writes are the criteria a runner executes.

**A ticket can stay open after a green run, and that is a state to watch.** Nothing yet counts
merged-but-unclosed tickets; today they are visible only as the comment this lane leaves. If that
erosion becomes routine rather than exceptional, the comment is where the counting starts.
