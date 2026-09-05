---
status: constraint
date: 2026-09-05
reversal: Every vendored copy would be stripped to pass the gate, its source's own drift check would report it foreign forever, and an upstream fix would never reach here unedited.
---

# A vendored copy is pinned to its source by digest, and the prose gate does not read it

`.claude/hooks/lib/_hook.mjs` and `_hook.sh` are agent-skills' run-row writers, carried here so a
hook on a runner has them. Upstream writes its why in comments, and ADR-0151 refuses comments
here, so a copy cannot satisfy both: #382 landed a prose-free rewrite that passed the gate and
failed its own byte-match, and a test pinned to `~/.agents/skills` could only ever judge that on
one workstation.

So a vendored file is named in `shared/vendored.fixture.ts` with its source commit and sha256.
The prose gate skips exactly those paths, and `_hook.test.ts` holds each to its digest on every
venue, no home directory involved. Updating the copy means updating the pin in the same commit.

**Rejected: strip the copy to fit the gate.** Its fidelity check becomes a permanent lie, and
every upstream fix is a hand port.
