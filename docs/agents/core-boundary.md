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

So `bin/gauntlet`, at every venue in `.claude/contract.json`, never reads a core file. A guard over
core code is wired into `core/check`, never into the contract, and adding a core path to any of the
four files above is the wrong repair.

## What fires `core/check`

`.husky/pre-push`, and nothing else. The Stop gate runs the contract's `stop` slot
([ADR-0167](../adr/0167-turn-end-gates-run-fast-checks-only-ci-owns-the-project-suit.md)), which is
the Old gauntlet, so a core edit is unchecked for the whole session and first meets its checks at
the push.

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
