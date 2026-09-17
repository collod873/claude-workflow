# Charter

The machine takes what the owner wants done and ships it very fast as very high-quality code.
Signed by the owner on 2026-09-17; only the owner changes it.

## Layers

- **One ticket** (the core): the owner and a session agree what is wanted, the session files a
  ticket, and the machine builds it to merged with proof it does what was meant.
- **Big jobs**: a spec becomes tickets, planned in waves.
- **Many at once**: tickets queue, run side by side, and merge without colliding.
- **Look-back**: readers of past sessions and merged work catch what nothing caught ahead of time.

Each layer uses One ticket; One ticket works with no other layer present.

## Lean on Claude for

- Writing code to a target it can run: a failing test, a check.
- Finding causes with the evidence in hand: logs, run history, the code itself.
- Judging work it did not build, from a fresh context.
- Picking work back up from what was saved instead of redoing it.
- Agreeing intent with the owner in a live session.

## Rules, and what enforces each

Claude grades its own work kindly, calls done early, edits tests to pass, builds more than asked,
follows written instructions only most of the time, and gets lost exploring. So every rule names an
enforcer that runs: a gate, a test, or a separate judge. A rule with no enforcer is marked
**NOT ENFORCED YET** until one ships, or it is deleted.

| Rule | Enforcer | Status |
|---|---|---|
| Every rule on this page names an enforcer that exists | A test over this page | NOT ENFORCED YET |
| Done means the ticket's checks pass on main, run by something that did not build it | `bin/close-ticket`, re-run after every merge | Partly: nothing re-runs checks after a lane merge |
| Checks test the behaviour meant, not a stand-in like a file or a text match | Filing refuses a ticket whose checks are all stand-ins | NOT ENFORCED YET |
| Tests exist before the build starts, and nothing may weaken them | The `.fails` lock, plus a gate on any push that removes test cases | Partly: the builder only |
| An agent is handed what it needs, so it does not explore | The brief's size cap, plus a meter on reads outside the brief | Partly: the cap only |
| The owner is never the one who fixes a stuck run | A test that every stopping point names a fixer who is not the owner | NOT ENFORCED YET |
| The whole machine fits on one generated screen; adding means fitting | A length test on the generated machine page | NOT ENFORCED YET |
| A part with no useful work in 30 days is removed | A job over run history files a removal ticket through the ticket door; a gate counts when it refused something real | NOT ENFORCED YET |
| A part is fired by a real event, never a timer | A test refusing timed triggers in workflows | NOT ENFORCED YET (true today) |
| A part is added only for a failure that happened | A change adding a workflow, hook or `bin/` script is refused unless it links that failure | NOT ENFORCED YET |
| An added part is small, needs no upkeep to stay true, and a built-in Claude Code or GitHub feature was not enough | A separate model grades each added part against this page; a fail blocks it | NOT ENFORCED YET |
| Each rule lives in one place | The copy detector, widened from code to rules | Partly: code only |
| The owner hears plain words and is asked only about scope, priority and taste, a few questions at a time | The owner, present in every session that talks to them | Judgement |
| A session changing the machine has read this page and the machine page | A hook that shows both when a session first edits machinery | NOT ENFORCED YET |

## Loading

Sessions that add, change or rule on machinery read this page and the machine page, then only the
part they touch; research stays behind links. Build lanes do not load it.
