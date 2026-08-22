# GitHub is the spec and issue tracker

Recorded 2026-08-21.

A spec is a `PRD:` issue, a ticket is a child issue, and the decision record for how work is
specified, sliced and closed lives on GitHub — not in a dedicated tracker, and not in files. The
question was charted genuinely open; nothing offered cleared the bar below.

## The bar an alternative had to clear

PRs, CI and merge stay on GitHub regardless of where tickets live. So a second tracker does not
*replace* GitHub — it *adds* to it, and the addition has to be worth **both** halves of its cost: a
sync layer, and a new home base.

Neither half is hypothetical here. `General-Repo/agentic-os-design.md` (2026-07-06) had already
concluded that *"the operating system is the harness itself + GitHub + your surviving skills"* — it
ruled GitHub **in** and ruled out the bespoke middle layer built on top of it, having diagnosed all
three dead systems (eras 2, 4 and 5) with the same disease: a homegrown middle layer that needs its
own maintenance mode. A tracker sync layer is that disease by definition.

And the adoption law from the owner's own postmortems: *anything requiring a new home base dies by
roughly month three, regardless of quality.* That is [`GOAL.md`](../../GOAL.md)'s C4 — a proposal
carrying a grooming obligation is not a smaller version of the goal, it is a different goal.

So the bar is not "is there a nicer tracker." There are nicer trackers. The bar is "does it beat
GitHub by enough to pay for a sync layer and a new home base," and the two findings above say what
happens to anything that doesn't.

## Considered options

- **A dedicated tracker (Linear, Height, Notion).** Better phone surface, better keyboard, better
  views. Fails the bar on the sync layer alone: the PR, the branch, the CI run and the merge are
  GitHub objects, so every ticket state change has to be mirrored, and the mirror becomes a thing
  that needs grooming.
- **Files in the repo.** No sync layer, and it satisfies W4 (decisions next to the code) maximally.
  Fails on the *event* surface: a file has no `issues.opened`, no assignee, no native blocked-by
  edge, and nothing external can fire off it. The wayfinder frontier is a query, not a document.
- **GitHub.** Chosen.

## The mechanical cost of moving, stated concretely

The enforcement layer is not tracker-agnostic. It is GitHub-shaped, and specifically **issue-shaped**:

| Mechanism | What it depends on |
|---|---|
| `close-gate.py` | Parses a `## Closing record` **off an issue body**, and refuses the close when a criterion is not MET |
| `publish-issue-graph` | Builds **native** sub-issue and blocked-by edges — the same edges that render the wayfinder frontier in GitHub's own UI |
| `triage.yml` | Fires on **`issues.opened`**, in production today |

That is W1 — the gate that errors at the moment of the action, the one durable win every era either
kept or re-derived — resting directly on issue shape. Moving tracker does not port the gate; it
rewrites it, and until the rewrite lands the gate is *fail-open*, which in an unattended system is
not a degraded gate but no gate at all.

## Consequences

Across all seven eras, each one moved documentation **closer** to the code, never further from it —
loose plan files, then a central wiki, then in-repo ADRs with a sync contract carrying executable
markers. This ruling is that through-line applied to the ticket: the record sits where the code, the
PRs and the CI already are.

The cost accepted in exchange: the tracker's quality is GitHub's to set, and issue-shaped
enforcement is now a dependency rather than a convenience.

## Not settled here

**The phone front door.** *"GitHub is the record"* and *"what do I open on my phone when I'm away"*
are different questions, and the second is still open. Any answer to it — a third-party GitHub
client, a Claude cloud session, the GitHub app itself — reads and writes the same issues, so
choosing one does not reopen this ADR and this ADR does not constrain the choice.

## What would reopen this

- **A second operator.** The same expiry condition [agent-skills #28](https://github.com/collod873/agent-skills/issues/28)
  declared for the connector decision. A second person changes what a tracker is for, and reopening
  is then a fresh effort, not a resumption.
- **A mechanism GitHub cannot express.** A relationship or a gate the enforcement layer needs that an
  issue cannot carry. Today the dependency runs the other way — the gates are built out of issue
  shape — so this would have to be something new, not something better.

Neither is the phone surface, and neither is price.
