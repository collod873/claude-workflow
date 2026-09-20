# Decision records

An ADR records a **constraint**: something later work is bound by.

**[`INDEX.md`](INDEX.md) is the corpus**: every ruling as one line, newest last. The title is the
ruling, so the index answers *what was decided* on its own. Open a body only for *why*. It is
maintained by hand: a new entry adds its own line in the same commit, and nothing regenerates it.
Take the number from a freshly fetched `origin/main`, not from your tree alone.

Nothing validates any of this. The bar an entry has to clear, the frontmatter shape, and the rules
for correcting, superseding and retiring one all live in the `domain-modeling` skill, at
[`ADR-FORMAT.md`](../../.claude/skills/domain-modeling/ADR-FORMAT.md). They live there rather than
here because the same rules apply in every repo this skill reaches.

Most of this corpus rules on eras that have since been replaced. A superseded entry keeps its
number and filename so its citations still resolve; nothing here is ever renamed or deleted.
