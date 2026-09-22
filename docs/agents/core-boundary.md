# What judges what

There is one machine and it is `core/`. This page is not about a border between two of them. It is
about which gate reads which file, because the answer is not the same everywhere and getting it
wrong wastes a morning.

The Workstation is the owner's computer and the session tooling on it, the hooks under `.claude/`
and the scripts under `bin/`. It is where sessions happen. It does not build anything, it is not a
second machine, and nothing about it is older than the machine: it is the room, not a rival.

[ADR-0200](../adr/0200-the-machine-is-rebuilt-as-a-small-core-in-its-own-folder.md) rules that the
machine is whole, so no file under `core/` reaches outside `core/` for anything.
`core/self-contained.test.ts` holds that by reading import specifiers, and nothing else: a hook that
fires during a core session, or a check that reads a core file, is a separate question from the one
that test answers.

## What the Core's checks see

Two scopes, because the two gates answer different questions.

`core/em-dash.proc.test.ts` reads **every file the repo tracks**, `git ls-files` being the whole
rule. Tracked is the line because ignored paths are not the owner's to clean: session captures and
trial streams carry em dashes nobody wrote by hand, and a gate that read them would refuse a push
forever over local state.

`core/prose.proc.test.ts` reads the same tracked list, minus `docs/research/`. It reads code only,
by extension and shebang, so the markdown beside it is not its business. The archive is the one
carve-out: stripping the comments out of an archived probe script destroys the evidence the research
exists to hold.

The prose gate reads Python, which is what makes it mean anything in `.claude/hooks/`, where almost
every hook is Python. It leaves a module docstring the script hands to `argparse` as
`description=__doc__`, on the same ground it leaves `shellcheck` directives: a machine reads it.

## What the Workstation's checks see

Nothing under `core/`. Four exclusions, one per config:

| File | Exclusion |
|---|---|
| `eslint.config.js` | `ignores: [... "core/**"]` |
| `knip.config.ts` | `ignore: [... "core/**"]` |
| `tsconfig.json` | `include` is `.claude/**/*.ts` and `bin/**/*.ts` |
| `package.json` | `test` is `vitest run .claude bin` |

All four are deliberate, and reversing one is the wrong repair. ADR-0200 deletes the old folders
after 30 days, so a core judged by the lane gates would lose every check it has along with them. A
guard over core code is wired into `core/check`. Porting a lane gate is not the way to give core
one. [#676](https://github.com/collod873/claude-workflow/pull/676) records the morning that was
learned.

## What fires `core/check`

`.husky/pre-push`, and `core-check.yml` on every pull request through `core-check-caller.yml`, which
checks out the PR head and refuses to judge any other SHA. Nothing runs it during a session, so a
core edit is judged when it is pushed and not before. Run `core/check` before believing core is
sound.

## What the Workstation's hooks see

Hooks fire in every session, core sessions included. `~/.claude/settings.json` names
`collod873/agent-hooks` at `~/.agents/hooks`, which owns every hook that fires in every repo on the
workstation, session capture included. This checkout registers none.

Nothing else fires here. The gates that judged a core edit during a session judged it nowhere: they
were path scoped to markdown and to the hooks directory itself, or contract scoped to a
`.claude/contract.json` this repo never had. A core edit is judged when it is pushed, and the
charter's rule that a session changing the machine has read this page and the machine page is
waiting on a hook `core/` owns.
