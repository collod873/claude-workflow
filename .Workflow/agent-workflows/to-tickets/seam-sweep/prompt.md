# Seam sweep

First of three stages turning a spec into tickets. Scope: this prompt, `CONTEXT.md`, and this codebase checkout.

## What to do

1. Read `CONTEXT.md` first. Use repository terms strictly as defined.
2. Read the spec: run `gh issue view {{ISSUE_NUMBER}} --json title,body --jq '.title + "\n\n" + .body'`.
3. Explore the codebase for shared primitives (types, helpers, conventions) that future tickets would otherwise hand-roll independently. N tickets touching separate files can still duplicate the same shape; this sweep surfaces those shared seams before ticket boundaries freeze.
4. For each shared shape, write a single-line seam manifest entry matching:
   `<primitive> — <location> — <consumers>`
   Keep each entry to one line; it is injected directly into ticket bodies.
5. If no primitives warrant sharing, return `[]`.

## Output

Emit only a raw `<output>` block containing a JSON array of string entries:

Example:

<output>["`GhExec` — an injected `(args: string[]) => string` executor around `gh` — shared/gh.ts — consumed by the publisher and test harness."]</output>
