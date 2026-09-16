# Author acceptance tests

Issue #{{ISSUE_NUMBER}}, "{{ISSUE_TITLE}}", is not implemented yet. Write failing tests for it,
directly in this checkout, marked `test.fails`. You are not implementing the ticket.

## The one rule the lane judges you by

**Your diff only adds.** After you finish, the lane reads `git diff` and refuses the batch if you:

- removed or changed any existing line, in any file (a new import goes on its own line),
- edited an existing file that is not a test (a new stub file is fine),
- deleted a file, or wrote outside {{SUITE_ROOTS}},
- wrote no `test.fails(` naming `#{{ISSUE_NUMBER}}`.

Then it runs your test files: every test you wrote must fail today, so it reads green under
`test.fails`. Then the turn gate runs over your files.

## Which criteria get a test

The criteria, numbered:

{{CRITERIA}}

Write a test for each criterion that describes behaviour this ticket builds. Skip a criterion
that is already true today, that only says something stays unchanged, or that a whole-repo check
or a live run proves: the ticket's `check:` commands cover those when it closes. At least one test.

## How to write each test

1. **Title it** `test.fails("#{{ISSUE_NUMBER}}.<index>: <what the criterion claims>", …)`, where
   `<index>` is the criterion's number above. The implementer turns it on by deleting `.fails`
   from exactly that line.
2. **Put it beside its subject**: `<dir>/foo.ts` is proved by `<dir>/foo` plus one of
   {{TEST_SUFFIXES}}. A script or hook is driven from a test whose name carries `.proc.` before
   the suffix. Add to the end of an existing test file.
3. **Import the real subject and call it.** Do not mock what #{{ISSUE_NUMBER}} builds, do not read
   the subject's source as text, do not spawn `vitest`, `tsc` or `eslint`. Only a `.proc.` test
   may import `node:child_process`.
4. **A subject that does not exist yet gets a new stub file** exporting what your test imports,
   each export throwing `new Error("#{{ISSUE_NUMBER}}: not built")`.
5. **Assert what the criterion claims, no more.** Too loose and it passes today; too strict and no
   honest implementation can pass it.

Read whatever you need in the checkout. Run only your own test files (`npx vitest run <file>`) to
confirm each is green under `test.fails`. Do not run the whole suite, and do not commit.

Tests already beside the files this ticket claims:

{{TARGET_TESTS}}

Files this ticket claims:

{{CLAIMED_FILES}}

{{HOUSE_RULES}}

{{CHECK_CONTRACT}}

## Earlier attempts on this ticket

{{PRIOR_ATTEMPTS}}

Where anything is listed above, an earlier run died on each line. Write the batch that does not end
the same way.

## The ticket ({{CRITERIA_COUNT}} criteria)

{{ISSUE_BODY}}

## Its parent PRD

{{PRD_BODY}}

## Example

For a criterion 1 reading ``The gate is at most 120 lines`` against a claimed
`{{EXAMPLE_SUBJECT_PATH}}` that does not exist yet, create the stub:

```ts
export function gateLines(): number {
  throw new Error("#360: not built");
}
```

and create or append to `{{EXAMPLE_TEST_PATH}}`:

```ts
import { expect, test } from "vitest";
import { gateLines } from "./gate-size";

test.fails("#360.1: the gate is at most 120 lines", () => {
  expect(gateLines()).toBeLessThanOrEqual(120);
});
```

## Output

When the files are in the checkout, answer with the `StructuredOutput` tool: one sentence on which
criteria you tested and which you skipped.

```structured-output
{"summary": "Tested criteria 1 and 2 in gate-size.test.ts; skipped 3, which says the map collector stays unchanged."}
```
