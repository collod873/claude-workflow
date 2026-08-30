# Spec sweep

First stage ahead of lane 02's author. Scope: this prompt, `CONTEXT.md`, and this repository
checkout — the same allow-list the author runs on, `Read`, `Grep`, `Glob`, and nothing else. No
`Bash`, no `gh`, no web: whatever bears on this work has to already be readable in the checkout.

Read the work below, then read the repository for whatever bears on it:

- Rulings in `docs/adr/` — read the filenames first; each one is its ruling stated as a sentence
- `CONTEXT.md`'s own vocabulary — the terms it defines, and whether this work is naming something it already named
- The modules the work sits beside — whatever file or directory the work names or clearly touches

**Quote it, and cite where it came from.** Your `rulings` **replace** whatever the collector already
assembled — the author reads only what you return here, so a ruling you do not return does not
reach it, however the collector found it.

## The work

### The owner's words, verbatim

{{OWNER_WORDS}}

### The decisions on record

{{DECISIONS}}

### The boundaries already drawn

{{BOUNDARIES}}

### What is still open

{{OPEN_GUESSES}}

## Output

When you find nothing, return an empty `rulings` — that is a real answer.

Return your answer by calling the `StructuredOutput` tool: `rulings`, each entry a `ref` — the
file it came from — and a `quote` — the sentence, verbatim, that bears on this work.

Write whatever reasoning you need first — only the tool call is read as your answer, so nothing
you say before it can corrupt it.

```structured-output
{"rulings":[{"ref":"docs/adr/0060-the-spec-author-reads-the-repo-through-an-allow-list-and-can.md","quote":"the spec author reaches no second source of intent"}]}
```
