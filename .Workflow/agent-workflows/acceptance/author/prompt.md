# Author acceptance tests

Issue #{{ISSUE_NUMBER}} — "{{ISSUE_TITLE}}" — is not implemented yet. Your job is to write a
failing test for **each** of its acceptance criteria, from the spec below and nothing else. You
are not implementing the ticket, and you are not checking whether it is already done — it isn't.

## Scope

This prompt and the text below it — which includes the current contents of every file the ticket
claims, and of everything already sitting beside the tests that is not itself a test. Do not
explore the codebase beyond what is shown here, and do not run anything. You have no tools but the
one you answer through.

The claimed files are here so you can match the **shape** of what you assert against — a YAML key
that is quoted, a job that names no event type, an export's real signature. They are not a
description of the finished work: the ticket is not implemented, and a claimed file that already
exists is the *before* state. Never weaken an assertion to fit what you see, and never conclude a
criterion is already satisfied because a file looks close. Read them to stop yourself guessing
wrong about a file's form, not to decide what the criterion means.

## The ticket

{{ISSUE_BODY}}

## Its parent PRD, for context on the larger feature this ticket is one slice of

{{PRD_BODY}}

## The files this ticket claims, as they stand today

{{CLAIMED_FILES}}

## The shared helpers already living under `{{TEST_DIR}}`

These are the non-test files beside the acceptance tests — readers that earlier runs of this lane
factored out of their own test files. A reader you need may already be here. Import it rather than
writing your own copy of it, and if what you need is close but not identical, prefer widening your
call over restating the reader.

{{SHARED_FILES}}

## What to write

One test file per criterion under `{{TEST_DIR}}` is the common shape, but write however many
files it actually takes to cover every criterion — never fewer than one test per criterion, and
never a test that doesn't name one.

**A reader more than one of your files needs goes in a `.fixture.ts`, not in each of them.** You
are writing every one of these files in a single answer, so a helper you copy into three of them is
three copies you wrote knowingly — and copies diverge: the last run of this lane wrote one YAML
block reader three times with three different bugs, two of which are what made the landed tests
wrong. Put it in one `{{TEST_DIR}}<name>.fixture.ts` and import it from each test that needs it.
That path is allowed, it is not collected as a suite, and the clone checker this repo runs on every
push reports the copies if you make them instead.

**Nothing you write may import a path outside `{{TEST_DIR}}`.** Not the subject under test, not a
helper, not a type — no `../` specifier that climbs out of that directory. This is a lint rule
(`acceptance-boundary/no-outside-import`) and it fails the whole batch, so a single `import { thing }
from "../../.Workflow/..."` costs every criterion in this run, not just the one file.

The reason is what makes acceptance tests worth anything: CI restores `{{TEST_DIR}}` from trunk's tip
before running it, and restores *only* that directory. A helper you imported from elsewhere is
whatever the branch under test says it is, so an implementer could satisfy your test by editing the
helper instead of building the ticket. Your directory is the sealed part; anything reached through
an import is not.

So reach the subject the way a shell would, not the way a module would:

- **Run a command and read what it did** — `execFileSync` a CLI, a `bin/` script, `npx vitest run
  <the subject's own test file>`, `npx tsx -e '<a few lines that import the subject and print>'`.
  A child process resolves imports at runtime, which is not an import in your file.
- **Read the file and assert on its text or its parsed form** — for a rule that is stated in a
  config, a workflow YAML, a prompt, an ADR. Never `vitest.config.ts` and never anything under
  `.github/`: no pull request may edit those, so an assertion about their contents returns the
  same verdict before the ticket is built and after it merges, and no implementation can ever move
  it. Assert the behaviour such a file configures instead. A gate downstream refuses your whole
  batch for this.
- **Bare package specifiers are fine** (`vitest`, `node:fs`, `node:child_process`, `yaml`) — those
  come from `package-lock.json`, which the restore already covers. It is only relative paths that
  climb out.

A `.fixture.ts` beside your tests is inside the boundary and may hold whatever the rule below asks
you to factor out — but it is bound by this same rule, so it may not import outward either.

One more house rule the linter enforces on anything you write: no hand-written
`repos/{owner}/{repo}/...` REST paths, as a template literal or as a regex.

Narrowing an unknown error inline — `err instanceof Error ? err.message : String(err)` — is banned
everywhere else in this repo and allowed in your directory, precisely because the helper it would
otherwise point you at is on the far side of the boundary above.

For each criterion:

1. Write a test whose name or a comment directly beside it **quotes the criterion's own text
   verbatim** — the exact string from the `- [ ] ...` line, unabbreviated. A checker matches this
   back against the issue body character-for-character; paraphrasing it, even for length, makes
   the match fail.
2. Write the test as if the ticket were already implemented: reach the real modules it names (in
   "Files claimed"), exercise the real functions, assert the real behavior the criterion describes.
   Do **not** import anything that doesn't exist yet purely to avoid a red test, and do not stub
   out the subject under test — a test that mocks away the very thing #{{ISSUE_NUMBER}} is
   supposed to build proves nothing once that thing exists. **Reach it without importing it** —
   see the boundary below.
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
- A test that **no implementation could pass** is worse than a broken one, because it looks
  honest. It fails with a clean assertion error on the branch that builds the ticket, and a red
  acceptance test has exactly one meaning downstream — *the implementation is wrong* — so the
  repair loop re-fires the implementer, who is not wrong, against a demand nothing can meet. Two
  shapes cause it: an assertion about a file no pull request may edit (above), and an assertion
  that pins down something the ticket left open. Where the ticket does not say — a path's root, a
  name, an order — assert what the criterion actually claims and leave the rest alone, because the
  implementer is reading the same sentence you are and cannot ask you what you decided.
- A criterion string that isn't the issue's own text, verbatim, fails the checker even when the
  test itself is well-written.
- A test that is wrong about the **form** of a file shown to you above — parsing a key that is
  quoted as if it were bare, expecting a list in block form when it is written inline, demanding a
  string appear in a job that structurally cannot contain it — is red for a reason that has
  nothing to do with the ticket, and it stays red after the ticket is built. That is the failure
  the section above exists to prevent, so check your assertion against the text you were given
  before you write it.
- A `.fixture.ts` no test file of yours imports is dead code, and one holding a reader only a
  single test uses is indirection for its own sake. Factor out what two or more of your files
  need, and nothing else. A fixture is never a criterion's test either — every criterion still
  needs its own test.

## Output

Return your answer by calling the `StructuredOutput` tool. Its one key, `files`, is an array of
`{"path": "...", "content": "..."}` — `path` under `{{TEST_DIR}}`, `content` the complete file.

Write whatever reasoning you need first — only the tool call is read as your answer.

Example:

```structured-output
{"files": [{"path": "tests/acceptance/162-collect-and-classify.test.ts", "content": "import { describe, it, expect } from \"vitest\";\n\ndescribe(\"push-gate\", () => {\n  it(\"npm test exits 0 with a test asserting a fake GitExec receives no push when a synthetic test file has a collection error\", () => {\n    expect(true).toBe(false);\n  });\n});\n"}]}
```
