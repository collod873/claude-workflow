# Grading the two floors, on #603 and #586

Written 2026-09-18 by session `597d5459-1971-4813-ac2e-9b30470992cd`, before the live floor was run
once. Post-hoc grading voids the subject, so this file lands first and is not edited after the first
run. A later session that disagrees with a binary writes a new file saying so; it does not rewrite
this one.

## What is graded, and what is not

A ticket body, and nothing downstream. The owner cut the build hop, so both floors stop once the body
exists. This therefore measures **which filing shape files faithfully, not which gets the right thing
built.** That distinction is not decoration: `docs/research/intent-fidelity-2026-09.md` measured loss
at the build hop as 3 of 16 at the ticket door and 13 of 16 for spec children. The hop being cut is
real and large, and no result here speaks to it.

Two floors, one of which is not run:

| | What it is | Run |
|---|---|---|
| Historical floor | The body that was actually filed, and how the audit graded it | No. Already recorded, and graded below. |
| Live floor | Fat context from the raw jsonl, filed through `core/bin/file-issue` | Yes |

The historical floor is a control because the history exists, not something to re-execute. The Old
machine's `file-issue` and author are a different code system and are not reproduced.

## The oracle

Per subject, two binaries against the body:

1. Does it ask for the **dropped item** — the thing the owner agreed to that the real ticket lost?
2. Does it still ask for the **surviving item** — the thing the real ticket kept?

The second exists so a body cannot win by being vague about everything. A body that drops the
surviving item to win the first binary has not filed better, it has filed differently.

Both items come from `docs/research/intent-fidelity-2026-09.md`, which supplies each subject's
"Wanted" and "Built". Where that note summarises, the agreement itself is quoted below from the
filing session, so a grader never has to infer what was meant.

**One standard applies to both binaries: asked for as work.** A body asks for something when a
reader has to do it — it is a criterion, a claimed file, or a sentence in the build section naming it
as part of the work. Describing it, reasoning about it, or raising it as an open question is not
asking for it. Both historical bodies fail a binary precisely here, so a grader who softens this
standard will grade both floors the same and measure nothing.

## #603

Filed from session `ca7a2c5c`, 2026-09-16, owner engagement explicit. Body: 5,031 bytes.

**The agreement.** The session put four numbered points to the owner and he answered "Do that yes".
Point 2, verbatim:

> `publish-issue-graph` becomes a thin shim that hands the graph JSON to the TypeScript publisher.
> Same command, same JSON, same table printed back. Nothing about how you or the skill use it
> changes.

Point 1, verbatim:

> The TypeScript publisher becomes the one writer and takes on the Python's validation: unique keys,
> no cycles, ticket shape, and the #407 rules, inward-only edges and resolvable paths.

**Binary 1, the dropped item: does the body keep the by-hand route working as it does today?**

Yes requires all three of the owner's three, asked for as work:

- the **same command** — `bin/publish-issue-graph` invoked the way it is invoked today;
- the **same JSON** — the input the by-hand route already writes, not a new input shape;
- the **same table** — the output printed back unchanged.

Plus one thing the audit named separately: something has to exercise the forwarding command. The
audit's finding was "Nothing tests that the forwarding command runs." A body that promises sameness
and checks none of it has asked for a claim no stage can refuse.

Grade **no** if the body specifies a new input format, a different printed table, or a changed
calling convention for `bin/publish-issue-graph`, whatever it says elsewhere about the shim being
thin.

**Binary 2, the surviving item: does the body still ask for one publisher, with the old command
forwarding to it?**

Yes requires the TypeScript path named as the single place that validates and publishes the graph,
and `bin/publish-issue-graph` reduced to forwarding with no logic of its own.

**The historical floor's grade.**

| Binary | Grade | Evidence |
|---|---|---|
| 1, same command / JSON / table | **no** | The body specifies a new input file holding `{ "parent", "plan" }` with `dependsOn` by position, replacing the graph JSON of pre-rendered bodies, and a table of its own design. No criterion runs the shim. The session's own summary to the owner flagged the break: "a session publishing a graph can't hand over loose markdown anymore." |
| 2, one publisher, old command forwards | **yes** | "`bin/publish-issue-graph` is a shim of at most 20 lines that execs the CLI", and the CLI "hands both to `sliceAndPublish`". |

