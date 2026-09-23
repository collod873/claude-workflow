# Charter

The machine takes what the owner wants done and ships it very fast as very high-quality code.
Signed by the owner on 2026-09-17, amended 2026-09-23; only the owner changes it.

## Layers

- **One ticket** (the centre): the owner and a session agree what is wanted, the session files a
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
follows written instructions only most of the time, and gets lost exploring. So every rule names the
kind of enforcer that holds it: a gate, a test, or a separate judge. A rule whose enforcer has not
shipped shows as **NOT ENFORCED YET** on the generated machine page until one ships, or it is
deleted. Whether a rule is enforced is worked out there from the parts the machine registers, never
kept on this page.

| Rule | Enforcer |
|---|---|
| Every rule on this page names an enforcer that exists | A test over this page and the machine's registered parts |
| Done means the ticket's checks pass on the merge commit on main, run by something that did not build it | The closer, run by every merge to main |
| Checks test the behaviour meant, not a stand-in like a file or a text match | Filing and the start step refuse a ticket whose checks are all stand-ins |
| A document ticket is graded by a separate judge against its question | A separate judge at close |
| Tests exist before the build starts. The builder never edits them; the fixer may fix a wrong one, giving its reason on the PR; no push lowers the test count | The builder's deny on the author's tests, and a test count gate on every push |
| An agent is handed what it needs, so it does not explore | The brief's size cap, plus a meter on reads outside the brief |
| A message is one line of 200 characters, the rest in a log it names; a part that is not a hook may be registered for up to 5 such lines. Documents (tickets, specs, briefs, judgements) meet their own kind's limit | A test over every part's planted runs |
| The docs every session loads never grow in total; adding a line means cutting one, except in a page the owner signs | A test against the merge base |
| The owner is never the one who fixes a stuck run | A test that every red exit names a stop whose clearer is not the owner |
| The whole machine fits on one generated screen; adding means fitting | A length test on the generated machine page |
| A ticket goes from filing to merged in under an hour, and its longest wait is named; speed is reported, never a gate | A report on every merge |
| A part is fired by a real event, never a timer | A test refusing timed triggers in workflows |
| A part is added, or kept at its layer ruling, only for a failure that happened | A test refusing an unregistered runnable file or a part that links no real failure |
| An added or kept part is small, needs no upkeep to stay true, and a built-in Claude Code or GitHub feature was not enough | A separate model grades each added part, and each kept part at its layer ruling, against this page; a fail blocks it |
| Each rule lives in one place. A prompt may teach a rule a gate holds, as a cache, never one no gate holds | The copy detector, widened from code to rules and to taught rules with no gate |
| Nothing the machine writes, and nothing this repo tracks, carries an em dash | A test over every tracked file, and `bin/land` refusing a commit message that carries one |