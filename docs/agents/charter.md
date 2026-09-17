# Charter

The machine takes what the owner wants done and ships it very fast as very high-quality code.
Signed by the owner on 2026-09-17, amended 2026-09-17; only the owner changes it.

## Layers

- **One ticket** (the core): the owner and a session agree what is wanted, the session files a
  ticket, and the machine builds it to merged with proof it does what was meant.
- **Big jobs**: a spec becomes tickets, planned in waves.
- **Many at once**: tickets queue, run side by side, and merge without colliding.
- **Look-back**: readers of past sessions and merged work catch what nothing caught ahead of time.

Each layer uses One ticket; One ticket works with no other layer present. The machine works in every
enrolled repo, and a part serving those repos is judged by their use of it.

## Lean on Claude for

- Writing code to a target it can run: a failing test, a check.
- Finding causes with the evidence in hand: logs, run history, the code itself.
- Judging work it did not build, from a fresh context.
- Picking work back up from what was saved instead of redoing it.
- Agreeing intent with the owner in a live session.

## Rules, and what enforces each

Claude grades its own work kindly, calls done early, edits tests to pass, builds more than asked,
follows written instructions only most of the time, and gets lost exploring. So every rule names an
enforcer that runs: a gate, a test, or a separate judge. A rule whose enforcer has not shipped shows
as **NOT ENFORCED YET** on the generated machine page until one ships, or it is deleted. Whether a
rule is enforced is worked out there from the parts the New core registers, never kept on this page.

| Rule | Enforcer |
|---|---|
| Every rule on this page names an enforcer that exists | A test over this page and the New core's registered parts |
| Done means the ticket's checks pass on main, run by something that did not build it | `bin/close-ticket`, re-run after every merge |
| Checks test the behaviour meant, not a stand-in like a file or a text match; a document is graded against its question | Filing refuses a ticket whose checks are all stand-ins; a separate judge grades a document ticket at close |
| Tests exist before the build starts. The builder never edits them; fresh eyes may fix a wrong one, giving its reason on the PR; no push lowers the test count | The `.fails` lock on the builder, a gate on any push that removes test cases, and Look-back counting fresh eyes' rewrites |
| An agent is handed what it needs, so it does not explore | The brief's size cap, plus a meter on reads outside the brief |
| Everything the machine says, to a session or the owner, fits in 200 characters; the rest goes to a log file it names | `core/says-little.proc.test.ts` |
| The docs every session loads never grow in total; adding a line means cutting one, except in a page the owner signs | `core/loaded-docs.proc.test.ts` |
| The owner is never the one who fixes a stuck run | A test that every stopping point names a fixer who is not the owner |
| The whole machine fits on one generated screen; adding means fitting | A length test on the generated machine page |
| A ticket goes from filing to merged in under an hour, and its longest wait is named; speed is reported, never a gate | A report on every merge |
| A worker with no useful work in 30 days is removed; a guard stays while it links a real failure it stops and costs nothing unfired | A job over run history files a removal ticket through the ticket door |
| A part is fired by a real event, never a timer | A test refusing timed triggers in workflows |
| A part is added, or kept at its layer ruling, only for a failure that happened | A change adding a workflow, hook or `bin/` script is refused unless it links that failure |
| An added or kept part is small, needs no upkeep to stay true, and a built-in Claude Code or GitHub feature was not enough | A separate model grades each added part, and each kept part at its layer ruling, against this page; a fail blocks it |
| Each rule lives in one place. A prompt may teach a rule a gate holds, as a cache, never one no gate holds | The copy detector, widened from code to rules and to taught rules with no gate |
| The owner hears plain words and is asked only about scope, priority and taste, a few questions at a time | The owner, present in every session that talks to them |
| Nothing the machine writes, and no doc a session loads, carries an em dash | `core/em-dash.test.ts`, and `core/bin/land` refusing a commit message that carries one |
| A session changing the machine has read this page and the machine page | A hook that shows both when a session first edits machinery |

## Loading

Sessions that add, change or rule on machinery read this page and the machine page, then only the
part they touch; research stays behind links. Build lanes do not load it.