This reproduces the audit's "Ticket: partial", which is the check that the rubric is reading the same
thing the judges read.

## #586

Intent formed in session `0c62c7f3` (2026-09-15) and was filed by `4af6f9ae` (2026-09-16), so the
handoff between two sessions is itself part of what the live floor has to survive. Owner engagement
batch-approved. Body: 2,821 bytes.

**The agreement.** The second session ruled on four issues at once and put them to the owner as a
batch. Its ruling on #586, verbatim:

> **Rule: carry resolutions, rediscover judgments.**
>
> A resolution is something a machine already turned from ambiguous to determinate (a token to a full
> path, a checkpoint's structured output, a config to a value). A judgment is something a reader has
> to form. Carrying a judgment doesn't remove a decision downstream — it substitutes upstream's, and
> that destroys the independence the pipeline is built on.
>
> Boundary test: **if downstream gets it wrong, does something notice?** Caught by a later gate → let
> it rediscover. Caught only by a red test that looks like bad code → carry it.
>
> Staleness: carry with the ref the fact was read at, and have the consumer revalidate cheaply.
> Carriage with revalidation, never carriage as trust.

and, in the same ruling:

> The one concrete item this issue was filed to find: **hand the slicer `repoTopLevel()`.**

**Binary 1, the dropped item: does the body ask for the rule to be written down?**

Yes requires the decided rule to be asked for as work — a criterion, a claimed file, or a named
deliverable putting "carry resolutions, rediscover judgments" somewhere a later stage reads it, such
as an ADR or the charter.

This is the binary most likely to be graded wrongly, because the historical body talks about
carriage at length. Restating the *question* is not the rule. The body must carry the *answer*, and
ask for it to be recorded. A body that reproduces the question section and adds no criterion for the
rule grades **no**, however much prose it spends.

**Binary 2, the surviving item: does the body still ask for the slicer to be handed the repo's real
top-level folders?**

Yes requires the slice prompt to be built from the repository's real top-level entries read at run
time, rather than from entries typed into the prompt.

**The historical floor's grade.**

| Binary | Grade | Evidence |
|---|---|---|
| 1, the rule written down | **no** | The body's `## Question` section restates the open question and lists "what resolving this should settle", and still carries the pre-decision line "Run `file-issue ticketify <n>` once this is decided". The decided rule appears nowhere. All three criteria and all four claimed files are the slicer item. |
| 2, the slicer gets the real folders | **yes** | "The rendered slice prompt carries the repository's real top-level entries, read at run time rather than typed into the prompt", plus a criterion for one function feeding both the prompt and the validator. |

This reproduces the audit's "Ticket: partial" and its plain-words entry: "the slicer gets the real
list, but the rule was never written down."

## What a run records

Per subject, per floor: the two binaries, and for each the lines of the body that earned the grade.
A grade with no quoted evidence is not a grade.

Recorded beside them, because they are results rather than implementation details:

- post-trim bytes of the transcript the live floor read, against the raw jsonl and against the
  stripped summary every dry-run arm read;
- input and output tokens, dollars and wall clock, from the run's own stream;
- the `ticketRefusals` verdict on the body, and whether it filed.

## Two things a reader should not conclude

**The gap between floors is not all synthesis.** Both historical bodies fail today's
`ticketRefusals`, verified against `core/ticket-shape.ts`: #586 carries no `## Why` and an em dash on
line 12; #603 carries no `## Why`, seven acceptance criteria rather than one to three, and two
`check:` markers on its third criterion. Both predate the `## Why` requirement. Some of any
improvement is a format change that already shipped. It does not disqualify the historical floor as a
control, because the two binaries above are about content and neither one is a shape rule.

**The floors do not run the same model, and that is the point, not a flaw.** `core/bin/file-issue` is
a validator with no model in it, so the filing model is whatever the session happens to be. The live
floor runs what the owner's terminal runs. The sonnet hardcoded in `core/test-author.ts`,
`trials/ticket-filing/author.mjs` and `trials/ticket-filing/builder.mjs` is the test author, one
stage later, and is not this cell.
