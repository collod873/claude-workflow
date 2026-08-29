# A lint rule that points at an import the boundary forbids does not apply inside that boundary

Recorded 2026-08-29.

Amends: ADR-0032

Three rulings, from one hour in which lane 04 landed a batch of acceptance tests that no venue in
this repository could accept:

1. `no-restricted-syntax`'s inline-`reason` selector is off inside `tests/acceptance/**`, and the
   rule is re-declared there carrying every other selector. A rule whose remedy is "import this
   helper" cannot bind a directory forbidden from importing it.
2. `acceptance/push-gate.ts` lints the files it is about to land and refuses the batch when they do
   not lint, before any git call.
3. `acceptance/author/prompt.md` states the import boundary, and no longer instructs the author to
   cross it.

## The unsatisfiable pair

`eslint.config.js` held two rules over `tests/acceptance/**`:

- `acceptance-boundary/no-outside-import` — a test may not import anything outside its own
  directory, because CI restores that directory from trunk's tip and restores nothing else. A
  helper reached across the boundary is the branch-under-test's copy, so an implementer could
  satisfy an acceptance test by editing the helper instead of building the ticket (ADR-0032).
- `no-restricted-syntax` — never narrow an unknown error inline; use `reason(err)` from
  `.Workflow/agent-workflows/shared/reason.ts`.

The second names a module on the far side of the first. An acceptance test that reports an unknown
error had to violate one of them, and there was no third option. The pair had stood since spec #145
without anyone hitting it, because no acceptance test had needed to catch anything.

`acceptance/author/prompt.md` then pointed the author straight into the corner: *"import the real
modules it names (in 'Files claimed'), call the real functions."* For #240 the claimed file was
`shared/validate-graph.ts`, so following the prompt as written produced exactly the import the
boundary rule refuses. The author was not careless; it did what it was told.

## Why the gate did not stop it

`push-gate.ts` exists to decide what may land on `main` unattended, and it graded one thing: the
test run. Its distinction is a good one — a collected test failing with an `AssertionError` is a
criterion waiting for its implementer, which is the point of the lane, while a test that never
collected proves nothing. #240's batch passed both. Every file collected. Every failure was an
honest `AssertionError`. It was pushed to `main`, and `eslint .` went red for the whole repository
— for a ticket nobody had started.

Lint is neither of the two shapes that gate knew about. A red test is a statement about the
*ticket*; a lint error is a statement about the *file*, and a file this repo refuses is not landable
in any state. The gate now asks both questions, in that order, still before it touches git.

Scoped to the paths being landed rather than the whole tree: this gate answers "may these files
land", and a standing finding elsewhere is not this batch's to be refused for.

## Removing the batch is not a breach of the immutable set

ADR-0032 makes a landed acceptance test immutable so that an implementer cannot weaken the test
instead of satisfying it. That protection presumes a test that validly landed. #240's three files
could not pass the repository's own linter, which is a condition the pushing gate was supposed to
check and did not. Deleting them and re-dispatching #240 restores the state that gate should have
produced; it takes nothing away from whoever implements the ticket, because the criteria are
unchanged and the lane re-authors them from the same spec.

The narrow rule: a batch that the landing gate would refuse today may be removed and re-authored.
Immutability attaches at a valid land, not at a `git push`.

## Amends

ADR-0032 said an acceptance test is immutable because CI runs trunk's copy. This adds what
"immutable" attaches to — a batch that cleared the landing gate — and closes the gap that let one
land without clearing it.
