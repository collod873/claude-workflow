---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker (edges as text in one file per ticket locally, or native blocking links on a real tracker).
disable-model-invocation: true
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and pipeline label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Seam sweep

Before slicing, sweep the spec for the seams the batch will share. The disjoint-files rule ([ADR-0007](../docs/adr/0007-execution-order-is-a-file-claim.md)) prevents a collision of path; it does nothing about a collision of shape: N tickets that all need the same helper touch no file in common, so each hand-rolls its own copy instead. Catching that seam before slicing, rather than discovering it afterward as a rework batch, is what this step is for ([ADR-0030](../docs/adr/0030-a-seam-is-prefactored-where-predictable-ledgered-where-it-is-not.md)).

Split the spec into slices (its own sections, or a sensible chunking if it has none) and dispatch one **seam-sweep subagent** per slice, by stub, in the foreground (ADR-0026). Each subagent's brief: read its assigned slice, then search this codebase for a seam that already covers what the slice needs, before proposing anything new: reuse always outranks building. Combine every subagent's return into the **seam manifest**.

A manifest entry is one line: what the seam is, where it lives or should live, and what consumes it. The one-line bound is load-bearing, not stylistic: this text is injected into every ticket body it's relevant to and therefore into every worker's context window, so an entry costing more than the steer it saves has defeated its own purpose.

A seam the sweep finds nothing to reuse becomes a **prefactor ticket**, drafted in step 4 at the root of the ticket graph, and every ticket that consumes the seam carries a blocking edge on it, so none can start before it exists. A prefactor ticket never lands bare: it ships its seam together with its first real consumer, because a seam nothing calls yet is Speculative Generality, an abstraction predicted instead of proven. Pairing costs nothing on the critical path, since that consumer slice was already going into the batch regardless. A prefactor ticket's acceptance criteria carry no new record shape: the consumer slice's own behavioural criteria, plus criteria asserting the seam exists and that the slice consumes it. The closing record stays exactly what [ADR-0002](../docs/adr/0002-the-close-gate-is-a-verification-record.md) already requires, untouched by any of this.

### 3. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Prefactoring opportunities were already surfaced by the seam sweep in step 2; this step is broader orientation, not a second hunt for shared seams.

### 4. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- A prefactor ticket from the seam sweep (step 2) sits at the root of the graph, and every ticket consuming its seam carries a blocking edge on it
- Slices with no blocking edge between them will be implemented **in parallel**, so they must touch disjoint files. Where two slices share a file (or a migration), resolve it through the chain-shape ladder below rather than reaching straight for a blocking edge.
- Naming a seam a ticket consumes is never a files claim, so it never forces a blocking edge on that account: a seam is consumed by many tickets, not edited by them, and two tickets naming the same one collide on nothing
- Prefer more, smaller slices over fewer big ones. Batch wall-clock equals the fattest slice, not the slice count.

</vertical-slice-rules>

<chain-shape-ladder>

Apply to every pair of slices that touch the same file, **in this order**: try a rung only after the ones above it have failed to resolve the overlap. Reaching for the edge first is how a batch becomes a chain, and a chain's wall-clock is the sum of its slices instead of its fattest one.

1. **Session size is a hard ceiling.** Every slice fits in one fresh context window. A slice grown past that boundary to dodge an edge has bought sequencing with a slice no worker can finish; repartition or split it, never fatten it.
2. **Repartition to remove the overlap.** Redraw the boundaries so the two slices operate on disjoint file sets. This is the rung that gets skipped, and it is the one that keeps the batch wide.
3. **Extract a prefactor slice.** Where the shared file is a genuine shared foundation rather than an artifact of where you happened to draw the line, lift it into its own prerequisite slice; step 2's rules apply to it, so it ships with its first real consumer.
4. **Add the blocking edge.** Only for overlap the three rungs above could not remove.
5. **Aim for width in the true graph.** Having resolved each pair, look at the whole batch: every edge should reflect real file overlap and nothing else. An edge added for tidiness, for narrative order, or because "it feels like this comes first" costs parallelism and buys nothing.

</chain-shape-ladder>

**Wave 0 is a tracer.** The unblocked root, every slice you draw with no blocking edge, has to trace the thinnest possible end-to-end path through every layer the work touches, with stubs expected wherever a full implementation would cost the wave its thinness. Wave 0 is never a wiring slice that only connects layers with nothing behind them, and never a bare seam slice shipping an abstraction no consumer proves. Everything downstream is built on the root having shown the path exists.

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

Blocking edges point **inward only**: every edge names another ticket in this same batch, never an issue outside it. An outward edge points at work nobody in this batch is draining, and `/drain` would stall on a blocker its own run can never clear.

Acceptance criteria point **inward too**: every criterion is provable from this repo's checkout and the ticket's own `## Files claimed`. A criterion about another project's config, a machine's dotfiles, or a fork someone else maintains is one the worker can't satisfy, and `close-ticket` has no `check:` marker it could run against it, so it records `UNVERIFIED`, not `MET`, so the debt stays visible on the ticket forever instead of being proven; name that follow-up in the ticket's notes instead.

