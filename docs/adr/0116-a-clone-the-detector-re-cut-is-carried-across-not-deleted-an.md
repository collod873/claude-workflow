# A clone the detector re-cut is carried across, not deleted and refused

Recorded 2026-08-31.

A baseline entry fingerprints the *text* jscpd reported, and that text is not the clone. jscpd
reports a span of source between two matched tokens and hands back everything inside it — comments
included, which its default mode never required to match. So rewording a comment in the middle of a
baselined clone changes its fingerprint while changing nothing about the duplication, and so does
landing the same line in both files beside it, which grows the matched run through it. The gate then
called the same debt paid off *and* newly introduced at once, and `--prune-baseline` could only
delete, so a clone the repo had agreed to tolerate became a tree nothing could land — escapable only
by refactoring in the middle of an unrelated change. That is #282, met live on #274.

The gate now recognises a **re-cut**: the same code, in the same files, over a different span. It is
carried — one entry substituted for one, the count never rising — rather than deleted and then
refused. Sameness is decided by the detector's own tokens (`@jscpd/core`'s `weak` handler over
`@jscpd/tokenizer`'s `tokenize`, so the rule cannot drift from the detector it describes) run over
the fragment each entry now stores, fenced by the file set the entry already named and by a growth
smaller than the shortest clone this gate will report. Amends nothing; rule 5 of
`docs/agents/clone-gate.md` keeps its ratchet, and gains a door for the one case where the
fingerprint moved on its own.

## Considered options

**Fingerprint the normalised tokens instead of the raw fragment.** This is the fix that removes the
problem at the source, and it was rejected for what it costs everywhere else: over this repo's own
baseline it collapses 107 entries into 104, because three pairs of tolerated clones differ only in
their comments. A hash that no longer distinguishes them is a ratchet that admits a clone in files
it never named. Deciding sameness only *inside* an entry's own file pair keeps the loosening where
it is checkable.

**Refuse, and make the implementer deduplicate.** This is what happened, and it is the outcome the
gate wants — but demanded at the worst possible moment, from whoever happened to edit a comment
nearby, in a change that claimed neither file. A gate that can only be satisfied by unrelated work
is a gate people route around.
