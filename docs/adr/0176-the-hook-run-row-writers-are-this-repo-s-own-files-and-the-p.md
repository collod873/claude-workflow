---
status: constraint
date: 2026-09-09
amends: ADR-0160
reversal: Re-vendoring means re-introducing a digest pin and a `vendored.fixture.ts`, and the prose gate would need a carve-out again the moment upstream's comments came back with it.
---

# The hook run-row writers are this repo's own files, and the prose gate reads them like everything else

`.claude/hooks/lib/_hook.mjs` and `_hook.sh` are not a copy of anything: since the hooks moved
into `claude-workflow`, they are this repo's own run-row writers, authored and maintained here
directly. There is no upstream to drift from, no digest to pin, and no `shared/vendored.fixture.ts`
naming a source commit and a sha256; `_hook.test.ts` exercises them as ordinary code.

ADR-0151's prose gate reads both files exactly as it reads any other: no exemption, no skipped
path. A comment landing in either is a finding like a comment anywhere else, and the fix is the
same one every other file gets — put the why in the commit message, never in the code.

**Rejected: keeping the digest-pin machinery in case the files diverge again.** A pin with
nothing upstream to diverge from is dead weight the gate would still have to carry.
