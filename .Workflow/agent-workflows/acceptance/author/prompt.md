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

**Beside its subject.** A criterion about `<dir>/foo.ts` is proved by `<dir>/foo.test.ts`: the same
directory, the subject's name, and one of the test suffixes this repository already uses, which are
{{TEST_SUFFIXES}}. If that test file already exists (it is shown below when the ticket claims it),
return the **whole file** with your tests added; never a fragment. A criterion about a script or a
hook is proved from the nearest test that already drives it, or a new test beside it whose name
carries `.proc.` before the suffix.

Only {{SUITE_ROOTS}} are collected by this repository's suite. A test anywhere else never runs, and
a batch writing a file outside those trees is refused whole.

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
   `vitest`, `tsc` or `eslint`. A test file may not import `node:child_process` unless its name
   carries `.proc.` before the suffix, and it may not `readFileSync` a workflow, a Markdown file or
   anything under `bin/`.
4. **Give a subject that does not exist yet a stub entry point.** When the ticket claims a file that
   does not exist, also return that file with the exports your test imports, each one throwing
   `new Error("#{{ISSUE_NUMBER}}: not built")`, so the test collects, runs, and fails honestly on
   the assertion rather than on the import. The implementer replaces the body; you fix the name.
5. **Expect it to fail, and say so with `test.fails`.** Under `test.fails`, a test whose body
   throws or whose assertion does not hold is *green*, and one that passes is *red*. That is the
   contract the gate checks before your batch lands: every test you wrote is `test.fails`, and the
   whole batch runs green. A test that already passes today is either vacuous or about work that is
   already done, and either way it is refused.

{{HOUSE_RULES}}

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
`{"path": "...", "content": "..."}`, where `path` is repo-relative under one of {{SUITE_ROOTS}},
`content` the complete file.

Write whatever reasoning you need first; only the tool call is read as your answer.

Example, for criterion 1, whose block reads ``The gate is at most 120 lines - check: `wc -l bin/gauntlet` ``
against a claimed `{{EXAMPLE_SUBJECT_PATH}}` that does not exist yet:

```structured-output
{"files": [{"path": "{{EXAMPLE_SUBJECT_PATH}}", "content": "export function gateLines() {\n  throw new Error(\"#360: not built\");\n}\n"}, {"path": "{{EXAMPLE_TEST_PATH}}", "content": "import { expect, test } from \"vitest\";\nimport { gateLines } from \"./gate-size\";\n\ntest.fails(\"#360.1: the gate is at most 120 lines\", () => {\n  expect(gateLines()).toBeLessThanOrEqual(120);\n});\n"}]}
```
