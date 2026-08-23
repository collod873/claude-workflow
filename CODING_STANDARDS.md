# Coding standards

Judgements a linter cannot express. Each entry states the ruling, the red flag that spots a
violation, and why it exists.

An entry leaves this file by becoming *mechanised* — a rule in the lint config that reaches every
case its Red flag names, landed in the same commit that deletes the entry. That is currently the
only exit, which is why this file can only grow (GOAL.md §4.3); keep it short on purpose.

Entries are ratified from a `standards-pass` ledger. Vocabulary is `CONTEXT.md`'s.

---

**A test builds a schema-typed fixture through one exported builder, never a hand-rolled literal.**
The builder lives beside the zod schema it constructs and takes `Partial<T>` plus whichever field
the test is actually about.
*Red flag:* an object literal in a test that spells out every field of a schema exported from
`shared/`.
*Why:* a field added to `Slice` then breaks one place instead of eight, and a test that names seven
fields to exercise one hides which field it is about.
