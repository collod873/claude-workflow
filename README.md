# claude-workflow

The machine that takes what the owner wants done and ships it as merged code.

- [`CLAUDE.md`](CLAUDE.md): how to work here, landing and the gate included.
- [`docs/agents/charter.md`](docs/agents/charter.md): what the machine is for, and the enforcer
  holding every rule. Only the owner changes it.
- [`docs/agents/layers/`](docs/agents/layers/one-ticket.md): the layer rulings.
- [`CONTEXT.md`](CONTEXT.md): the glossary.

```
.
├── bin/    # the commands: bin/check, bin/land, bin/file-issue, ...
├── src/    # the code they run, and its tests
└── docs/   # the charter and the layer rulings
```
