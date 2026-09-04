# Coding Standards

Judgment calls tooling can't enforce. `/standards-pass` sweeps each landed batch against
each entry here; the implementer's brief inlines the entries below, so they govern the code as
it is written.

How this doc stays small:

- An entry is born only by **ratification**: a review finding that recurred, approved by the
  maintainer. A finding seen once is not a standard.
- Before ratifying, ask: **can a lint rule enforce this?** If yes, add the rule instead; no entry.
- When tooling later enforces an entry, **delete it** (reviews already skip tooling-enforced rules).
- Entry format, three lines max: **Name**: what. Why: … Red flag: …
- Flat list. Split by area only if this file passes ~100 lines.

## Standards

- **Test the public interface**: test through the module's public surface, never its internals.
  Why: tests wired to internals break on refactor and freeze the design in place.
  Red flag: a test importing a private helper or a server-internal module directly.
- **Deep modules**: a small interface hiding substantial implementation.
  Why: shallow wrappers add surface area without absorbing any complexity.
  Red flag: an interface as wide as the implementation behind it; a layer that mostly delegates.
- **Zero-grandfather rails**: a new lint rule ships with no excused sites; the refactor lands first or in the same ticket.
  Why: a rule that pre-excuses its violations teaches nothing; it misses the next copy the same way it missed the ones grandfathered in.
  Red flag: a grandfather list, baseline file, or warn tier added alongside a new rule; exception: a genuinely large refactor, recorded on the ledger line with count and reason, and that baseline only ratchets down, gating solely on new additions (`docs/agents/clone-gate.md` rule 5).
- **Exemptions say why, in place**: an exemption from a reachability or dead-code gate carries its reason as prose at the exempted export itself (knip's `@shell` / `@fixture` tags), never as a bare name in a config's ignore list.
  Why: a silent name in an ignore list is indistinguishable from the dead code the gate exists to find, so the gate quietly stops answering its own question.
  Red flag: a name added to an `ignore` / `ignoreUnresolved` array or a baseline file with no prose at the site it exempts.
- **Cite, don't restate**: the why behind a shared helper lives once, in the helper's docstring (or the ADR); a call site, test, or lint comment names the helper and at most the ticket or ADR number.
  Why: a rationale pasted at N sites is N edits when the reason changes, and the copies drift into telling different halves of the story.
  Red flag: a comment outside the helper's home that explains what the helper used to do, what the two copies used to disagree on, or why sharing fixed it; a cited ticket number should carry a naming clause and nothing more.
- **Fixtures through one builder**: a test builds a schema-typed fixture through one exported builder, never a hand-rolled literal; the builder lives beside the zod schema it constructs and takes `Partial<T>` plus whichever field the test is actually about.
  Why: a field added to `Slice` breaks one place instead of eight, and a test that names seven fields to exercise one hides which field it is about.
  Red flag: an object literal in a test that spells out every field of a schema exported from `shared/`.
- **One stage record, checked against the workflow**: a stage is declared in one exported `StageDef` record keyed by stage name, with the name tuple, the dispatch and the CLI branch derived from its keys; a test asserts those keys and `to-tickets.yml`'s `--stage` steps are the same set.
  Why: seam-sweep, slice and audit each cost four to five coordinated edits, no compiler sees across that language boundary, and the one edit nothing watched (the absent workflow step) makes a stage silently never run.
  Red flag: adding a stage edits anything beyond that record and one step in `.github/workflows/to-tickets.yml`, or edits the record without the step.
- **Pin a mandated copy to its source**: where a boundary forces a definition to be written twice, one test reads both texts and asserts they still say the same thing.
  Why: no compiler sees across that boundary, so the copies drift in silence and the copy goes on enforcing a rule its source has already dropped.
  Red flag: a constant, grammar or literal restated in a second file (a workflow's YAML, an acceptance test's own copy) that no "agrees with the … it is a copy of" test names.
- **Refuse rather than guess**: when a precondition for a correct answer is missing or the match is ambiguous, stop with an error naming what is absent and what would fix it, instead of taking a candidate or inheriting an ambient default.
  Why: a guessed answer is indistinguishable from a real one downstream, so the wrong run gets judged green and the wrong config gets tested, and the report reads as evidence either way.
  Red flag: a first-of-list pick where the list could hold more than one, or a fall-through to whatever the surrounding environment supplies when the thing itself was never found.
