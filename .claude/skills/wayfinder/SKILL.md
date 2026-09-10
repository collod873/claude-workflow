---
name: wayfinder
description: Plan a huge chunk of work (more than one agent session can hold) as a shared map of decisions on your issue tracker, and resolve them one at a time until the way to the destination is clear.
disable-model-invocation: true
---

A loose idea has arrived, too big for one agent session, and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the repo's issue tracker, then works its **decisions** (each one a question whose resolution is a decision, not a slice of a build to execute) one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting: it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data-structure migration. The map is domain-agnostic: engineering work, course content, whatever fits the shape.

## Plan, don't do

Wayfinder is **planning**: each ticket resolves a decision, and the map is done when the way is clear, with nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. Produce decisions, not deliverables; there is no execute mode.

## Refer by name

Every map and ticket is an issue, so it has a **name**: its title. In everything the human reads (narration, the map's Decisions-so-far), refer to it by that name, never by a bare id, number, or slug. A wall of `#42, #43, #44` is illegible; names read at a glance. The id and URL don't vanish; a name wraps its link, but they ride _inside_ the name, never stand in for it.

## The Map

The map is a single issue on this repo's issue tracker, labelled `wayfinder:map`, the canonical artifact. Its tickets are child issues of the map.

The map is an **index**, not a store. It lists the decisions made and points at the tickets that hold their detail; a decision lives in exactly one place, its ticket, so the map never restates it, only gists it and links.

**Where the map, its child tickets, blocking, and frontier queries physically live is tracker-specific.** The issue tracker should have been provided to you already, via this repo's `CLAUDE.md` under "## Agent skills". If not, read `docs/agents/issue-tracker.md` directly: this repo's own copy if this is `claude-workflow`, otherwise the pointer's target at the machine clone, `~/.agents/workflow/docs/agents/issue-tracker.md`. Consult the tracker doc's "Wayfinding operations" section for how _this_ repo expresses them. If no tracker has been provided, default to the local-markdown tracker.

### The map body

The whole map at low resolution, loaded once per session. Open tickets are **not** listed: they are open child issues, found by query.

```markdown
## Destination

<what reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket. Phrased against a fixed set, never against a section of this map that grows.>

Budget: <N> tickets.

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](link): <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates. One line per entry, each carrying a disposition: dissolved / filed / not filed -->
```

### Tickets

Each ticket is a **child issue** of the map; the tracker's issue id is its identity. Its body is the
question, sized to one 100K token agent session, in the shape `docs/agents/ticket-format.md`
documents under "Wayfinder decision": a `## Question` heading and the pipeline's usual
`## Acceptance criteria`, no `## Files claimed`.

Each ticket carries a `wayfinder:<type>` label, one of `research`, `prototype`, `grilling`, `task` (see [Ticket Types](#ticket-types)).

A session **claims** a ticket by assigning it to the dev driving the map, **first**, before any work, so concurrent sessions skip it. That assignee _is_ the claim: an open, unassigned ticket is unclaimed.

Blocking uses the tracker's **native** dependency relationship: essential because it renders the frontier _visually_ in the tracker's own UI, so the human sees what's takeable without opening the map. Only a tracker that lacks native blocking falls back to a body convention. A ticket is **unblocked** when every ticket blocking it is closed; the **frontier** is the open, unblocked, unclaimed children, the edge of the known.

The answer isn't part of the body; it's recorded on resolution (see [Work through the map](#work-through-the-map)). Assets created while resolving a ticket are linked from the issue, not pasted in.

**Those two headings are a minimum, not a maximum.** A ticket may also carry the evidence that makes its question answerable (a reproduction, a table, the links it was surfaced from) so the session resolving it doesn't re-derive what's already known. A long body is not drift; a body carrying the *answer* is, and so is one pasting in an asset that should be linked.

## Ticket Types

Every ticket is either **HITL** (human in the loop, worked _with_ a human who speaks for themselves) or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it (a grilling agent that answers its own questions has broken this).

- **Research** (AFK): Reading documentation, third-party APIs, or local resources like knowledge bases to surface a fact a decision waits on. Resolved by a subagent that calls the Skill tool with "research". Use when knowledge outside the current working directory is required.
- **Prototype** (HITL): Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to (an outline, a rough take, a stub, or UI/logic code) by calling the Skill tool with "prototype". Links the prototype as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **Grilling** (HITL): Conversation. The default case. Always call the Skill tool twice, for "grilling" and "domain-modeling".
- **Task** (HITL or AFK): Manual work that must happen before a *decision* can be made: nothing to decide, prototype, or research, but the discussion is blocked until it's done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that *does* rather than decides, and it earns its place by unblocking a decision, not by delivering the destination. The agent drives it alone where it can (AFK); otherwise it hands the human a precise checklist (HITL). Resolved when the work is done; the answer records what was done and any resulting facts (credentials location, new URLs, row counts) later tickets depend on. A task qualifies only if you can name the specific ticket it unblocks; if you cannot, it is not a task, it is out of scope.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war**: the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets, one at a time, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. It's the undiscovered frontier _toward_ the destination: everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now, _not_ whether you can answer it now.

- **Ticket when** the question is already sharp, even if it's blocked and you can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope (the next section).

**A patch graduates or it leaves, on the third touch.** A fog patch may be narrowed and annotated **twice**. The third time a session would touch it, the patch must instead become a ticket or move to **Out of scope**; there is no third annotation. Narrowing is not closure: a patch that keeps getting sharper without ever graduating is a decision being deferred, and every annotation makes it read more like progress. The counter is the patch's own annotation lines, so it survives a session boundary and is checkable by reading the map. If the third touch can neither phrase the question sharply enough to ticket nor rule it past the destination, that inability is itself the finding: ticket *it*, so the patch becomes a ticket asking why it won't sharpen.

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope**: it isn't fog, and it doesn't belong in **Not yet specified**. It gets its own **Out of scope** section on the map: work you've consciously ruled out of _this_ effort. Scope, not sharpness, lands it here.

Out-of-scope work never graduates (the frontier stops at the destination), so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When a ticket that already exists turns out to sit past the destination (mis-scoped in while charting, or exposed by a resolution) **close it** (a closed ticket is unambiguously off the frontier) and leave one line in the **Out of scope** section: the gist, why it's out of scope, and its **disposition**. It stays out of **Decisions so far**, which records the route actually walked; a scope boundary isn't a step on it.

### Out of scope is a statement about this map, not a verdict on the work

Two different things land in this section, and they behave nothing alike:

- **Dissolved**: looked at, and there is nothing there. One line on the map is the complete and correct answer.
- **Real, wrong map**: a reproduced defect, a known port, a backfill. It exists whether or not this map wants it, and a line in this section is not somewhere it can be picked up from.

One section with one procedure for both is how the second kind ends its life as prose in an issue body, in a repo that doesn't own the work, invisible from where the work actually lives.

So **every entry carries an explicit disposition**, written on the line. The section is not split by disposition, because a section boundary makes the choice by placement, and placement is inherited from wherever the author was already typing, which is exactly how *nobody decided* becomes indistinguishable from *somebody decided no*.

| Disposition | Means | The line links |
|---|---|---|
| `dissolved` | Investigated; there is no work here | the closed ticket, where one exists |
| `filed` | Real work, wrong map, filed now on the repo that owns it | the closed ticket **and** the filed issue |
| `not filed` | Real work, deliberately left unfiled; the reason rides on the line | the closed ticket, where one exists |

An entry with no disposition is an unfinished ruling. **`not filed` is a choice someone makes, never one they get by omission**: it is the honest disposition for work nobody intends to pick up, and writing it down is what makes that visible instead of accidental.

Not every entry has a closed ticket to link: a fog patch ruled past the destination on its [third touch](#fog-of-war) was never ticketed. Link what exists.

### File it at the moment of the ruling

The evidence is in this session's context now and nowhere else afterwards; a filing deferred to *later* is the one that never happens.

What travels to the filed issue is the **evidence**: the reproduction, the finding's grading, the link to whatever the investigation produced, not the gist. The map's line is then free to stay a gist precisely *because* it is no longer the only copy. Where the evidence never leaves the map, a one-line compression **is** the whole record, and it drifts with nobody positioned to notice.

**The repo that owns the work owns the issue.** Where that isn't the repo this map runs in, create it there (see the tracker doc's cross-repo verb) and link it from the line. Filing elsewhere is **not** graduation: the work still doesn't return to this frontier, which is the whole reason it needs somewhere else to be.

## The budget

The map's stated end, the way is clear and no tickets remain, is unreachable by construction. Every resolution graduates fog into fresh tickets, so the queue refills as fast as it drains, and a map can run indefinitely with every session following this skill exactly. The **budget** is the floor that makes the end reachable.

**The unit is tickets**: every child issue the map has ever had, open and closed. Counted, never estimated: the tracker already holds the number, so a fresh session that has loaded nothing but the map can still check it. Wall-clock and token budgets fail exactly that test: they are invisible at the next session boundary, and nothing carries them across it.

**Set at charting**, on the map's `## Destination`, as a `Budget: <N> tickets.` line. It bounds the effort rather than predicting it: pick a number the human is willing to spend, not the number you expect to need.

**Checked at graduation**, step 5 of [Work through the map](#work-through-the-map), the one place the count grows. Check *before* creating: if the tickets this resolution would add carry the map past its budget, create none of them.

**At the cap, stop and ask.** Report that the cap is reached, name the tickets that would have been created, and hand the human the choice: raise the budget, redraw the destination, or end the map on what exists. Never take any of those on your own initiative:

- **Never hand off what exists.** A handoff reader takes one index and reads it as complete; a map stopped at its cap is complete-as-far-as-it-goes, and nothing in that contract can say so. Handing it on presents a truncated map as a finished one.
- **Never open a second map for the remainder.** That re-charts a destination the first map never reached, converting *we ran out of budget* into *we finished*, the precise false ending the budget exists to prevent.

Same shape as a missing destination label in [End the map](#end-the-map): stop and ask, never default. Hitting the cap is information, not failure: it says the destination was drawn wider than the effort budgeted for it, and redrawing scope is the human's call, never the session's.

## Every agent that commits gets its own tree

A map fans out (research subagents in parallel at charting, another whenever a `research` ticket is resolved) and the user may be running unblocked tickets in their own sessions beside you. Give each of them its own *branch* and nothing else and they still share one working tree, where a single `HEAD` decides what every `git commit` lands on, whoever ran it.

That is not a theoretical hazard. Charting map #1 of `collod873/claude-workflow`, three research subagents ran concurrently: A checked out `research/claude-cloud-sessions`; B committed expecting to be on `research/era-infrastructure-choices`; `HEAD` had moved underneath it, so **B's commit landed on A's branch** (#137). B noticed and cherry-picked it back. Had it not, the commit would sit on A's branch, A would push it as part of its own findings, and B's checker would report `No diff.` on a range that never received the work, with no error raised anywhere, and Decisions-so-far carrying an answer nobody wrote. The loud version of this bug costs a cherry-pick; the quiet version is the one it exists to stop.

So: **an agent that will write needs its own working tree, and a path it was handed is read-only unless the prompt that handed it says otherwise.** *You* cut the tree, before the dispatch, from the tip you mean, never the dispatched agent, because the version where each subagent has to think of it is exactly the version that failed:

```
git worktree add "<scratchpad>/wt-<ticket>" -b "research/<name>" "$(git rev-parse HEAD)"
~/bin/link-deps "<scratchpad>/wt-<ticket>" "<repo>"
```

Name the base tip explicitly as above: the harness's own worktree isolation forks from the repo's default branch, which is rarely the tip a map is working from. Then hand the tree's path in the dispatch and say in the same breath that the main checkout is **read-only** to that agent: a source to read context from, never a target for a write, an install, a commit, or a `git` command that moves `HEAD`. What `link-deps` provisions and why, which gitignored files do not follow into a worktree, and what a read-only path is still good for are documented where `~/bin/link-deps --help` prints them.

**The tree outlives the subagent.** Its ticket's `close-ticket` run needs a checkout at that branch's head to verify against, so remove the tree at step 4's close, not when the findings land.

**This binds you too, without moving you out.** The shared checkout is still where your own resolution artifact belongs, since merging a worktree back for one ADR costs more than it saves, but you no longer hold it alone. Before the commit at step 4, confirm `git rev-parse --abbrev-ref HEAD` is the branch you meant and `git status --porcelain` names only files you wrote. A moved `HEAD` or a stray file means a subagent of this map, or one of the user's parallel sessions, is in the tree with you: report it and stop rather than committing over it. The charting session that hit #137 met it from this side: an untracked file it hadn't written, sitting in the tree it was about to commit from.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session**, with the exception of research tickets.

### Chart the map

User invokes with a loose idea.

1. **Name the destination.** Call the Skill tool twice, for "grilling" and "domain-modeling", to pin down what this map is finding its way to: the spec, decision, or change. The destination fixes the scope, so it's settled first. **Phrase it so it can be evaluated against a fixed set**: a destination that names a section of the map (*every decision below*, *all the open questions*) is measured against a list the map itself grows, so it can never fail to be pending. Name the fixed thing charting settles instead: the artifact to hand off, the specific decisions in question, the change to have been made. If you cannot phrase it that way, the destination is not yet named, and step 2 is premature.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog**, meaning the way to the destination is already clear and the whole journey small enough for one session, you don't need a map. Stop and ask the user how they'd like to proceed.
3. **Create the map**: file it with `~/bin/file-issue note --title "<name>" --body-file <path>`; the `note` kind carries no shape check and no label, since `wayfinder:*` isn't in `file-issue`'s vocabulary. Then apply its labels yourself: `gh issue edit <n> --add-label wayfinder:map` and a **destination label**, `wayfinder:dest-decision` or `wayfinder:dest-spec` (see [End the map](#end-the-map)), deciding now whether this effort hands off to `/to-spec` or closes on the decision alone. Destination and Notes filled in, Decisions-so-far empty, the fog sketched into **Not yet specified**. The Destination carries its `Budget: <N> tickets.` line, settled with the human here, at the only point the whole effort is in view (see [The budget](#the-budget)).
4. **Create the tickets you can specify now** as child issues of the map, on the same route as the map itself, `~/bin/file-issue note --title "<name>" --body-file <path>` followed by `gh issue edit <n> --add-label wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`), each carrying `## Acceptance criteria`. Then wire blocking edges in a **second pass** (issues need ids before they can reference each other). Wiring sorts them into the frontier and the blocked; everything you can't yet specify stays in the fog, the **Not yet specified** section.
5. **Fire the research subagents.** For each `research` ticket you just created, **cut it a worktree first** on a throwaway `research/<name>` branch. You cut it, before the dispatch, per [Every agent that commits gets its own tree](#every-agent-that-commits-gets-its-own-tree). Then spin up a subagent that calls the Skill tool with "research" to resolve it there in parallel, handing it that tree's path and naming the main checkout read-only to it. Its findings commit on that branch, with a context pointer from the ticket. These run concurrently, and a branch each is not enough to keep them apart: they would still share one `HEAD` (#137).
6. **Report.** Charting is one session's work; it hand-resolves nothing. Narrate to the human, never post to the map, what was created: the map, N tickets, the frontier by name. If step 5 fired any research subagents, print the AFK line first: "Research runs in the background; silence is normal. The report lands on the issue." Then stop.

### Work through the map

User invokes with a map (URL or number). A ticket is **optional**: without one, you pick the next decision, not the user.

1. Load the **map**: the low-res view, not every ticket body.
2. Choose the ticket. If the user named one, use it. Otherwise take the first frontier ticket in order. **Claim it**: assign it to yourself before any work.
3. Resolve it, **zooming as needed**: fetch the full body of any related or closed ticket on demand; call the Skill tool for whichever skills the `## Notes` block names. If in doubt, call the Skill tool twice, for "grilling" and "domain-modeling". Where resolving it dispatches an agent that will commit (a `research` ticket does) cut that agent its tree first, the same rule and the same cut as step 5 of [Chart the map](#chart-the-map).
4. **Record the resolution**, in order: commit anything the resolution produced (an ADR, a findings file) with `Part of #<ticket>` in the body, from the shared checkout, after the two checks in [Every agent that commits gets its own tree](#every-agent-that-commits-gets-its-own-tree); a ticket whose work was committed in its own worktree leaves you nothing to commit here. Post the answer as a **resolution comment**, a separate comment from the closing record with a different job; then run `~/bin/close-ticket <ticket> <base>..<head> <checkout>` bare, where `<checkout>` is that ticket's own worktree where the ticket had one, else the shared checkout. It fetches the ticket's own criteria from the issue body, runs each one's `check:` marker there, records `UNVERIFIED` for a criterion carrying no marker, posts the `## Closing record`, and closes the ticket itself: one command, no verdict for you to arbitrate. Exit 0: remove the ticket's worktree, then append a context pointer to the map's Decisions-so-far. Nonzero: nothing was posted and the ticket is still open; the failing criterion and its check command's output are on stderr; fix what it names and re-run the same command. Still nonzero a second time: label the ticket `needs-human` and leave it open; the map doesn't advance past it, and its worktree stays until it does.
5. **Check the budget, then grow the map.** Count the map's children, open and closed, against its `Budget:` line; if the tickets this resolution would add carry the count past it, create none of them and [stop and ask](#the-budget). Otherwise add the newly-surfaced tickets (create-then-wire, each carrying `## Acceptance criteria`); graduate any fog the answer has made specifiable, clearing each graduated patch from **Not yet specified** so it lives only as its new ticket. Any patch you touch and don't graduate gets its annotation, and on its **third** touch it graduates or goes out of scope instead (see [Fog of war](#fog-of-war)). If the answer reveals a ticket, this one or another, sits beyond the destination, **rule it out of scope** rather than resolving it on the route, giving it a disposition and filing it now if it is real work this map simply doesn't own (see [Out of scope](#out-of-scope)). If the decision invalidates other parts of the map, update or delete those tickets.
6. **Report.** See [The closing step](#the-closing-step).

The user may run unblocked tickets in parallel, so expect other sessions to be editing the tracker concurrently.

### The closing step

Narrated to the human, never posted to the map, since Decisions-so-far is already the durable record:

- **what this session did**: ticket resolved, tickets added, fog graduated, anything ruled out of scope and where it was filed
- **what remains**: open child tickets, the frontier by name, fog patches still outstanding, and tickets left in the budget
- **the verdict**: the way is clear, not yet, or the budget is spent and the choice is the human's

Never a percentage or an estimate. Fog still creates tickets, so both are lies.

**The way is clear** when the map has **no open child tickets** _and_ **Not yet specified is empty**. Not "frontier empty": the frontier excludes claimed and blocked tickets, so it can empty while work is still open elsewhere. If open children exist but none are takeable and none are claimed, that is a dependency cycle: report it as a bug, not an ending. Fog counts because a patch left unsharp is a decision left unmade, and every patch must leave as either a ticket or an **Out of scope** line.

A map can also end **without** the way being clear: at the cap, the human may choose to end it on what exists (see [The budget](#the-budget)). Only they can choose that (a session never reaches it alone) and the closing report says plainly that the way was not clear, so the ending is never mistaken for the one above.

### End the map

When the way is clear, read the map's **destination label**:

| Label | Terminal |
|---|---|
| `wayfinder:dest-decision` | post the closing report as a comment, close the map. Done. |
| `wayfinder:dest-spec` | post the closing report, close the map, then print one line: run `/to-spec` against this map. |

A closed map **is** the landmark for `decided`, so it closes either way; whether a spec follows is a different node with its own landmark. `decided` has exactly one exit, so the label is binary by construction; a third type would need a second edge out of `decided`, which is a pipeline change, not a wayfinder change.

No destination label (charted before they existed): **ask the human**. Never default: a wrong `dest-decision` silently drops a handoff.

A terminal is a **pointer**. Wayfinder names the next skill and stops. It cannot fire `/to-spec`, since user-invoked skills are unreachable from an agent session, and does not try.
