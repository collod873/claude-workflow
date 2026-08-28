# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on `collod873/claude-workflow` — ADR-0001,
"GitHub is the spec and issue tracker". Use the `gh` CLI for all operations.

## Conventions

- **File an issue**: `~/bin/file-issue <kind> --title "..." --body-file <path>` — never call `gh issue create` directly. `<kind>` is one of `note` (no shape requirement, no label), `question` (requires a `## Question` heading, labelled `fuzzy`), `ticket` (requires `## Acceptance criteria` and `## Files claimed`, no label), or `spec` (no shape requirement; title gets `PRD: ` prefixed, labelled `prd`, created once if missing). `file-issue ticketify <n>` is the one exit from `fuzzy` — see `docs/agents/ticket-format.md`.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Claim (lock)**: `gh issue edit <n> --add-assignee @me` — a session's first write when it means to work an issue now, so any other session reading the tracker can see the issue is already taken.
- **Close**: gated. A close is refused unless a checker has already posted a `## Closing record`
  comment with every criterion `MET` — never post that record yourself, and never close ahead of
  it. A ticket with no diff (a `task` ticket, or a map with truly no commit) still needs one: the
  record then reads `## Closing record` followed only by `No diff.`. Once the record exists,
  `gh issue close <number> --comment "..."`. See `docs/agents/ticket-format.md` for the ticket
  shape the record is checked against. The gate itself runs in Actions here
  (`.github/workflows/close-gate.yml`), not as a workstation hook — ADR-0021.
- **Act on another repo**: every verb above takes `-R <owner>/<repo>` — `~/bin/file-issue <kind> -R <owner>/<repo> --title "..." --body-file <path>`. Needed whenever work belongs to a repo other than the one you are standing in; without `-R` the issue silently lands here instead.

- **Issue and PR numbers share one space** on GitHub, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Numbers vs IDs

Two different identifiers, and using the wrong one is a silent no-op rather than an error.

- The **number** (`#34`) is what humans, issue bodies, `gh issue view` and every `gh issue`
  subcommand take.
- The **internal ID** is a numeric database id — a different, much larger number — and it is what
  the sub-issue and dependency APIs take. Get it with
  `gh api repos/{owner}/{repo}/issues/<number> --jq '.id'`. Never the `#number`, never the
  `node_id`.

## Relationships (authoritative)

Native sub-issue and blocked-by relationships are the source of truth for structure. Body text ("Parent", "Blocked by") is a mirror written once at creation, never updated — graph-walkers read the APIs, never the body. `gh issue view` does not show relationships.

- **Link child to parent**: `gh api -X POST repos/{owner}/{repo}/issues/<parent-number>/sub_issues -F sub_issue_id=<child-id>`
- **List children**: `gh api repos/{owner}/{repo}/issues/<parent-number>/sub_issues`
- **Add blocker**: `gh api -X POST repos/{owner}/{repo}/issues/<blocked-number>/dependencies/blocked_by -F issue_id=<blocker-id>`
- **List blockers**: `gh api repos/{owner}/{repo}/issues/<number>/dependencies/blocked_by`

Unblocked = every blocker closed. Any skill splitting a parent into children (e.g. `to-tickets`) creates these links alongside its body-text sections. Here that split runs unattended in Actions on the `prd` label — `.github/workflows/to-tickets.yml`.

## Labels

The four pipeline labels — `fuzzy`, `needs-human`, `prd`, `wayfinder:*` — and their meanings live
in `docs/agents/pipeline-labels.md`. They assert only where work sits, never a readiness verdict, and
their **absence** is load-bearing: no pipeline label and no `## Acceptance criteria` in the body
means not yet judged.

This repo's own pipeline writes five more, which are state rather than position and which no
pipeline step reads as a position:

| Label            | Written by                          | Means                                                              |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `idea`           | `.github/ISSUE_TEMPLATE/idea.yml`   | An item filed through lane 00's micro door, in the owner's own words and never edited |
| `slice-failed`   | `.github/workflows/to-tickets.yml`  | A slicing run refused or failed; the PRD was not split              |
| `close-refused`  | `.github/workflows/close-gate.yml`  | An open refusal — the gate reopened a close and has not since accepted one (ADR-0023: state, not history) |
| `build-order`    | filed by hand                       | A move on the build order (ADR-0026)                                |
| `standards-pass` | `/standards-pass`                   | One standards-authorship pass, one issue per run                    |

GitHub's stock `bug` / `enhancement` / `question` / `wontfix` exist on the repo but are not
pipeline labels — see ADR-0004 in `collod873/agent-skills`, which deleted them from the vocabulary.
Lane 00's second form applies stock `bug` at creation, which is intake, not a position: it records
that the owner called it a break, and no step reads it as a verdict.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. Filed with `~/bin/file-issue note --title "..." --body-file <path>`, then `gh issue edit <n> --add-label wayfinder:map` — `note` carries no shape check or label, since `wayfinder:map` isn't in `file-issue`'s vocabulary.
- **Child ticket**: filed with `~/bin/file-issue note --title "..." --body-file <path>`, then linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`), applied with `gh issue edit <n> --add-label wayfinder:<type>`. Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation — see "Numbers vs IDs" above for which identifier the endpoint takes. GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues), drop any with an open blocker or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
- **Rule out of scope**: `gh issue close <n>` where a ticket exists, then write the entry in the map's **Out of scope** section carrying its disposition. For a `filed` disposition, create the issue first on the repo that owns the work — `~/bin/file-issue <kind> -R <owner>/<repo> --title "..." --body-file <path>`, carrying the evidence rather than the gist — and link both it and the closed ticket from the entry.
