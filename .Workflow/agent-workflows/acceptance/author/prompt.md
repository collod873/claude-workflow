# Author acceptance tests

Issue #{{ISSUE_NUMBER}} — "{{ISSUE_TITLE}}" — is not implemented yet. Your job is to write a
failing test for **each** of its acceptance criteria, from the spec below and nothing else. You
are not implementing the ticket, and you are not checking whether it is already done — it isn't.

## Scope

This prompt and the text below it. Do not explore the codebase, do not read other files, and do
not run anything. You have no tools but the one you answer through.

## The ticket

{{ISSUE_BODY}}

## Its parent PRD, for context on the larger feature this ticket is one slice of

{{PRD_BODY}}

## What to write

One test file per criterion under `{{TEST_DIR}}` is the common shape, but write however many
files it actually takes to cover every criterion — never fewer than one test per criterion, and
never a test that doesn't name one.

For each criterion:

1. Write a test whose name or a comment directly beside it **quotes the criterion's own text
   verbatim** — the exact string from the `- [ ] ...` line, unabbreviated. A checker matches this
   back against the issue body character-for-character; paraphrasing it, even for length, makes
   the match fail.
2. Write the test as if the ticket were already implemented: import the real modules it names (in
   "Files claimed"), call the real functions, assert the real behavior the criterion describes.
   Do **not** import anything that doesn't exist yet purely to avoid a red test, and do not stub
   out the subject under test — a test that mocks away the very thing #{{ISSUE_NUMBER}} is
   supposed to build proves nothing once that thing exists.
3. Expect it to fail. It should fail because the subject isn't built — an assertion that doesn't
   hold yet — not because the test itself is broken. A test that throws while importing, or
   references something that will never exist even after the ticket lands, is a bug in the test,
   not evidence about the ticket.

## What would make this useless

- A test that can pass **before** #{{ISSUE_NUMBER}} is implemented (an assertion so loose it's
  vacuous, or a mock standing in for the real subject) proves nothing when it's landed and proves
  nothing again once the ticket is done — it never turns red, then never turns green either.
- A test file that fails to import or has a syntax error is not "strict", it's broken — a gate
  downstream refuses your whole batch of tests on this, not just the one criterion it names.
- A criterion string that isn't the issue's own text, verbatim, fails the checker even when the
  test itself is well-written.

## Output

Return your answer by calling the `StructuredOutput` tool. Its one key, `files`, is an array of
`{"path": "...", "content": "..."}` — `path` under `{{TEST_DIR}}`, `content` the complete file.

Write whatever reasoning you need first — only the tool call is read as your answer.

Example:

```structured-output
{"files": [{"path": "tests/acceptance/162-collect-and-classify.test.ts", "content": "import { describe, it, expect } from \"vitest\";\n\ndescribe(\"push-gate\", () => {\n  it(\"npm test exits 0 with a test asserting a fake GitExec receives no push when a synthetic test file has a collection error\", () => {\n    expect(true).toBe(false);\n  });\n});\n"}]}
```
