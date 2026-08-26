# claude-workflow

A workflow system connecting Claude Code and GitHub.

## Start here

**[`GOAL.md`](GOAL.md)** — the charter. What the system is for, the seven constraints any design has
to satisfy, where the human deliberately stays, and what blocks it today. Proposals get scored
against this.

**[`DESIGN.md`](DESIGN.md)** — the target. Every edge from an idea to a closed ticket, what event
fires it, what it refuses, and the five points where the owner is required. Drawn from the charter
rather than from the skills that exist, which is why five of the eleven current verbs don't survive
it.

**[`INDEX.md`](INDEX.md)** — the map of every workflow and planning system we've tried, where each
one is documented, what was measured, and what's still open. Seven eras, six repos, the wiki, the
research corpus, and the 11 open questions on `agent-skills`.

**[Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0)** —
the companion read. The index says *where everything is*; this says *why each system ended and
what survived the switch*. Source in `artifacts/`.

**[`CONTEXT.md`](CONTEXT.md)** — the glossary. What each term means here and which near-synonyms
to avoid, so an argument is about the substance rather than about the word.

**[`docs/adr/`](docs/adr/README.md)** — the decision records. Why things are the way they are.

## Scope

**This repo and nothing else** until the machine runs here. Other repos in the estate show up in
these documents as evidence — a measured number, a mechanism worth stealing — never as work.

There is no status section, here or in `DESIGN.md`. A lane's status is the shape of its own section
there: a six-field contract is shipped, design prose is unbuilt
([ADR-0025](docs/adr/0025-design-md-carries-no-lane-status-a-shipped-lane-collapses-to.md)). The
roadmap is [the `build-order` label](https://github.com/collod873/claude-workflow/issues?q=is%3Aissue+label%3Abuild-order)
([ADR-0026](docs/adr/0026-the-build-order-and-the-filed-open-questions-live-as-issues.md)).

## The gauntlet

`bin/gauntlet <turn|stop|push>` runs typecheck, lint and the unit suite, and every venue calls it:
a Claude Code `PostToolUse` hook, a `Stop` hook, `.husky/pre-push`, and `verify.yml`. A check sits
at the earliest venue whose budget it fits ([ADR-0010](docs/adr/0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md)),
because what earliest buys is a cheap *repair*, not a cheap check.

It installs itself: `npm ci` runs `prepare`, which installs the git hooks. Nothing to remember.

The two in-session venues fail open and refuse nothing — they hand the failure back while the
context that caused it is still loaded. `pre-push` fails closed. `--no-verify` still gets past it;
that closes with branch protection at move 10, not before.

## Layout

```
.
├── CLAUDE.md         # project instructions for Claude Code
├── GOAL.md           # the charter — what we're building toward and what constrains it
├── DESIGN.md         # the target — the machine as a state machine, lane by lane
├── CONTEXT.md        # the glossary — what the words mean here
├── INDEX.md          # the workflow/planning systems index
├── bin/gauntlet      # the checks, one runner, called by every venue
├── bin/new-adr       # creates the next decision record from a title
├── .claude/hooks/    # the in-turn and turn-end venues
├── .Workflow/        # the agent workflows themselves (lane 03 today)
├── docs/adr/         # decision records
├── artifacts/        # source HTML for artifacts published to claude.ai
└── README.md
```
