# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on `collod873/claude-workflow` (ADR-0001,
"GitHub is the spec and issue tracker"). Use the `gh` CLI for all operations.

## Conventions

- **File an issue**: `~/bin/file-issue <kind> --title "..." --body-file <path>`; never call `gh issue create` directly. `<kind>` is one of `note` (no shape requirement, no label), `question` (requires a `## Question` heading, labelled `fuzzy`), `ticket` (requires `## Acceptance criteria` and `## Files claimed`, labelled `ticket`, created once if missing), or `spec` (requires `## Acceptance criteria` carrying exactly one `- [ ]` item with a well-formed trailing `check:` marker, whose command is run at filing time and refused if it is already green; title gets `PRD: ` prefixed, labelled `prd`, created once if missing). `file-issue ticketify <n>` is the one exit from `fuzzy`; see `docs/agents/ticket-format.md` for a ticket's shape and `docs/agents/spec-format.md` for a spec's.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Claim (lock)**: `gh issue edit <n> --add-assignee @me`, a session's first write when it means to work an issue now, so any other session reading the tracker can see the issue is already taken.
- **Close**: gated, in your own turn. Run `bin/close-ticket <number> <base>..<head> <checkout>`:
  it runs each criterion's own `check:` marker, posts the `## Closing record` it observed, and
  closes the ticket, in one command. Never write that record yourself and never close ahead of it:
  a bare `gh issue close` carrying no record is refused by `.claude/hooks/close-gate.py` before it
  runs, and the refusal reaches you in the same turn, at this workstation and inside every stage
  on a runner alike. A ticket with no diff (a `task` ticket, or a map with truly no commit) closes
  on a record reading `## Closing record` followed only by `No diff.`; hand it the empty range
  the ticket really carried (`<head>..<head>`), because `close-ticket` counts the range and
  refuses when it carries commits rather than recording that the ticket carried none (#300). A close marked `not planned`
  or `duplicate` claims no delivery and is not judged at all (ADR-0013). See
  `docs/agents/ticket-format.md` for the ticket shape the record is checked against.
- **Act on another repo**: every verb above takes `-R <owner>/<repo>`: `~/bin/file-issue <kind> -R <owner>/<repo> --title "..." --body-file <path>`. Needed whenever work belongs to a repo other than the one you are standing in; without `-R` the issue silently lands here instead.

- **Issue and PR numbers share one space** on GitHub, so a bare `#42` may be either; resolve with `gh pr view 42` and fall back to `gh issue view 42`.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Routing a defect: the project under work, or the machinery

Spot a defect outside your task? File the ticket yourself, right then. But a defect in **the agent
machinery** (skill markdown, or a hook itself) never goes to the tracker you are standing in. That
tracker belongs to **the code under work**, and the machinery's fix would not land there either.
Route by what broke, not by which repo the session happens to be in:

- A defect in the code under work goes to that project's tracker, by the conventions above.
- A defect in the machinery goes to `collod873/claude-workflow`, named explicitly:
  `~/bin/file-issue ticket -R collod873/claude-workflow --title "..." --body-file <path>`. Omitting
  `-R` here is the same failure the bullet above warns about, one layer down: the issue silently
  lands in whichever tracker the session is standing in, never the machinery's.

Working inside `collod873/claude-workflow` itself collapses the distinction: its lanes, hooks,
pipeline skills and `bin/` verbs are both the machinery and the code under work, so a defect in
either files here with no `-R` needed. Its working checkout is
`/home/collin/Claude Projects/Workflow`; on the workstation the same tree runs from a dedicated
clone at `~/.agents/workflow`, pulled fast-forward and never edited in place.

## Numbers vs IDs

Two different identifiers, and using the wrong one is a silent no-op rather than an error.

- The **number** (`#34`) is what humans, issue bodies, `gh issue view` and every `gh issue`
  subcommand take.
- The **internal ID** is a numeric database id (a different, much larger number) and it is what
  the sub-issue and dependency APIs take. Get it with
  `gh api repos/{owner}/{repo}/issues/<number> --jq '.id'`. Never the `#number`, never the
  `node_id`.

## Relationships (authoritative)

Native sub-issue and blocked-by relationships are the source of truth for structure. Body text ("Parent", "Blocked by") is a mirror written once at creation, never updated: graph-walkers read the APIs, never the body. `gh issue view` does not show relationships.

- **Link child to parent**: `gh api -X POST repos/{owner}/{repo}/issues/<parent-number>/sub_issues -F sub_issue_id=<child-id>`
- **List children**: `gh api repos/{owner}/{repo}/issues/<parent-number>/sub_issues`
- **Add blocker**: `gh api -X POST repos/{owner}/{repo}/issues/<blocked-number>/dependencies/blocked_by -F issue_id=<blocker-id>`
- **List blockers**: `gh api repos/{owner}/{repo}/issues/<number>/dependencies/blocked_by`

Unblocked = every blocker closed. Any skill splitting a parent into children (e.g. `to-tickets`) creates these links alongside its body-text sections. Here that split runs unattended in Actions on the `prd` label, in `.github/workflows/to-tickets.yml`.

## Labels

Every label the pipeline reads or writes is in the catalogue at
`.Workflow/agent-workflows/shared/labels.ts`, rendered as a table in
`docs/agents/pipeline-labels.md`. Its colour says who holds the issue: green is a lane on it
now (`1-shaping` … `8-landing`, `ratifying`, numbered so the label filter sorts in pipeline
order), blue is waiting on the machine (`3-sliced`, `waiting`, `queued`, `sliceable`), red is
waiting on the owner (`needs-human`, `fuzzy`, `by-hand`, `1-decide`, `2-questions-open`,
`slice-failed`, `shape-refused`, `spec/gap`), purple is a verb only the owner applies, grey is a
kind and amber is `ticket`. An open issue wears at most one green or blue **lane label**; the
absence of a kind label and of `## Acceptance criteria` in the body still means not yet judged.

`to-build` is the verb worth knowing from here: put it on a ticket you wrote in a session
(`~/bin/file-issue ticket`, then `gh issue edit <n> --add-label to-build`) and lane 04's next
recompute starts it: no spec, no slicer, and every gate downstream unchanged. **It starts lane 04,
not lane 06.** A ticket whose criteria no acceptance test names yet is handed to the acceptance
author first, and lane 04 rings lane 05 once those tests are on `main` (#201); otherwise the
implementer's push gate and Verify's acceptance job both judge a slice against tests that do not
exist, which is how #346 reached a pull request the acceptance job failed closed on. A ticket that
already has one goes straight to lane 06, so a retry after a failed implementer re-authors nothing.
It is read by `.Workflow/agent-workflows/dispatch/reconcile.ts`, which refuses a labelled issue
missing `## Acceptance criteria` or `## Files claimed` in one comment rather than spending a run
on it. When the reconciler dispatches the ticket it swaps `to-build` for the lane label
(`4-accepting` or `5-building`) and admits the ticket on that label from then on, so nothing has
to be re-applied after a dead run. Blockers must be native `dependencies/blocked_by` edges: the
reconciler never reads a `## Blocked by` section, so prose alone will start the ticket immediately.

A PRD reads its build from the label filter: the reconciler writes `waiting` on every child behind
an open blocker and `queued` on every ready child without a worker, and keeps one rollup line at
the top of the PRD's body (`3 building · 2 queued · 13 waiting · 4 done`).

GitHub's stock `enhancement` / `question` / `wontfix` exist on the repo but are not pipeline
labels. Lane 00's second form applies stock `bug` at creation, which is intake, not a position: it
records that the owner called it a break, and no step reads it as a verdict.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. Filed with `~/bin/file-issue note --title "..." --body-file <path>`, then `gh issue edit <n> --add-label wayfinder:map`: `note` carries no shape check or label, since `wayfinder:map` isn't in `file-issue`'s vocabulary.
- **Child ticket**: filed with `~/bin/file-issue note --title "..." --body-file <path>`, then linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`), applied with `gh issue edit <n> --add-label wayfinder:<type>`. Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation; see "Numbers vs IDs" above for which identifier the endpoint takes. GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues), drop any with an open blocker or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
- **Rule out of scope**: `gh issue close <n>` where a ticket exists, then write the entry in the map's **Out of scope** section carrying its disposition. For a `filed` disposition, create the issue first on the repo that owns the work (`~/bin/file-issue <kind> -R <owner>/<repo> --title "..." --body-file <path>`, carrying the evidence rather than the gist) and link both it and the closed ticket from the entry.
