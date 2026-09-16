# claude-workflow

A workflow system connecting Claude Code and GitHub.

## Start here

**[The tracker](https://github.com/collod873/claude-workflow/issues)**: the target. What the
machine *is* lives where it is being built: the open design questions are the
[wayfinder map](https://github.com/collod873/claude-workflow/issues/76), the roadmap is
[the `build-order` label](https://github.com/collod873/claude-workflow/issues?q=is%3Aissue+label%3Abuild-order),
and a lane that has shipped is described by its own code and the ADRs that rule it.

**[Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0)**:
the prior art. Why each of the seven systems that came before this one ended, and what survived
the switch.

**[`CONTEXT.md`](CONTEXT.md)**: the glossary. What each term means here and which near-synonyms
to avoid, so an argument is about the substance rather than about the word.

**[`docs/adr/`](docs/adr/README.md)**: the decision records. Why things are the way they are.

## The gauntlet

`bin/gauntlet <venue>` runs the slots `.Workflow/agent-workflows/shared/venue-slots.json` names for that venue, and every venue
calls it: a Claude Code hook, `.husky/pre-push`, and CI. A rule sits at the highest rung that can
hold it and the earliest venue that can see enough
([ADR-0193](docs/adr/0193-a-rule-is-placed-at-the-highest-rung-that-can-hold-it-and-th.md)).

It installs itself: `npm ci` runs `prepare`, which installs the git hooks. Nothing to remember.

## Layout

```
.
├── CLAUDE.md         # project instructions for Claude Code
├── CONTEXT.md        # the glossary: what the words mean here
├── bin/gauntlet      # the checks, one runner, called by every venue
├── bin/new-adr       # creates the next decision record from a title
├── .claude/hooks/    # the in-turn and turn-end venues
├── .Workflow/        # the agent workflows themselves
├── docs/adr/         # decision records
└── README.md
```
