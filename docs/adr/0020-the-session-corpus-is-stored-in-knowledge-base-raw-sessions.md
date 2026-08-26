# The session corpus is stored in Knowledge-Base/raw/sessions/ as storage only, and the wiki stays retired

Recorded 2026-08-25.

Captured session spines are written to `Knowledge-Base/raw/sessions/YYYY-MM-DD-{session_id[:8]}.md`
in the existing format — YAML frontmatter plus `## User Prompts` / `## Files Touched` /
`## Key Commands` / `## Key Insights`. That directory is used as **storage and nothing else**: no
`/compile-wiki`, no `session-inject.py`, no `topic-match.py`, no wiki banners. Ruled in
[#36](https://github.com/collod873/claude-workflow/issues/36) §Solution 1 and §Out of scope, and
ratified by the owner on 2026-08-23.

## Why reuse a directory from a retired system

It already holds **841 captures from 2026-04-13 → 2026-05-21**, is git-tracked and pushed, and
holding exactly this was its whole purpose. A new location would fork the corpus and strip the
auditor of four months of history it can be tuned against on day one.

## Why the boundary is worth writing down

The wiki was not abandoned, it was killed for cause — Knowledge-Base commit `6c86bb8`, 2026-05-21:
*"System became more burden than help (per audit: top wiki reads were meta — KB reading itself to
maintain itself)."* Reusing its storage puts working capture files back under a tree whose compile
pipeline is still sitting there, one command away from looking like the obvious next step. Naming
the line here is what keeps *"we already have the captures, we may as well compile them"* from being
a reasonable-sounding suggestion six months from now.

This is the only one of #36's five rulings the spec itself does **not** mark load-bearing. It is
recorded because the reasoning is the load-bearing part: the file path is trivia, and *the wiki
stays retired* is not.
