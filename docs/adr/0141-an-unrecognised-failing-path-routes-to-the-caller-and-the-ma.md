---
status: constraint
date: 2026-09-02
amends: ADR-0135
reversal: Every ticket the sweep filed under the old default would have to be re-triaged by hand to find the caller-side ones among them, and the machine's own tracker would again be the destination a sweep reaches when it understands nothing — which is the state that put five of Lumaria's test failures on `to-build` and started ten implementer runs against them.
---

# An unrecognised failing path routes to the caller, and the machine checkout is matched positively against its own tree

ADR-0135 tested for the caller by a `target/` prefix, with the machine as the fallback. The prefix
is almost never printed: vitest and eslint name paths relative to the target's own cwd, so the
first path in a failing log is bare, the test misses, and *every* unrecognised failure routes here.
The first live sweep over Lumaria filed five of its own test failures as machine defects.

So the default inverts and the machine is proven, not assumed: a path is the machine's only if this
checkout tracks it. The sweep runs inside that checkout, so the tree is the list (ADR-0057).

The asymmetry settles it: a wrong caller ticket costs one issue its owner can close, a wrong
machine ticket a model run and a pull request here.

Runs of workflows the caller owns are skipped — only a `*-caller.yml` stub checks the machine out.
