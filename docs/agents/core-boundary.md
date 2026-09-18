# The New core's boundary

[ADR-0200](../adr/0200-the-machine-is-rebuilt-as-a-small-new-core-in-its-own-folder.md) rules that
`core/` never imports the Old machine. `core/old-machine-boundary.test.ts` holds it by reading
import specifiers, and nothing else: a hook that fires during a core session, or a check that reads
a core file, is a separate question from the one that test answers. This page answers that one.

## What the New core's checks see

Two scopes, because the two gates answer different questions.

`core/em-dash.proc.test.ts` reads **every file the repo tracks**, `git ls-files` being the whole
rule. Tracked is the line because ignored paths are not the owner's to clean: session captures,
`.Workflow/` leftovers and trial streams carry em dashes nobody wrote by hand, and a gate that read
them would refuse a push forever over local state.

`core/prose.proc.test.ts` reads the same tracked list, minus `docs/research/`. It reads code only,
by extension and shebang, so the markdown beside it is not its business. The archive is the one
carve-out: stripping the comments out of an archived probe script destroys the evidence the research
exists to hold, and those 69 comments are the only thing the widening would have cost.

Neither is the reversal [#676](https://github.com/collod873/claude-workflow/pull/676) undid. That
one pointed *Old* gates at `core/`, so a core judged by gates ADR-0200 deletes would lose them at
the deletion. These gates outlive the deletion, and what they read is what ADR-0200 keeps.

The prose gate reads Python, which is what makes it mean anything in `.claude/hooks/`, where 21 of
the 23 hooks are Python and the gate read 2 of them before. It leaves a module docstring the script
hands to `argparse` as `description=__doc__`, on the same ground it leaves `shellcheck` directives:
a machine reads it.

## What the Old machine's checks see

Nothing under `core/`. Four exclusions, one per config:

| File | Exclusion |
|---|---|
| `eslint.config.js` | `ignores: [... "core/**"]` |
| `knip.config.ts` | `ignore: [... "core/**"]` |
| `tsconfig.json` | `include` is `.claude/**/*.ts` and `bin/**/*.ts` |
| `package.json` | `test` is `vitest run .claude bin` |

All four are deliberate, and reversing one is the wrong repair. [#672](https://github.com/collod873/claude-workflow/issues/672)
did the opposite, pointing the Old typecheck, tests, knip and prose gate at `core/`, and
[#676](https://github.com/collod873/claude-workflow/pull/676) undid it the same morning: ADR-0200
deletes the old folders after 30 days, so a core judged by Old gates loses every check it has along
with them. A guard over core code is wired into `core/check`. Porting an Old gate is not the way to
give core one, and Wave 3 of the [wave map](https://github.com/collod873/claude-workflow/issues/674)
says it plainly: the stable check runs `core/check`, and nothing else.

What the two scopes cover has narrowed with the folders. The lane deletion took `.Workflow/` out of
both configs, so the Old machine's checks are now the workstation's own: the hooks under `.claude/`
and the scripts under `bin/`.

## What fires `core/check`

`.husky/pre-push`, and `core-check.yml` on every pull request through `core-check-caller.yml`, which
checks out the PR head and refuses to judge any other SHA. Nothing runs it during a session.

The turn-end gate that used to answer for core, wrongly, is gone with the lanes: it collected a
changed file by suffix, handed a `core/*.ts` edit to `typecheck`, `lint_one` and `test_related`, and
passed it in all three, because eslint exits 0 on an ignored path, `vitest related` finds no test
files and exits 0, and the root `tsc --noEmit` never held the file in its program. Nothing in a
session answers for core now, which is the honest version of the same state.

So a core edit is judged when it is pushed, and not before. Run `core/check` before believing core
is sound.

## What the Old machine's hooks see

Hooks fire in every session, core sessions included. `~/.claude/settings.json` dispatches through
`~/.agents/workflow`, a clone of `main` that `clone-refresh.py` pulls at SessionStart and
`clone-guard.py` keeps read only. Changing a hook therefore means editing `.claude/hooks/` in this
checkout and landing it; there is no separate global copy, and no reason for `core/` to carry
machinery that routes around one.

No hook in `.claude/hooks/roster.json` mentions `core/`. They divide in two:

- **Path scoped, so they miss core entirely**: `adr-gate` fires under `docs/adr/`,
  `checklist-reminder` on `.md`, `.markdown` and `.txt`, `hook-gate` inside a hooks directory or a
  settings file, `md-html-refresh` on markdown, `post-edit-validate` on `.py`, `.js`, `.json` and
  `.html`. A `core/*.ts` edit reaches none of them, which also means no syntax check.
- **Tracker scoped, so they apply on purpose**: `validate-bash`, `close-gate` and `stop-gate` hold
  filing and closing discipline over the one tracker both machines share. Their refusals name Old
  paths (`~/bin/file-issue`), so a refusal goes stale the day the core ships its own door.
