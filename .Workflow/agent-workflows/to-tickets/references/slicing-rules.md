# The six runner rules

Carried forward from era 6's `/to-tickets` because they are still live on a runner — nothing about
moving the pipeline off a human keystroke changes any of them:

1. **A prefactor ticket ships with its first real consumer.** A seam nothing calls yet is
   Speculative Generality. A prefactor slice never lands alone; the slice that needed it enough to
   justify extracting it goes in the same batch.
2. **Blocking edges point inward only.** Every `dependsOn` names a slice in this same batch, never
   an issue outside it — a drain stalls forever on a blocker its own run can never clear.
3. **Acceptance criteria point inward too.** Provable from this checkout and the ticket's own file
   claims, never from another repository's config or a machine's dotfiles.
4. **Wide refactors are the exception to vertical slicing.** A mechanical change that fans across
   thousands of call sites is sequenced expand → migrate in batches → contract, rather than forced
   into a tracer-bullet shape it doesn't fit.
5. **A seam manifest entry is one line.** It is injected into the body of every ticket that
   consumes it, and therefore into every worker's context — a line that costs more than the steer
   it buys has defeated its own purpose.
6. **Each slice carries one sentence** arguing why it does not fold into its neighbour — the input
   the auditor grades merge/split candidates against.

## No chain-collapsing transform

v1 does not build `collapseChains` (the fork's ADR-0023 transform, which folds a maximal linear
run of slices into one fat sub-issue). Nothing downstream of this pipeline pays per-PR ceremony
yet — there is no implement fan-out — so collapsing chains here would only shorten the issue list
while fattening each item, against edges this stage has never actually drawn before. Draw the true
graph; do not pre-collapse it.
