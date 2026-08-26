# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary this repo's vocabulary is defined in.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. `docs/adr/README.md`
  carries the format and the bar for writing one; new ones are created with
  `bin/new-adr "<the ruling as a sentence>"`.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── DESIGN.md
├── docs/adr/
│   ├── README.md
│   ├── 0000-template.md
│   └── 0001-github-is-the-spec-and-issue-tracker.md
└── ...
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids — the `_Avoid_` line on each entry is binding, not advisory. If a term there is wrong, change it there rather than working around it.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (the shaper routes every item), but worth reopening because…_

Never edit an old ADR to reflect a new decision. Write a new one that says what it amends; a
superseded ADR is named by a trailer its successor writes (ADR-0045).