**Headless is not the same question as answerable.** A criterion's `check:` command has to read the tree `close-ticket` hands it, not the tracker. `gh api`, `gh issue`, `gh pr`, `gh run`, `curl` and `wget` all read GitHub or the network rather than the working directory, so they return the same verdict whether or not the diff exists; `gh api repos/…/contents/tests/acceptance` parses fine, runs headlessly, and still cannot be answered by any implementation. This is not a ban on reaching outside the repository: a criterion may grep an absolute path that lives elsewhere on the machine (`grep -q '…' /home/collin/.agents/skills/drain/SKILL.md`) when the artifact under test genuinely lives there, because that still reads local disk and can observe what the ticket's own work produced. If the fact you want to assert is that something **ran in production** rather than that a diff produced it, it does not belong in a ticket at all: that is a spec's one criterion, closed by observing the running system, and the asymmetry between the two is deliberate.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

### 5. Audit the breakdown

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **Files likely touched**: the files or areas this ticket will plausibly modify; no two tickets without a blocking edge between them may name the same file or migration
- **What it delivers**: the end-to-end behaviour this ticket makes work
- **Why not merged with its neighbour**: one sentence arguing why this slice doesn't fold into the ticket next to it in the list

This computed list is not scratch work: step 6 publishes it verbatim into each ticket's `## Files claimed` section, never discarded or reduced to an empty or missing section. A ticket that touches no files is published with `- None, no files.`

Dispatch a fresh-context **audit agent** on the list above (the Agent tool, by stub, in the foreground, ADR-0026) after the breakdown is computed and before publishing. It grades the breakdown against the same four sizing calls a maintainer used to be asked:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?
- Does any ticket look ~2x bigger than the rest? It sets the batch's wall-clock, so consider splitting it.

Every concern the audit raises is written as a **flag** in its report, decided this run on the agent's own recommendation, never a block on publishing, and never a question relayed back to a human ([ADR-0027](../docs/adr/0027-flagged-not-deferred.md)). Where the recommendation is to merge, split, or re-edge tickets, apply that edit to the list before publishing; report every flag, applied or not. No path through this skill waits for a human's approval of the breakdown.

### 6. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the tracker `/setup-matt-pocock-skills` configured; the tickets are the same either way, only the shape of the blocking edges changes:

- **Local files** → write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use the local-file template in `docs/agents/ticket-format.md`: one ticket per file, never a single combined file. It carries the same `## Acceptance criteria` heading as the issue template: one body shape on every tracker, only the edge encoding differs.
- **GitHub** → do NOT publish issue-by-issue. Write the whole approved breakdown as one graph JSON file (in the scratchpad), then run `~/bin/publish-issue-graph <graph.json>` in a single command. It creates all issues in parallel, wires sub-issue links to `parent` and `blockedBy` edges natively, verifies the graph on read-back (exits nonzero with the exact missing edges if not), and prints the verified table; paste that table in your report. `blockedBy` references sibling tickets by their `key`, so you never need to publish in dependency order or look up IDs. Run `~/bin/publish-issue-graph` with no args (or read its docstring) for the JSON shape. Each issue's `body` uses the spec sub-issue template in `docs/agents/ticket-format.md`; the helper injects the `Part of #<parent>` breadcrumb automatically (omit the template's `## Parent` and `## Blocked by` sections, since the helper's native edges carry them). Leave the helper's top-level `labels` field unset: no label at all is applied to any issue; `ready-for-agent` is dead (ADR-0004), and `## Acceptance criteria` plus `## Files claimed` in the body are the artifacts that matter, not a label. Publishing is done when the helper exits 0; do not re-verify by hand.
- **Any other real issue tracker (Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers, using the same spec sub-issue template. Use the platform's native blocking / sub-issue relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. Apply no pipeline label: `/to-tickets` output is judged but deliberately unlabelled; it carries `## Acceptance criteria` and `## Files claimed` instead. Native edges **are** the graph, so after wiring, **read it back** (every child under the parent, every edge present); done on the read-back, not the write.

A ticket that consumes a seam (one already in the codebase, or one a prefactor ticket lands) declares it in its published body next to `## Files claimed`, naming the manifest line it consumes. That declaration is never a files claim and is never intersected for disjointness.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue.

The maintainer's checkpoint is reviewing the published tickets on the tracker before invoking
`/drain`: a scope judgement they hold the authority on, unlike the sizing calls step 5's audit
agent now makes. An edit on the tracker, made there before `/drain` starts, is the reversal handle.

Report the seam manifest from step 2 when you finish: every seam this batch found reusable or built, so a later `/to-tickets` or `/drain` run over related work doesn't repeat the search.

The local-file and spec sub-issue templates, and the core `## Acceptance criteria` / `## Files
claimed` shape both carry, live in [`docs/agents/ticket-format.md`](../docs/agents/ticket-format.md),
not here.

In either form, avoid specific file paths or code snippets; they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts: not a working demo, just the important bits.

Work the frontier one ticket at a time with `/implement`, clearing context between tickets.
