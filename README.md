# claude-workflow

A workflow system connecting Claude Code and GitHub.

## Start here

**[`GOAL.md`](GOAL.md)** — the charter. What the system is for, the seven constraints any design has
to satisfy, the owner points that survive automation, and what blocks it today. Proposals get scored
against this.

**[The tracker](https://github.com/collod873/claude-workflow/issues)** — the target. What the
machine *is* lives where it is being built: the open design questions are the
[wayfinder map](https://github.com/collod873/claude-workflow/issues/76), the roadmap is
[the `build-order` label](https://github.com/collod873/claude-workflow/issues?q=is%3Aissue+label%3Abuild-order),
and a lane that has shipped is described by its own code and the ADRs that rule it.

**[Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0)** —
the prior art. Why each of the seven systems that came before this one ended, and what survived
the switch.

**[`CONTEXT.md`](CONTEXT.md)** — the glossary. What each term means here and which near-synonyms
to avoid, so an argument is about the substance rather than about the word.

**[`docs/adr/`](docs/adr/README.md)** — the decision records. Why things are the way they are.

## Scope

**This repo and nothing else** until the machine runs here. Other repos in the estate show up in
these documents as evidence — a measured number, a mechanism worth stealing — never as work.

There is no status section. A lane that has shipped is readable as code; a lane that has not is an
open issue. The roadmap is [the `build-order` label](https://github.com/collod873/claude-workflow/issues?q=is%3Aissue+label%3Abuild-order)
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
├── CONTEXT.md        # the glossary — what the words mean here
├── bin/gauntlet      # the checks, one runner, called by every venue
├── bin/new-adr       # creates the next decision record from a title
├── .claude/hooks/    # the in-turn and turn-end venues
├── .Workflow/        # the agent workflows themselves (lane 03 today)
├── docs/adr/         # decision records
└── README.md
```
