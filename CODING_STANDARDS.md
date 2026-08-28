# Coding Standards

Judgment calls tooling can't enforce. `/standards-pass` sweeps each landed batch against
each entry here; implementation agents read this before writing code.

How this doc stays small:

- An entry is born only by **ratification** — a review finding that recurred, approved by the
  maintainer. A finding seen once is not a standard.
- Before ratifying, ask: **can a lint rule enforce this?** If yes, add the rule instead — no entry.
- When tooling later enforces an entry, **delete it** (reviews already skip tooling-enforced rules).
- Entry format, three lines max: **Name** — what. Why: … Red flag: …
- Flat list. Split by area only if this file passes ~100 lines.

## Standards

- **Test the public interface** — test through the module's public surface, never its internals.
  Why: tests wired to internals break on refactor and freeze the design in place.
  Red flag: a test importing a private helper or a server-internal module directly.
- **Deep modules** — a small interface hiding substantial implementation.
  Why: shallow wrappers add surface area without absorbing any complexity.
  Red flag: an interface as wide as the implementation behind it; a layer that mostly delegates.
- **Zero-grandfather rails** — a new lint rule ships with no excused sites; the refactor lands first or in the same ticket.
  Why: a rule that pre-excuses its violations teaches nothing — it misses the next copy the same way it missed the ones grandfathered in.
  Red flag: a grandfather list, baseline file, or warn tier added alongside a new rule; exception: a genuinely large refactor, recorded on the ledger line with count and reason.
- **Cite, don't restate** — the why behind a shared helper lives once, in the helper's docstring (or the ADR); a call site, test, or lint comment names the helper and at most the ticket or ADR number.
  Why: a rationale pasted at N sites is N edits when the reason changes, and the copies drift into telling different halves of the story.
  Red flag: a comment outside the helper's home that explains what the helper used to do, what the two copies used to disagree on, or why sharing fixed it — a cited ticket number should carry a naming clause and nothing more.
**A test builds a schema-typed fixture through one exported builder, never a hand-rolled literal.**
The builder lives beside the zod schema it constructs and takes `Partial<T>` plus whichever field
the test is actually about.
*Red flag:* an object literal in a test that spells out every field of a schema exported from
`shared/`.
*Why:* a field added to `Slice` then breaks one place instead of eight, and a test that names seven
fields to exercise one hides which field it is about.

---

**A stage is declared in one place, and the workflow is checked against it.** One `StageDef` in one
exported record keyed by stage name; the name tuple, the dispatch and the CLI branch derive from
that record's keys, not maintained alongside it. A test asserts the record's keys and
`to-tickets.yml`'s `--stage` steps are the same set — no compiler sees across that language
boundary, so a test does.
*Red flag:* adding a stage edits anything beyond (a) that record and (b) one step in
`.github/workflows/to-tickets.yml` — or edits (a) without (b).
*Why:* seam-sweep, slice and audit each cost four to five coordinated edits, and the one edit
nothing watched — the absent workflow step — makes a stage silently never run.
