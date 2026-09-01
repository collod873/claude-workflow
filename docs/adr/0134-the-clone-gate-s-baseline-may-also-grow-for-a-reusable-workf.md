---
status: constraint
date: 2026-09-01
reversal: Every reusable-workflow lane already baselined under this door (starting with #312's `lost-dispatch-counter.yml`/`missing-trailer-counter.yml` pair) would need its baseline entry deleted and the clone-gate push it landed under re-litigated, and #225 Part 1's remaining ~20 lane conversions would have no way past the gate at all short of a real technical dedup nobody has found.
---

# The clone gate's baseline may also grow for a reusable-workflow lane's machine-and-target checkout pair

`docs/agents/clone-gate.md` rule 5 permits one baseline growth: a clone whose every location sits
in the acceptance lane's immutable set. #312 hit a second case rule 5 did not anticipate: every
reusable workflow #225 Part 1 converts (ADR-0055/ADR-0132) needs the same two
`actions/checkout@v4` steps — machine, then target — and GitHub Actions cannot share them: a
composite action's `uses: ./...` only resolves once something is already checked out, so it can
never perform the first checkout. No standing lane repairs this as the acceptance lane's own push
does, so each entry is written by hand, in the ticket introducing it.

**The door.** A finding may be hand-added to `clone-gate.baseline.json` when every location is
inside `.github/workflows/` and the span is the checkout-pair steps (`Checkout machine` /
`Checkout target`) a #225 Part 1 conversion introduces — nothing wider.
