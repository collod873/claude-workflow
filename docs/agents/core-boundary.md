# What judges what

There is one machine and it is `core/`, and one gate, `core/check`. This page says which check reads
which file, because the answer is not the same everywhere and getting it wrong wastes a morning.

The machine is whole: no file under `core/` reaches outside `core/` for anything.
`core/self-contained.test.ts` holds that by reading import specifiers, and nothing else: a hook that
fires during a core session, or a check that reads a core file, is a separate question from the one
that test answers.

## What the checks see

Two scopes, because the two gates answer different questions.

`core/em-dash.proc.test.ts` reads **every file the repo tracks**, `git ls-files` being the whole
rule. Tracked is the line because ignored paths are not the owner's to clean: session captures and
trial streams carry em dashes nobody wrote by hand, and a gate that read them would refuse a push
forever over local state.

`core/prose.proc.test.ts` reads the same tracked list, minus `docs/research/`. It reads code only,
by extension and shebang, so the markdown beside it is not its business. The archive is the one
carve-out: stripping the comments out of an archived probe script destroys the evidence the research
exists to hold.

The rest of `core/check` (types, lint, unused code, clones, tests) reads `core/` alone.

## What fires `core/check`

`.husky/pre-push`, and `core-check.yml` on every pull request through `core-check-caller.yml`, which
checks out the PR head and refuses to judge any other SHA. Nothing runs it during a session, so a
core edit is judged when it is pushed and not before. Run `core/check` before believing core is
sound.

## What the hooks see

Hooks fire in every session, core sessions included. `~/.claude/settings.json` names
`collod873/agent-hooks` at `~/.agents/hooks`, which owns every hook that fires in every repo on the
workstation, session capture included. This checkout registers none, so the charter's rule that a
session changing the machine has read this page and the machine page is waiting on a hook `core/`
owns.
