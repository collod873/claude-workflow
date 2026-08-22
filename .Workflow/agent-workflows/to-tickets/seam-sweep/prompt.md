# Seam sweep

You are the first of three stages that turn a spec into tickets, running with no memory of anything
before you. Everything you need is either in this prompt, in `CONTEXT.md` and `CLAUDE.md` at the
root of this checkout, or in this checkout itself, which is already on disk at your current working
directory.

## What to do

1. Read `CONTEXT.md` first, for this repository's vocabulary. Use its terms as they're defined there;
   never re-coin your own.
2. Read the spec: run `gh issue view {{ISSUE_NUMBER}} --json title,body --jq '.title + "\n\n" + .body'`
   to get its full text.
3. Explore this codebase for what the spec's eventual tickets will need to share: a helper, a type, a
   convention, a file more than one future ticket would otherwise hand-roll its own copy of. This is
   the seam sweep, and it exists because the rule that keeps tickets from touching the same file does
   nothing about tickets that need the same *shape* — N tickets sharing no file can still each
   reinvent the same helper, and that collision is invisible until it's already rework.
4. For each shared shape you find, write one seam manifest entry naming: what it is, where it lives
   (or, if it doesn't exist yet, where it should live), and what will consume it. Hold every entry to
   a single line — it will be injected into the body of every ticket that consumes it, so a line
   costing more context than the steer it buys has defeated its own purpose. Never put a newline
   inside an entry.
5. If you find nothing worth sharing, return an empty list. That is a complete, useful answer, not a
   failure to look hard enough.

## Output

End your response with exactly one `<output>` block, and nothing after it: a JSON array of strings,
one per seam manifest entry (or `[]` if you found none). No code fence, no other JSON, no prose
inside the block.

Example, for a spec whose tickets will all need the same GitHub command executor:

<output>["`GhExec` — an injected `(args: string[]) => string` executor around `gh` — shared/gh.ts — consumed by the publisher and every test that stands in for GitHub."]</output>
