# Author acceptance tests

Issue #{{ISSUE_NUMBER}} — "{{ISSUE_TITLE}}" — is not implemented yet. Your job is to write a
failing test for **each** of its {{CRITERIA_COUNT}} acceptance criteria, from the spec below and
nothing else. You are not implementing the ticket, and you are not checking whether it is already
done — it isn't.

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

## The criteria, as the checker will look for them

Each block below is one criterion, exactly as it will be searched for. Copy from here — never
retype from the ticket body, and never re-wrap, re-punctuate or trim what you copy. A criterion's
trailing `— check: ...` marker, where it has one, is part of the string.

{{CRITERIA}}

## What to write

One test file per criterion under `{{TEST_DIR}}` is the common shape, but write however many files
it actually takes to cover all {{CRITERIA_COUNT}} — never fewer than one test per criterion, and
never a test that doesn't name one.

For each criterion:

1. **Put the criterion's whole block, verbatim, in a comment on its own lines directly above the
   test.** Copy it from the list above, unabbreviated, trailing `check:` marker and all. This is
   how the criterion is found: `shared/affected-tests.ts` greps test source for that exact string,
   and a test naming none is invisible to the run that is supposed to prove it. The `it(...)` name
   may shorten the criterion to read well; the comment may not. Put it in a comment rather than
   only in the name because a marker's own command often names paths a test name has no business
   carrying.
2. Write the test as if the ticket were already implemented: reach the real modules the ticket
   claims (rendered below), exercise the real functions, assert the real behavior it describes.
   Do **not** import anything that doesn't exist yet purely to avoid a red test, and do not stub
   out the subject under test — a test that mocks away the very thing #{{ISSUE_NUMBER}} is
   supposed to build proves nothing once that thing exists. **Reach it without importing it** — see
   the sealed directory below.
3. Expect it to fail. It should fail because the subject isn't built — an assertion that doesn't
   hold yet — not because the test itself is broken. A test that throws while importing, has a
   syntax error, or references something that will never exist even after the ticket lands is a bug
   in the test, not evidence about the ticket, and a gate downstream refuses your whole batch on it
   rather than just the one criterion it names.

## Your directory is sealed

**Nothing you write may import a relative path outside `{{TEST_DIR}}`.** Not the subject under
test, not a helper, not a type — no `../` specifier that climbs out of that directory. This is a
lint rule (`acceptance-boundary/no-outside-import`) and it fails the whole batch, so a single
`import { thing } from "../../.Workflow/..."` costs every criterion in this run, not just the one
file.

The reason is what makes acceptance tests worth anything: CI restores `{{TEST_DIR}}` from trunk's
tip before running it, and restores *only* that directory. A helper you imported from elsewhere is
whatever the branch under test says it is, so an implementer could satisfy your test by editing the
helper instead of building the ticket. Your directory is the sealed part; anything reached through
an import is not.

So reach the subject the way a shell would, not the way a module would:

- **Run a command and read what it did** — `execFileSync` a CLI, a `bin/` script, `npx vitest run
  <the subject's own test file>`, `npx tsx -e '<a few lines that import the subject and print>'`.
  A child process resolves imports at runtime, which is not an import in your file.
- **Read the file and assert on its text or its parsed form** — for a rule that is stated in a
  config, a workflow YAML, a prompt, an ADR. Never a file in the **immutable set** — see below.
- **Bare package specifiers are fine** (`vitest`, `node:fs`, `node:child_process`, `yaml`) — those
  come from `package-lock.json`, which the restore already covers. It is only relative paths that
  climb out.

## Never assert on the immutable set

The **immutable set** is `vitest.config.ts` and everything under `.github/`: the files no pull
request may change. An assertion about their contents returns the same verdict before the ticket is
built and after it merges, so no implementation can ever move it — and a red acceptance test has
exactly one meaning downstream, *the implementation is wrong*, which fires the repair loop against
an implementer who is not wrong and a demand nothing can meet. Assert the behaviour such a file
configures instead. A gate downstream refuses your whole batch for this.

It reads your **code**, not your comments, so a criterion whose `check:` marker names a workflow
file is safe to quote verbatim — which is why rule 1 puts it in a comment.

## A reader more than one of your files needs goes in a `.fixture.ts`

