# claude-workflow

The machine that takes what the owner wants done and ships it as merged code, plus the workstation
the sessions run on. The domain here is the machinery itself, not any project it ships.

## Start here

**[`docs/agents/charter.md`](docs/agents/charter.md)**: what the machine is for, and the enforcer
holding every rule. Signed by the owner, changed only by the owner. Read it before changing
machinery, then run `core/bin/machine-page` for what has actually shipped.

**[`CONTEXT.md`](CONTEXT.md)**: the glossary. What each term means here and which near-synonyms to
avoid, so an argument is about the substance rather than about the word.

**[`docs/agents/layers/`](docs/agents/layers/one-ticket.md)**: the layer rulings. One ticket is the
centre and the only one signed so far.

**[`docs/agents/core-boundary.md`](docs/agents/core-boundary.md)**: which gate reads which file.
The Core and the Workstation are judged by different checks and the answer is not obvious.

**[`docs/adr/`](docs/adr/README.md)**: the decision records. Why things are the way they are. Most
of the corpus rules on eras that have since been replaced; the index carries them all, newest last.

**[Seven Workflow Eras](https://claude.ai/code/artifact/ce83212b-8c33-44da-bab8-b2121307cda0)**: the
prior art. Why each of the seven systems before this one ended, and what survived the switch.

## The Core

`core/` is the machine. It is whole: no file in it reaches outside it. `core/check` is its gate,
run by `.husky/pre-push` and by `core-check.yml` on every pull request. Nothing runs it during a
session, so run it by hand before believing core is sound.

## The Workstation

The Workstation is the room the sessions happen in, not a second machine. It is
judged by `npm test`, `npm run lint` and `npm run typecheck`, which nothing fires automatically.

No hook is wired here. Every hook on the workstation, session capture included, lives in
`collod873/agent-hooks`.

## Landing

`main` takes no direct push, the owner's included. Commit locally, then `core/bin/land` opens a
pull request and merges it.

## Layout

```
.
├── CLAUDE.md         # project instructions for Claude Code
├── CONTEXT.md        # the glossary: what the words mean here
├── core/             # the machine, and core/check, its gate
├── bin/              # workstation scripts, linked into ~/bin
├── .claude/skills/   # the session skills, linked into ~/.claude/skills
├── docs/agents/      # the charter, the layer rulings, the boundary
├── docs/adr/         # decision records
└── docs/research/    # the evidence behind them, archived as written
```
