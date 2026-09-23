# One ticket

The machine's first layer: the owner and a session agree what is wanted, the session files a
ticket, and the machine builds it to merged with proof it does what was meant. Signed by the owner
in session on 2026-09-17 ([ruling ticket](https://github.com/collod873/claude-workflow/issues/665)),
judged against the [charter](../charter.md). Only the owner changes it.

Each rule below names the enforcer the machine ships for it. Which of them run is not kept here: the
generated machine page shows it, worked out from the parts the machine registers. The machine is built by hand until it merges one ticket itself.

**Where it runs.** This repo. Lumaria enrols later, by a stub, when the owner asks. app-starter is
not enrolled. Until Lumaria enrols, a plain `pull_request` check runs this repo's own `bin/check`;
what returns with it is under [Returns when Lumaria enrols](#returns-when-lumaria-enrols).

**Out of this layer.** Queue order, collisions and claim holds go to Many at once. Slicing a spec
and wave order go to Big jobs; a spec's children take this path unchanged. Counting over history
(tickets closed unbuilt, the fixer's test rewrites, the reviewer's drift rate, tickets closed with
no closing record) goes to Look-back.

## The path

1. **File.** The session runs `file-issue ticket`. The body carries `## Why` (the owner's words
   quoted verbatim, the session's one-paragraph summary, and the session link),
   `## Acceptance criteria`, `## Files claimed`, and optionally `## Files to read`.
2. **Start.** The owner's `issues: opened` event starts the build. No label, no dispatch.
3. **Tests.** The test author writes one failing test per behavioural criterion on `ticket/<n>`.
4. **Build.** The builder builds against the brief, with one resumed repair round.
5. **Save.** The branch is pushed and the PR opened with auto-merge on, red or green.
6. **Judge.** The required check runs `bin/check` on the PR head.
7. **Review.** Once green, the reviewer reads `## Why` against the diff.
8. **Merge.** GitHub merges when the required checks pass on an up-to-date branch.
9. **Close.** The merge fires `bin/close` on main. It runs the ticket's checks on the merge commit
   and at its base, posts the closing record and the speed report, and closes the ticket.

Every agent is Sonnet 5 in a fresh context. What keeps them apart is the clean slate and the gate
between them, not a bigger model.

## Runs

Every stop names who clears it.

| Stop | What happens | Cleared by |
|---|---|---|
| Filing refused | Nothing is filed | The filing session, live with the owner |
| Start refused: shape (a raw filing that skipped `file-issue`) | No model spent | The fixer, which rewrites the ticket |
| Start refused: a claimed file is deleted, or a check names a `--config` that does not exist | No model spent | The fixer, which rewrites the ticket |
| Start: the ticket's checks already pass on main | Closed as already done, with a closing record | Nobody needed |
| Start: main is red | No model spent; the ticket waits | The next green after-merge run fires it again |
| The ticket cannot be read at start or close | No model spent; nothing judged | The fixer |
| A stage finds uncommitted work in the tree | No model spent | The run that started the stage, from a clean checkout |
| The test author writes no test, or cannot write a failing test for a criterion | Stage ends red | The fixer, which fixes the ticket |
| A stage writes outside the repo, or its model run exits non-zero | Stage ends red, branch saved | The fixer |
| Build red after the repair round | Branch saved, PR open | The fixer |
| The reviewer finds drift from `## Why` | PR stays open, gaps posted | The fixer |
| The branch conflicts with main | Update refused, PR open | The fixer |
| A stage hits its time cap | Stage ends red, branch saved | The fixer |
| The fixer ends red, or rules the ticket should not exist as written | Closed unbuilt; branch kept; reason on the ticket; listed in the next session's start brief | Nobody; Look-back counts it |
| Red on main after merge | Ticket reopened | The fixer, on a new PR |
| Close: the ticket carries no check | Left open, the closing record says nothing proves it | The fixer |
| Close: the closing record is refused | Run fails red; the ticket left as it was | The fixer |

**The fixer** gets one turn per ticket and never hands back to the builder. It reads `## Why`, and
the filing session's capture or the parent spec when it needs more, then the failure and the diff.
It does one of three things:

- fixes the code;
- fixes the ticket's criteria or tests, giving its reason on the PR;
- closes the ticket unbuilt, with the reason.

## Rules

| Rule | Lives in | Enforcer |
|---|---|---|
| Filing a ticket starts its build. A note never builds | An `issues: opened` trigger | A test over that trigger |
| A ticket has 1 to 3 criteria (a trial), each with one `check:`. At least one check runs tests. Every check is red at filing. `## Why` quotes the owner | The ticket shape module, one copy called by `file-issue` and the start step | `file-issue` refuses with no `--ack`; the start step re-runs the same module and refuses before any model |
| A test check passes only if it ran at least one test | The check runner shared by the start step and close | The runner reads the test count and fails on zero (`vitest -t` with no match exits 0 today) |
| A grep or file check may sit beside a test check, never alone. A document ticket is graded against its question | The ticket shape module; the close step | The filing refusal above; a separate judge at close for document tickets |
| A build starts only from fresh main, only when main is green, and not when the ticket's checks already pass there | The start step | Start refusals that run before any model |
| Tests exist before the build. The builder never edits them. The fixer may fix a wrong one, giving its reason on the PR. No push lowers the test count | Test author stage; builder tool list; required check | The builder's tool list denies edits to the author's test files; the required check refuses a PR whose test count is below its base, or whose test edits by the fixer carry no reason line |
| Nobody pushes to main, the owner included. Everything lands through a PR whose required checks passed on an up-to-date branch | A ruleset on main: PR required, strict required checks, no force push, no deletion, no bypass actor | GitHub; `src/rulesets.proc.test.ts` reads the live ruleset |
| Work is never thrown away: the branch is pushed before anything can refuse it | The save step | A test that the save step pushes before the gate, the review and any branch update (13 finished builds were lost to a pre-push rebase) |
| Done means the ticket's checks pass on the merge commit on main, run by the closer | `bin/close`, fired by `.github/workflows/close.yml` on every push to main | `bin/close` runs each check on the merge commit and at its base, posts the closing record, closes on green and reopens on red |
| The owner never fixes a stuck run and is never asked from this layer | The Runs table | A test that every stop the machine's code can reach appears in the Runs table with a clearer who is not the owner |
| The fixer gets one turn per ticket and never edits the owner's quoted words | The fixer stage | The fixer stage refuses to start when the ticket already carries a fixer marker; its ticket write refuses a body whose `## Why` quote is not byte-identical |
| Every green build is read against `## Why` before it merges | The reviewer stage, a required check | The ruleset requires the reviewer's check; a drift verdict fails it and hands its gaps to the fixer, with no filter between them |
| A port ships in the same ticket as its first caller | The ticket shape; knip's no-unused-exports stays strict | knip in the required check refuses a lone export |
| Signed text is the owner's own words, or a page the owner signed in session (the charter, a layer ruling). Text a model wrote and the owner only accepted is not signed. No machine part edits signed text | `## Why` quotes; `docs/agents/charter.md`; `docs/agents/layers/` | The fixer's byte-identical quote check; the required check refuses a machine-authored PR touching the charter or `docs/agents/layers/` |
| Filing to merged is reported on every merge, with its longest wait named; never a gate | The after-merge step | The speed report posted with the closing record |
| Each agent stage has a time cap (a guard) | `src/stage.ts`, around each stage's model run | A timeout on the model run that ends the stage red |

## Do not rebuild

The deleted lanes' parts were audited one by one (#663). What stays deleted, and the built-in that
does the job instead:

- **Built-ins, not parts:** `issues: opened` for the reconciler's dispatch and the `to-build` label;
  the main ruleset for Verify's verdict and Integrate's merge call; GitHub auto-merge for Integrate;
  a server-side branch update for the four rebase-and-land copies; `concurrency` keyed per ticket
  with `queue: max` for groups that cancelled waiting runs; `timeout-minutes` or a spawn timeout for
  the in-process lane budget; the Claude Code CLI flags (`--model`, `--tools`,
  `--setting-sources ""`, `--json-schema`, `--resume`) for `stage.ts`'s old wrappers.
  `anthropics/claude-code-action` wraps the same CLI and stops no failure the flags leave.
- **Gone for good:** the mechanic, the decision rung, fresh eyes as its own step,
  `CODING_STANDARDS.md` in the brief until a judge enforces it, the out-of-brief tracker issues, the
  sessions note, the red-gate re-run, the checkpoint cache, the files round trip, the immutable-set
  refusal at landing, strike counting, Verify's dispatch, and the Old `close-ticket` with its close
  gate.

Two lane defects are evidence of what not to rebuild:

- Verify's PR check checked out trunk (run 35174765972). Whatever judges a PR judges its head.
- Review's `path:line` filter dropped all 26 findings in 15 of 23 runs. The reviewer returns a
  verdict with its gaps, and nothing sits between that verdict and the fixer.

## Context

Build stages do not load the charter or this page. Each stage is handed what it needs:

| Stage | Handed | Tools |
|---|---|---|
| Test author | The ticket body; claimed files with line numbers; the ports the claim imports; test conventions as a cache of their gates | Read, Edit, Write, Grep, Glob; Bash fenced to the ticket's checks and `bin/check static` |
| Builder | `## Why`; the criteria; the author's tests once; claimed files with line numbers; ports consumed; the files the author read; one check command; style rules as a cache. A module `CONTEXT.md` only when one exists below the root | As the test author |
| Repair | The resumed builder session plus the check's output tail, capped at 8 KB | As the builder |
| Reviewer | `## Why`; the criteria; the diff, capped at 32 KB (over the cap, the claimed files' diff and the file list) | Read only, with a verdict schema |
| Fixer | `## Why`; the session capture or parent spec, capped; the failure tail; the diff; the reviewer's gaps | As the builder, and a ticket write limited to criteria and tests |

- **The brief is capped at 128 KB whole.** 64 KB refused #809, a small change, since the always
  carried `src/scenarios.ts` grows each ticket; inlining costs less than a stage reading it anyway.
- **Every prompt file has a byte ceiling** in a ratchet test. A prompt may shrink; growth fails the
  check.
- **Reads outside the brief are metered** from the stream and reported with the speed report.
- **Prompts state the target positively** ("your check command is X") and teach a rule only when a
  gate holds it.
- **Any filled-in value with no cap is refused** by a test over the stage builders.

## Upkeep

What keeps this ruling true with no hand audit:

- **The growth-limit tests**, from the machine's first commit: one-screen length, a part
  links a real failure, no timers, no drop in test count, and every charter rule naming an enforcer
  that exists.
- **The enforcer test**, pointed at this page as well as the charter: every Rules row names an
  enforcer registered in the machine or shows as NOT ENFORCED YET on the machine page, and every
  registered enforcer names a row that exists.
- **The stops test**: every stop the code can reach is a Runs row with a clearer who is not the
  owner.
- **The generated machine page**, length-tested, from which the stops test reads the machine's
  stops.
- **The prompt byte ratchet** and the brief cap test.
- **The 3-criteria trial's sizing measurement**: the clean-run rate and filing-to-merged time of
  the first 20 capped tickets, against #662's baseline. If they are no better, the cap goes.

## Returns when Lumaria enrols

Parked on 2026-09-22 (464b744): with one repo, the `@stable` check only ever ran the PR's own
`bin/check`. These return, as signed, when a second repo enrols.

**The stable machine.** Checks that judge a PR come from the stable machine, never from the PR:
a `pull_request_target` stub running `@stable`, recording the SHA it judged and failing if it is not
the PR head. A stub has one fixed shape, a trigger and a `uses:` at `@stable`, held by a stub-shape
test inside the stable check. The after-merge step runs on the stable machine.

**Promote.** If a merge changed the machine, the after-merge run builds a sample ticket on the new
copy. Clean moves the `stable` tag; red reverts the merge through a PR and files a ticket, through
`file-issue`, carrying the sample's log. A machine change takes over only after a sample ticket
builds clean on it. Only the App moves the `stable` tag, held by a tag ruleset with the App as its
sole bypass actor.

**The App.** The machine acts as its GitHub App and never falls back to `GITHUB_TOKEN` where the
App is needed; the token step fails red when the key is absent. A token merge starts no runs and a
token PR waits for an approval click, which is what the App stops. The App is not a PAT: its key has
no expiry. A missing or revoked key is the one stop the owner clears, reachable only by removing the
App.

**The probe**, run before the first enrolled build and inside the sample build whenever a merge
touches a stub, a ruleset or the token step. Any failure reopens this ruling:

1. The App's PR runs its checks with no approval click.
2. Those checks satisfy the ruleset on main.
3. The App's merge fires the after-merge run.
4. The owner's direct push to main is refused.
5. A missing App key fails the run red.

**Setup**, by hand in an owner session: the owner creates the App from a checklist the session
writes; the session writes the `stable` tag ruleset; the probe runs.
