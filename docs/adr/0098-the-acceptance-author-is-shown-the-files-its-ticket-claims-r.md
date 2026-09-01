---
status: constraint
date: 2026-08-29
amends: ADR-0030
reversal: Reversing means removing the file-rendering step from lane 04's prompt assembly and either blinding the author again — which produced two wrong tests out of four on the lane's only production run, permanently red on trunk and unfixable by implementers under ADR-0032 — or granting it a read tool, which re-opens ADR-0030's no-toolbelt boundary.
---

# The acceptance author is shown the files its ticket claims, rendered into its prompt rather than reached through a tool

Lane 04's author is given the contents of every path under its ticket's `## Files claimed`, inlined into the prompt; it still has no toolbelt. "From the spec alone" governs what the test *asserts*, not whether the author may know the *form* of the file it asserts about.

Lane 04's first production run wrote four tests; two were wrong about a file's shape — a blind author can only imagine a file it cannot see. The cost lands on trunk: `tests/acceptance/` is immutable to implementers, so such a test never turns green and reddens `npm test`.

**Rejected:** `--allowedTools Read` as ADR-0030 gave lane 02, which grants the whole checkout and leaves the bound as a sentence in a prompt; capping the files, since a half-seen file is what this removes.

**Accepted cost.** The author can now read work already done and write a vacuously green test; nothing detects that.
