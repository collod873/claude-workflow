# Author acceptance tests

Issue #{{ISSUE_NUMBER}}, "{{ISSUE_TITLE}}", is not implemented yet. Your job is to write a
test for **each** of its {{CRITERIA_COUNT}} acceptance criteria, from the spec below and nothing
else, and to mark every one of them `test.fails`. You are not implementing the ticket, and you are
not checking whether it is already done; it isn't.

## Scope

This prompt and the text below it: the ticket, its parent PRD, and the current contents of every
file the ticket claims. Do not explore the codebase beyond what is shown here, and do not run
anything. You have no tools but the one you answer through.

The claimed files are here so you can match the **shape** of what you assert against: an export's
real name and signature, a config key that is quoted, a function's real arguments. They are the
*before* state: never weaken an assertion to fit what you see, and never conclude a criterion is
already satisfied because a file looks close.

## The criteria, numbered as the checker will look for them

Each block below is one criterion, numbered in the order the checker uses. That number is the
`<index>` in every test title you write for it: criterion 1 is `.1`, criterion 2 is `.2`, and so
on. Read each in full; a criterion's trailing `check:` marker, where it has one, is part of what
it claims.

{{CRITERIA}}

## Where a test lives

**Beside its subject.** A criterion about `.Workflow/agent-workflows/shared/foo.ts` is proved by
`.Workflow/agent-workflows/shared/foo.test.ts`: the same directory, the subject's name, the
`.test.ts` suffix. If that test file already exists (it is shown below when the ticket claims it),
return the **whole file** with your tests added; never a fragment. A criterion about a `bin/`
script or a hook is proved from the nearest `.test.ts` under `.Workflow/` or `.claude/` that
already drives it, or a new `.proc.test.ts` beside the hook.

Only `.Workflow/**` and `.claude/**` are collected by the suite. A test anywhere else never runs.

## What to write

For each criterion:

1. **Name the test after the ticket and the criterion's number**: `test.fails("#{{ISSUE_NUMBER}}.<index>:
   <what the criterion claims>", …)`, where `<index>` is that criterion's number above. This title is
   how the criterion is found: `shared/affected-tests.ts` matches test titles against
   `#{{ISSUE_NUMBER}}.<index>:`, and a test titled with the wrong index, or none, is invisible to the
   run that is supposed to prove it. No comment names the criterion; the title is the only record.
2. **`#{{ISSUE_NUMBER}}.<index>` is load-bearing.** `bin/close-ticket` refuses to close a ticket
   while a surviving `test.fails(` line still names it, and the implementer turns the test on by
   dropping `.fails` from exactly this line and nothing else — the `#{{ISSUE_NUMBER}}.<index>:`
   prefix stays untouched.
3. **Import the subject and call it.** Reach the real module the ticket claims, exercise the real
   function, assert the real behaviour the criterion describes. Do not mock away the thing
   #{{ISSUE_NUMBER}} is supposed to build; do not read the subject's source as text; do not spawn
   `vitest`, `tsc` or `eslint`. A test file may not import `node:child_process` unless it is named
   `*.proc.test.ts`, and it may not `readFileSync` a workflow, a Markdown file or anything under
   `bin/`.
4. **Give a subject that does not exist yet a stub entry point.** When the ticket claims a file that
   does not exist, also return that file with the exports your test imports, each one throwing
   `new Error("#{{ISSUE_NUMBER}}: not built")`, so the test collects, runs, and fails honestly on
   the assertion rather than on the import. The implementer replaces the body; you fix the name.
5. **Expect it to fail, and say so with `test.fails`.** Under `test.fails`, a test whose body
   throws or whose assertion does not hold is *green*, and one that passes is *red*. That is the
   contract the gate checks before your batch lands: every test you wrote is `test.fails`, and the
   whole batch runs green. A test that already passes today is either vacuous or about work that is
   already done, and either way it is refused.

## Fixtures

Use the shared ones rather than writing your own: `shared/gh.fake.ts` (`createFakeGh`,
`createRecordingGh`) for a `GhExec`, `shared/git.fake.ts` for a `GitExec`, `shared/stage.fake.ts`
for a model stage, `shared/temp-repo.fixture.ts` for a real throwaway git repo,
`shared/scratch.fixture.ts` for a temp directory. Never define a function or const named `fakeGh`,
`createFakeGh`, `stubGh` or `makeGh` in a test.

## Two things the linter does

No hand-written `repos/{owner}/{repo}/...` REST paths, as a template literal or as a regex: build
them through `shared/gh-paths.ts`. No inline `err instanceof Error ? err.message : String(err)`:
use `reason(err)` from `shared/reason.ts`.

## The failure that looks honest

A test that can pass **before** #{{ISSUE_NUMBER}} is implemented (an assertion so loose it is
vacuous, or a mock standing in for the real subject) is refused, because under `test.fails` it
reads as red. Its mirror image is worse, because it looks like rigour: a test **no implementation
could pass**, which stays red after the ticket is built and fires the repair loop against an
implementer who is not wrong. Where the ticket does not say a path's root, a name, an order, assert
what the criterion actually claims and leave the rest alone.

## The ticket

{{ISSUE_BODY}}

## Its parent PRD, for context on the larger feature this ticket is one slice of

{{PRD_BODY}}

## The files this ticket claims, as they stand today

{{CLAIMED_FILES}}

## Before you answer

Go back through the numbered criteria list and name, for each number, the test titled
`#{{ISSUE_NUMBER}}.<that number>:` that covers it. Every number from 1 to {{CRITERIA_COUNT}} has
one, or you are not done.

## Output

Return your answer by calling the `StructuredOutput` tool. Its one key, `files`, is an array of
`{"path": "...", "content": "..."}`, where `path` is repo-relative under `.Workflow/` or `.claude/`,
`content` the complete file.

Write whatever reasoning you need first; only the tool call is read as your answer.

Example, for criterion 1, whose block reads ``The gate is at most 120 lines - check: `wc -l bin/gauntlet` ``
against a claimed `.Workflow/agent-workflows/shared/gate-size.ts` that does not exist yet:

```structured-output
{"files": [{"path": ".Workflow/agent-workflows/shared/gate-size.ts", "content": "export function gateLines(): number {\n  throw new Error(\"#360: not built\");\n}\n"}, {"path": ".Workflow/agent-workflows/shared/gate-size.test.ts", "content": "import { expect, test } from \"vitest\";\nimport { gateLines } from \"./gate-size\";\n\ntest.fails(\"#360.1: the gate is at most 120 lines\", () => {\n  expect(gateLines()).toBeLessThanOrEqual(120);\n});\n"}]}
```
