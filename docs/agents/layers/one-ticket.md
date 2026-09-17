# One ticket

The New core's first layer: the owner and a session agree what is wanted, the session files a
ticket, and the machine builds it to merged with proof it does what was meant. Signed by the owner
in session on 2026-09-17 ([ruling ticket](https://github.com/collod873/claude-workflow/issues/665)),
judged against the [charter](../charter.md). Only the owner changes it.

Nothing here is built yet, so every rule below is NOT ENFORCED YET: each names the enforcer the New
core ships for it. The New core is built by hand until it merges one ticket itself
([ADR-0200](../../adr/0200-the-machine-is-rebuilt-as-a-small-new-core-in-its-own-folder.md)).

**Where it runs.** This repo. Lumaria enrols later, by a stub, when the owner asks. app-starter is
not enrolled.

**Out of this layer.** Queue order, collisions and claim holds go to Many at once. Slicing a spec
and wave order go to Big jobs; a spec's children take this path unchanged. Counting over history
(tickets closed unbuilt, the fixer's test rewrites, the reviewer's drift rate, tickets closed with
no closing record) goes to Look-back. The session close gate's pass-through (rule census M5) is Old
machine session code, frozen with it; the New core never relies on it, because only its own
after-merge step closes a built ticket.

## The path

1. **File.** The session runs `file-issue ticket`. The body carries `## Why` (the owner's words
   quoted verbatim, the session's one-paragraph summary, and the session link),
   `## Acceptance criteria` and `## Files claimed`.
2. **Start.** The owner's `issues: opened` event fires the stub. No label, no dispatch.
3. **Tests.** The test author writes one failing test per behavioural criterion on `ticket/<n>`.
4. **Build.** The builder builds against the brief, with one resumed repair round.
5. **Save.** The branch is pushed and the PR opened with auto-merge on, red or green.
6. **Judge.** The required check runs from the stable machine on the PR head.
7. **Review.** Once green, the reviewer reads `## Why` against the diff.
8. **Merge.** GitHub merges when the required checks pass on an up-to-date branch.
9. **Close.** The merge fires the after-merge run on the stable machine. It runs the ticket's checks
   on the merge commit, posts the closing record and the speed report, and closes the ticket.
10. **Promote.** If the merge changed the New core, the after-merge run builds a sample ticket on
    the new copy. Clean moves the `stable` tag; red reverts the merge through a PR and files a
    ticket carrying the sample's log.

Every agent is Sonnet 5 in a fresh context. What keeps them apart is the clean slate and the gate
between them, not a bigger model.

## Runs

Every stop names who clears it. The owner is never asked anything from this layer.

| Stop | What happens | Cleared by |
|---|---|---|
| Filing refused | Nothing is filed | The filing session, live with the owner |
| Start refused: shape (a raw filing that skipped `file-issue`) | No model spent | The fixer, which rewrites the ticket |
| Start: the ticket's checks already pass on main | Closed as already done, with a closing record | Nobody needed |
| Start: main is red | No model spent; the ticket waits | The next green after-merge run fires it again |
| The test author cannot write a failing test for a criterion | Stage ends red | The fixer, which fixes the ticket |
| Build red after the repair round | Branch saved, PR open | The fixer |
| The reviewer finds drift from `## Why` | PR stays open, gaps posted | The fixer |
| The branch conflicts with main | Update refused, PR open | The fixer |
| A stage hits its time cap | Stage ends red, branch saved | The fixer |
| The fixer ends red, or rules the ticket should not exist as written | Closed unbuilt; branch kept; reason on the ticket; listed in the next session's start brief | Nobody; Look-back counts it |
| Red on main after merge | Ticket reopened | The fixer, on a new PR |
| The sample build fails on a machine change | `stable` stays put; the merge is reverted through a PR; a ticket is filed through the ticket door | The machine, through this same path |
| The App key is missing or revoked | Run fails red; nothing falls back to `GITHUB_TOKEN` | The owner, the one stop this layer cannot clear, reachable only by removing the App |

**The fixer** gets one turn per ticket and never hands back to the builder. It reads `## Why`, and
the filing session's capture or the parent spec when it needs more, then the failure and the diff.
It does one of three things:

- fixes the code;
- fixes the ticket's criteria or tests, giving its reason on the PR;
- closes the ticket unbuilt, with the reason.

## Rules

| Rule | Lives in | Enforcer | Status |
|---|---|---|---|
| Filing a ticket starts its build. A note never builds | The stub's `issues: opened` trigger | A test over the stub's trigger, and the sample build that files and builds a ticket | NOT ENFORCED YET |
| A ticket has 1 to 3 criteria (a trial), each with one `check:`. At least one check runs tests. Every check is red at filing. `## Why` quotes the owner | The ticket shape module, one copy called by `file-issue` and the start step | `file-issue` refuses with no `--ack`; the start step re-runs the same module and refuses before any model | NOT ENFORCED YET |
| A test check passes only if it ran at least one test | The check runner shared by the start step and close | The runner reads the test count and fails on zero (`vitest -t` with no match exits 0 today) | NOT ENFORCED YET |
| A grep or file check may sit beside a test check, never alone. A document ticket is graded against its question | The ticket shape module; the close step | The filing refusal above; a separate judge at close for document tickets | NOT ENFORCED YET |
| A build starts only from fresh main, only when main is green, and not when the ticket's checks already pass there | The start step | Start refusals that run before any model | NOT ENFORCED YET |
| Tests exist before the build. The builder never edits them. The fixer may fix a wrong one, giving its reason on the PR. No push lowers the test count | Test author stage; builder tool list; required check | The builder's tool list denies edits to the author's test files; the required check refuses a PR whose test count is below its base, or whose test edits by the fixer carry no reason line | NOT ENFORCED YET |
| The checks that judge a PR come from the stable machine, never from the PR | The required-check stub, `pull_request_target` running `@stable` | The ruleset requires that check; the check records the SHA it judged and fails if it is not the PR head (Verify judged trunk: run 35174765972) | NOT ENFORCED YET |
| A stub has one fixed shape: a trigger and a `uses:` at `@stable` | The required check | A stub-shape test inside the stable check, so a PR cannot loosen the stub that routes it | NOT ENFORCED YET |
| Nobody pushes to main, the owner included. Everything lands through a PR whose required checks passed on an up-to-date branch | A ruleset on main: PR required, strict required checks, no force push, no deletion, no bypass actor | GitHub; the probe (below) proves the owner's own push is refused | NOT ENFORCED YET |
| Only the App moves the `stable` tag, and only after a clean sample build | A tag ruleset on `stable` with the App as its sole bypass actor | GitHub; the after-merge step is the only code that moves it | NOT ENFORCED YET |
| The machine acts as its GitHub App and never falls back to `GITHUB_TOKEN` where the App is needed | The token step in each stub | The token step fails red when the key is absent; probe fact 5 | NOT ENFORCED YET |
| Work is never thrown away: the branch is pushed before anything can refuse it | The save step | A test that the save step pushes before the gate, the review and any branch update (13 finished builds were lost to a pre-push rebase) | NOT ENFORCED YET |
| Done means the ticket's checks pass on the merge commit on main, run by the stable machine | The after-merge step | `close-ticket` runs on the merge SHA only, refuses `UNVERIFIED` criteria on a ticket, and records that each check was red at base | NOT ENFORCED YET |
| The owner never fixes a stuck run and is never asked from this layer | The Runs table | A test that every stop the New core's code can reach appears in the Runs table with a clearer who is not the owner (one allowed exception: the App key) | NOT ENFORCED YET |
| The fixer gets one turn per ticket and never edits the owner's quoted words | The fixer stage | The fixer stage refuses to start when the ticket already carries a fixer marker; its ticket write refuses a body whose `## Why` quote is not byte-identical | NOT ENFORCED YET |
| Every green build is read against `## Why` before it merges | The reviewer stage, a required check | The ruleset requires the reviewer's check; a drift verdict fails it and hands its gaps to the fixer, with no filter between them | NOT ENFORCED YET |
| A machine change takes over only after a sample ticket builds clean on it | The after-merge step | The `stable` tag ruleset; the sample build | NOT ENFORCED YET |
| A port ships in the same ticket as its first caller | The ticket shape; knip's no-unused-exports stays strict | knip in the required check refuses a lone export | NOT ENFORCED YET |
| Signed text is the owner's own words, or a page the owner signed in session (the charter, a layer ruling). Text a model wrote and the owner only accepted is not signed. No machine part edits signed text | `## Why` quotes; `docs/agents/charter.md`; `docs/agents/layers/` | The fixer's byte-identical quote check; the required check refuses an App-authored PR touching the charter or `docs/agents/layers/` | NOT ENFORCED YET |
| Filing to merged is reported on every merge, with its longest wait named; never a gate | The after-merge step | The speed report posted with the closing record | NOT ENFORCED YET |
| Each agent stage has a time cap (a guard) | The stub's `timeout-minutes` per job | GitHub | NOT ENFORCED YET |

**Rung** now means only the placement tier ADR-0193 names (settled in `CONTEXT.md`). The strike ladder was Old machine and
has no successor here: the fixer replaces the second model, the mechanic and the owner decision.

## Parts

**Built-ins that replace Old machine parts.**

| Built-in | Replaces | Failure it stops |
|---|---|---|
| `issues: opened` fired by the owner's own filing | The reconciler's dispatch and the hand `to-build` label (V1, T2) | Filing waited a median 6h11m on the label (#663) |
| A ruleset on main with strict required checks and no bypass | Verify's PR verdict (T6), Integrate's merge decision (T7) | 69 tests deleted by direct push (#652); Verify judged trunk, not the PR |
| GitHub auto-merge | Integrate's merge call | Integrate: 27 failed and 11 cancelled runs of 143 |
| Server-side branch update by the App | The four rebase-and-land copies (C1, V24) | 13 green builds discarded on conflict |
| A GitHub App installation token per job | The `GITHUB_TOKEN` dispatch chain (`run-ended`, `ratifier-merged`, `ci.yml` ring) | Token merges start no runs, so nothing checked main after a lane merge (ADR-0164); token PRs wait for a human approval click |
| `concurrency` keyed per ticket with `queue: max` | Groups that cancel a waiting run and strike it (V3) | #516: five Integrate runs cancelled, PRs stranded |
| `timeout-minutes` per job | The in-process lane budget (V4) | A runaway session with no wall |
| Claude Code CLI flags: `--model`, `--tools`, `--setting-sources ""`, `--json-schema`, `--resume` | `stage.ts`'s wrappers and full tool surface (V20) | About 31k tokens paid before the prompt says anything |

The App is not a PAT: its key has no expiry and nothing needs renewing. A PAT's expiry, which stops the
pipeline on a day nobody chose, is what the Old machine refused them for. `anthropics/claude-code-action` is not used; it wraps the same CLI and stops no
failure the flags above leave.

**Old parts that port in**, each rewritten into the New core as its audit verdict says:

- **Ticket shape and `file-issue` (T1).** Adds the 3-criteria cap, the stand-in refusal, `## Why`,
  and red-at-filing with no `--ack`. The claim-line cap goes; claims stay as brief input.
- **Test author with the additive rule (T3, T4).** Coverage becomes a gate: one failing test per
  behavioural criterion. No build without tests; a fetch error is not "no branch".
- **Brief builder (V11).** Adds the ports a claim imports, the acceptance test once, line numbers,
  a whole-brief cap, "nearby" from real imports, and the test author's read list.
- **Builder and repair prompts (V8, V9, V14).** Shortened; one positive check command; only the
  check slots the builder may run.
- **Builder, then one resumed repair (V17).** Fresh eyes folds into the fixer.
- **Deny list (V19).** Widened to whole-suite and estate-wide commands, `git` history moves and
  `gh`, and one list shared by every stage.
- **The `.fails` lock (V26).** Becomes the test-count check plus the builder's deny on the author's
  test files.
- **The timeout abort (V22)**, without its strike comment.
- **`close-ticket` (T8).** Runs on the merge SHA, with zero-test checks failing.
- **The caller and reusable split (V2)**, as stubs, because Lumaria needs it.
- **Style rules as a cache of their gates (V12).**

**Old parts that do not port:** the mechanic (V6), the decision rung (V7), fresh eyes as its own
step (V10), `CODING_STANDARDS.md` in the brief until a judge enforces it (V13), the out-of-brief
tracker issues (V15), the sessions note (V16), the red-gate re-run (V18), the checkpoint cache
(V21), the files round trip (V23), the immutable-set refusal at landing (V25, replaced by judging
from `@stable` and the stub shape), strike counting (V5), and Verify's dispatch (T5). Two Old
defects are evidence of what not to rebuild, not fixes to carry:

- Verify's PR check checked out trunk (run 35174765972). The stable check records and asserts the
  SHA it judged.
- Review's `path:line` filter dropped all 26 findings in 15 of 23 runs. The reviewer returns a
  verdict with its gaps, and nothing sits between that verdict and the fixer.

**New parts, each tied to the failure it stops:**

- **The fixer.** Seven Old stops paged the owner, and the mechanic never ran (#663).
- **The reviewer.** 10 of 16 clean builds lost part of what was meant, and the dropped Review
  findings named the same defects (#661).
- **`## Why`.** The owner and session agreed in all 32 graded tickets; intent was lost afterwards,
  where no later stage could see it (#661).
- **The `stable` tag and sample build.** Machinery that breaks or goes quiet is the owner's top
  complaint across eras (#656).
- **The ruleset and the App.** Direct pushes deleted tests, and nothing re-checked main after a
  merge (#652, #657).
- **Red at filing with no `--ack`.** 58 of 396 grep checks already passed when filed (#662).
- **The zero-test check.** `vitest -t` with no match exits 0 (verified 2026-09-17, vitest 4.1.11).
- **The 3-criteria cap, a trial.** Clean builds had one or two criteria (16 of 22, #662).

## Context

Build stages do not load the charter or this page. Each stage is handed what it needs:

| Stage | Handed | Tools |
|---|---|---|
| Test author | The ticket body; claimed files with line numbers; the ports the claim imports; test conventions as a cache of their gates | Read, Edit, Write; Bash limited to the ticket's test command |
| Builder | `## Why`; the criteria; the author's tests once; claimed files with line numbers; ports consumed; the files the author read; one check command; style rules as a cache. A module `CONTEXT.md` only when one exists below the root | Read, Edit, Write; Bash under the shared deny list |
| Repair | The resumed builder session plus the check's output tail, capped at 8 KB | As the builder |
| Reviewer | `## Why`; the criteria; the diff, capped at 32 KB (over the cap, the claimed files' diff and the file list) | Read only, with a verdict schema |
| Fixer | `## Why`; the session capture or parent spec, capped; the failure tail; the diff; the reviewer's gaps | Read, Edit, Write, Bash under the deny list, and a ticket write limited to criteria and tests |

- **The brief is capped at 64 KB whole.** The Old median was 78 KB, of which the root `CONTEXT.md`
  (16.5 KB) and a second copy of the acceptance test (6.8 KB) are gone here.
- **Every prompt file has a byte ceiling** in a ratchet test. A prompt may shrink; growth fails the
  stable check.
- **Reads outside the brief are metered** from the stream and reported with the speed report.
- **Prompts state the target positively** ("your check command is X") and teach a rule only when a
  gate holds it.
- **Any filled-in value with no cap is refused** by a test over the stage builders.

## Upkeep

What keeps this ruling true with no hand audit:

- **ADR-0200's growth-limit tests**, from the New core's first commit: one-screen length, a part
  links a real failure, no timers, no drop in test count, and every charter rule naming an enforcer
  that exists.
- **The enforcer test**, pointed at this page as well as the charter: every Rules row names an
  enforcer that exists in the New core, or says NOT ENFORCED YET.
- **The stops test**: every stop the code can reach is a Runs row with a clearer who is not the
  owner, bar the App key.
- **The generated machine page**, length-tested, from which the stops test reads the New core's
  stops.
- **The probe**, run before the first build and again inside the sample build whenever a merge
  touches a stub, a ruleset or the token step. It proves five facts, and any failure reopens this
  ruling:
  1. The App's PR runs its checks with no approval click.
  2. Those checks satisfy the ruleset on main.
  3. The App's merge fires the after-merge run.
  4. The owner's direct push to main is refused.
  5. A missing App key fails the run red.
- **The prompt byte ratchet** and the brief cap test.
- **The 3-criteria trial's sizing measurement**: the clean-run rate and filing-to-merged time of
  the first 20 capped tickets, against #662's baseline. If they are no better, the cap goes.

**Setup before the first build**, by hand in an owner session, per ADR-0200:

1. The owner creates the App from a checklist the session writes.
2. The session turns on auto-merge and writes the two rulesets.
3. The session lands the session helper that turns a session's push into an auto-merging PR, so
   locking main does not slow sessions.
4. The probe runs.