You are writing every one of these files in a single answer, so a helper you copy into three of
them is three copies you wrote knowingly — and copies diverge: the last run of this lane wrote one
YAML block reader three times with three different bugs, two of which are what made the landed
tests wrong.

Nothing downstream will catch it. The lint pass reads one file at a time and cannot see a copy in
the next one; the clone checker can, but because nobody outside this lane may ever edit
`{{TEST_DIR}}`, a clone found entirely inside it is recorded in the clone baseline and pushed
anyway. Nobody is told. What it costs is the baseline: it grows on every run of this lane that
duplicates, and measures this directory a little less each time.

So put the reader in one `{{TEST_DIR}}<name>.fixture.ts` and import it from each test that needs
it. That path is allowed, it is not collected as a suite, and it is inside the sealed directory —
though bound by the same rule, so it may not import outward either. Factor out what two or more of
your files need, and nothing else: a `.fixture.ts` no test of yours imports is dead code, one
holding a reader a single test uses is indirection for its own sake, and a fixture is never a
criterion's test — every criterion still needs its own.

Check the shared helpers shown below first. A reader you need may already be there, and importing
it beats writing your own copy; if what you need is close but not identical, prefer widening your
call over restating the reader.

## Two more things the linter does in your directory

No hand-written `repos/{owner}/{repo}/...` REST paths, as a template literal or as a regex.

Narrowing an unknown error inline — `err instanceof Error ? err.message : String(err)` — is banned
everywhere else in this repo and allowed in your directory, precisely because the helper it would
otherwise point you at is on the far side of the boundary above.

## The failure that looks honest

A test that can pass **before** #{{ISSUE_NUMBER}} is implemented — an assertion so loose it's
vacuous, or a mock standing in for the real subject — proves nothing when it lands and proves
nothing again once the ticket is done. It never turns red, then never turns green either.

Its mirror image is worse, because it looks like rigour: a test **no implementation could pass**.
It fails with a clean assertion error on the branch that builds the ticket, and the repair loop
re-fires the implementer against a demand nothing can meet. Two shapes cause it. One is an
assertion on the immutable set, above. The other is an assertion that pins down something the
ticket left open — where the ticket does not say a path's root, a name, an order, assert what the
criterion actually claims and leave the rest alone, because the implementer is reading the same
sentence you are and cannot ask you what you decided.

Being wrong about the **form** of a file shown to you above does the same damage by accident:
parsing a key that is quoted as if it were bare, expecting a list in block form when it is written
inline, demanding a string appear in a job that structurally cannot contain it. That is red for a
reason that has nothing to do with the ticket, and it stays red after the ticket is built. Check
each assertion against the text you were given before you write it.

## The ticket

{{ISSUE_BODY}}

## Its parent PRD, for context on the larger feature this ticket is one slice of

{{PRD_BODY}}

## The files this ticket claims, as they stand today

{{CLAIMED_FILES}}

## The shared helpers already living under `{{TEST_DIR}}`

These are the non-test files beside the acceptance tests — readers that earlier runs of this lane
factored out of their own test files.

{{SHARED_FILES}}

## Before you answer

Go back through the numbered criteria list and name, for each number, the file that covers it.
Every number has a file, or you are not done. Nothing downstream checks this: a criterion you
silently dropped is a hole nobody sees until the ticket that was supposed to close it turns out not
to have.

## Output

Return your answer by calling the `StructuredOutput` tool. Its one key, `files`, is an array of
`{"path": "...", "content": "..."}` — `path` under `{{TEST_DIR}}`, `content` the complete file.

Write whatever reasoning you need first — only the tool call is read as your answer.

Example, for a criterion whose block reads ``npm test exits 0 with a test asserting a fake GitExec
receives no push when a synthetic test file has a collection error — check: `npm test` ``:

```structured-output
{"files": [{"path": "tests/acceptance/162-collect-and-classify.test.ts", "content": "import { describe, it, expect } from \"vitest\";\n\ndescribe(\"push-gate\", () => {\n  // - [ ] npm test exits 0 with a test asserting a fake GitExec receives no push when a synthetic test file has a collection error — check: `npm test`\n  it(\"npm test exits 0 when a synthetic test file has a collection error\", () => {\n    expect(true).toBe(false);\n  });\n});\n"}]}
```
