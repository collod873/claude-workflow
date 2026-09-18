# The New core's boundary

[ADR-0200](../adr/0200-the-machine-is-rebuilt-as-a-small-new-core-in-its-own-folder.md) rules that
`core/` never imports the Old machine. `core/old-machine-boundary.test.ts` holds it by reading
import specifiers, and nothing else: a hook that fires during a core session, or a check that reads
a core file, is a separate question from the one that test answers. This page answers that one.

## What the Old machine's checks see

Nothing under `core/`. Four exclusions, one per config:

| File | Exclusion |
|---|---|
| `eslint.config.js` | `ignores: [... "core/**"]` |
| `knip.config.ts` | `ignore: [... "core/**"]` |
| `tsconfig.json` | `include` is `.Workflow/**/*.ts` and `.claude/**/*.ts` |
| `package.json` | `test` is `vitest run .Workflow .claude` |

All four are deliberate, and reversing one is the wrong repair. [#672](https://github.com/collod873/claude-workflow/issues/672)
did the opposite, pointing the Old typecheck, tests, knip and prose gate at `core/`, and
[#676](https://github.com/collod873/claude-workflow/pull/676) undid it the same morning: ADR-0200
deletes the old folders after 30 days, so a core judged by Old gates loses every check it has along
with them. A guard over core code is wired into `core/check`. Porting an Old gate is not the way to
give core one, and Wave 3 of the [wave map](https://github.com/collod873/claude-workflow/issues/674)
says it plainly: the stable check runs `core/check`, never `bin/gauntlet`.

## What fires `core/check`

`.husky/pre-push`, and nothing else. Nothing runs it during a session, and nothing on GitHub runs it
on a pull request until Wave 3's stable check exists.

The gap is not that the turn-end gate skips core. It is that the gate answers anyway. The `turn` and
`stop` venues collect a changed file by suffix, so a `core/*.ts` edit is collected, handed to
`typecheck`, `lint_one` and `test_related`, and passed by all three: eslint exits 0 on an ignored
path, `vitest related` finds no test files and exits 0, and the root `tsc --noEmit` never held the
file in its program. A planted `core/` file assigning a string to a `number` returns `bin/gauntlet
turn` exit 0 and no output, while `core/check` fails it three ways. `gauntlet-hook` then logs the
verdict `clean`, so the session's telemetry records a core edit as checked and passing.

Read a green turn-end gate as saying nothing about core, and run `core/check` before believing core
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
