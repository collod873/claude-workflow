# There is no daily spend ceiling, and the governor stops on queue depth and WIP alone

Recorded 2026-08-26.

**The daily ceiling is none — no dollars, no tokens, no unit at all.** The governor (`DESIGN.md` §8)
enforces two hard limits at dispatch, not three: queue depth (~7 decisions waiting stops dispatch)
and WIP (a slot count per lane). The third limit, spend-checked-at-dispatch, is struck. Ruled by the
owner on 2026-08-25 in
[#79](https://github.com/collod873/claude-workflow/issues/79):

> "Im not sure cost is actually a concern at the moment. I think not worry about cost at all. If I
> start using the system and its burning costs i will notice."

## Why a ceiling was the wrong shape

The pipeline runs on the Claude subscription via `CLAUDE_CODE_OAUTH_TOKEN`, not on metered API
billing — ruled while the `to-tickets` runner was being designed, 2026-08-22: *"yeah claude
subscription runs it."* A dollars-per-day budget meters a cost structure this system does not have.

That also retires the only figure the design ever pointed at: **~$1,661 API-equivalent over 28
days**, from the Lumaria A/B
(`General-Repo/lumaria-shipping-model-vs-sandcastle-2026-08-21.md`). It is measured spend under a
different way of working, expressed in a unit that does not apply, and it was never a ceiling.

The real ceiling, if one ever binds, is the subscription's own rate limits — and those announce
themselves at the point of use rather than needing a counter. **Detection is the owner noticing.**

## The four sub-questions #79 asked, answered

- **The ceiling and its unit** — none, and no unit. There is no number to state because there is no
  budget.
- **One budget or a per-lane split** — neither. A split presupposes a total to divide.
- **The pause ordering at the ceiling** — struck along with the limit. `DESIGN.md` §8's *"pauses the
  commodity lane first, then everything but the lenses"* described the behaviour of a limit that no
  longer exists; there is no ordering to write down.
- **The governor's behaviour at the ceiling** — there is no ceiling to reach. The governor's only
  reasons to stop dispatching are queue depth and WIP.
- **The plan-tier question underneath it** (`§11 Q2` said it was one) — answered, not deferred: the
  plan tier is a Claude subscription, and the answer it gives is that spend is not metered per unit
  of work.

## Consequences

- `DESIGN.md` §8's third governor limit is **struck**, and `DESIGN.md` does not yet say so. Until the
  prune ([#75](https://github.com/collod873/claude-workflow/issues/75)) lands, this ADR is the
  current record.
- `DESIGN.md` §11 Q2 is answered and stops blocking move 9.
- `DESIGN.md` §12 ⚠#8 — *"the governor cannot be built without a spend number"* — is retired.
- [#84](https://github.com/collod873/claude-workflow/issues/84) is unblocked and **simplified**:
  lane 05's concurrency is sized against the owner's review rate alone, which §8 already named as
  the honest constraint (*"sized to one operator's review rate, not to available compute"*).

## What would reverse this

Cost becoming visible to the owner without a meter — the pipeline hitting subscription rate limits
often enough to stall work, or a lane moving to metered API billing. Either makes spend a real
dispatch input again, and either is a new ADR amending this one. Neither has happened.
