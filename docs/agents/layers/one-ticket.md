# One ticket

The machine's first layer, judged against the [charter](../charter.md). Signed by the owner in
session on 2026-09-17 ([ruling ticket](https://github.com/collod873/claude-workflow/issues/665)),
amended 2026-09-23; only the owner changes it. What is still to build, and in what order, is
[#674](https://github.com/collod873/claude-workflow/issues/674).

## The path

1. **File.** The session runs `bin/file-issue ticket`. The body carries `## Why` (the owner's words
   quoted verbatim, the session's one-paragraph summary, and the session link),
   `## Acceptance criteria`, `## Files claimed`, and optionally `## Files to read`.
2. **Start.** Filing, or the owner reopening a ticket, fires the start step. No label, no dispatch.
   Reopening a ticket whose PR is open re-runs that PR's failed checks instead.
3. **Tests.** The test author writes one failing test per behavioural criterion on `ticket/<n>`.
4. **Build.** The builder builds against the brief, with one resumed repair round.
5. **Save.** The branch is pushed and the PR opened with auto-merge on, red or green.
6. **Judge.** The required check runs `bin/check` on the PR head.
7. **Review.** Once green, the reviewer reads `## Why` against the diff.
8. **Merge.** GitHub merges when the required checks pass on an up-to-date branch.
9. **Close.** The merge fires the closer. It runs the ticket's checks on the merge commit, posts the
   closing record and the speed report, and closes the ticket as completed, clearing its stage labels.

Every agent is a fresh context. What keeps them apart is the clean slate and the gate between them,
not a bigger model.

## Runs

Every stop names who clears it.

| Stop | What happens | Cleared by |
|---|---|---|
| Filing refused | Nothing is filed | The filing session, live with the owner |
| Start refused: shape (a raw filing that skipped `file-issue`) | No model spent | The fixer, which rewrites the ticket |
| Start refused: a claimed file is deleted, or a check names a `--config` that does not exist | No model spent | The fixer, which rewrites the ticket |
| Start: the ticket's checks already pass on main | Closed as already done, with a closing record | Nobody needed |
| Start: main is red | No model spent; the ticket waits | The next green merge to main fires it again |
| Start: the tree is not clean, fresh main | No model spent | The run that started it, from a fresh checkout |
| The ticket or its PR cannot be read | No model spent; nothing judged | The fixer |
| A brief is over its 200 KB cap | No model spent | The fixer, which narrows the ticket's claims |
| A stage finds uncommitted work in the tree | No model spent | The run that started the stage, from a clean checkout |
| A job cannot fetch the owner's hooks after 3 tries | No model spent; ticket marked failed, PR and branch kept | Nobody; Look-back counts it |
| The test author writes no test, or cannot write a failing test for a criterion | Stage ends red | The fixer, which fixes the ticket |
| A stage writes outside the repo, or its model run exits non-zero | Stage ends red, branch saved | The fixer |
| A stage's work will not commit | Stage ends red, work left in the tree | The fixer |
| Build red after the repair round | Branch saved, PR open | The fixer |
| Save: the push is refused | Work kept on the run's branch, no PR | The fixer |
| Save: the PR is not open with auto-merge on | Branch pushed, nothing merging | The fixer |
| Green on the ticket's checks, red on the PR's required check | PR stays open | The fixer |
| The reviewer finds drift from `## Why` | PR stays open, gaps posted | The fixer |
| The branch conflicts with main | Update refused, PR open | The fixer |
| The fixer ends red, or rules the ticket should not exist as written | Closed unbuilt, branch kept, reason on the ticket; left open and marked failed when its PR is open | Nobody; Look-back counts it |
| Red on main after merge | Ticket reopened | The fixer, on a new PR |
| Close: the ticket carries no check | Left open, the closing record says nothing proves it | The fixer |
| Close: the closing record is refused, or the ticket will not close | Run fails red; the ticket left as it was | The fixer |

## Rules

| Rule | Enforcer |
|---|---|
| A ticket has 1 to 3 criteria (a trial), each with one `check:`. At least one check runs tests. Every check is red at filing. `## Why` quotes the owner | Filing refuses; the start step re-runs the same shape check before any model |
| A test check passes only if it ran at least one test | The check runner fails a run that counted zero tests |
| A build starts only from fresh main, only when main is green, and not when the ticket's checks already pass there | Start refusals that run before any model |
| Nobody pushes to main, the owner included. Everything lands through a PR whose required checks passed on an up-to-date branch | A ruleset on main, read live by a test |
| Work is never thrown away: the branch is pushed before anything can refuse it | A test that the save step pushes before any gate |
| Every green build is read against `## Why` before it merges | A reviewer check the main ruleset requires |
| The fixer gets one turn per ticket and never edits the owner's quoted words | The fixer refuses a second turn and a `## Why` that is not byte-identical |
| A port ships in the same ticket as its first caller | knip's unused-exports check |
| Signed text is the owner's own words, or a page the owner signed in session (the charter, a layer ruling). Text a model wrote and the owner only accepted is not signed. No machine part edits signed text | The fixer's byte-identical quote check, and the required check refusing a machine-authored PR that touches a signed page |

The 3-criteria trial ends after the first 20 capped tickets: if their clean-run rate and filing to
merged time are no better than #662's baseline, the cap goes.
