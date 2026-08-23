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

## Status

Early setup — the charter, the index and the eras artifact are the first real content. Decision
records start now.

## Layout

```
.
├── CLAUDE.md     # project instructions for Claude Code
├── GOAL.md       # the charter — what we're building toward and what constrains it
├── DESIGN.md     # the target — the machine as a state machine, lane by lane
├── CONTEXT.md    # the glossary — what the words mean here
├── INDEX.md      # the workflow/planning systems index
├── bin/new-adr   # creates the next decision record from a title
├── docs/adr/     # decision records
├── artifacts/    # source HTML for artifacts published to claude.ai
└── README.md
```
