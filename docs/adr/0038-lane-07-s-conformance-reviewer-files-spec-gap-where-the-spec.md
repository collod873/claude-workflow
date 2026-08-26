# Lane 07's conformance reviewer files spec gap where the spec is silent rather than a review finding

Recorded 2026-08-26.

Lane 07 keeps **two** reviewers — correctness and conformance — and the conformance reviewer is
re-scoped. Its finding splits by which side is wrong:

- **The code diverges from a spec that was clear** → an ordinary lane 07 review finding on the PR,
  through the refusal and the refuter like any other.
- **The spec is silent or wrong about what the code does** → `spec/gap`, fired at lane 02's spec
  author, per [ADR-0034](0034-spec-gap-fires-the-spec-author-and-an-acceptance-test-an-imp.md).

The spec-first, diff-second ordering stands unchanged: an agent that reads the implementation first
will rationalise it.

## Why the reviewer needed re-scoping

Lane 07 fires on CI green, and lane 04's acceptance tests are **derived from the spec, immutable,
and running in that same CI**
([ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md)). So by the time
the conformance reviewer reads anything, every criterion the spec expressed as a test has already
been answered by a machine. What is left to it is precisely **the part of the spec no acceptance
test encodes** — which is not a smaller version of the same job, it is a different one, and it
already has a name and a route.

As drafted, §07 gave the conformance reviewer the whole spec. That makes it a second, chattier copy
of lane 04 over the tested half, and the duplicate findings land in the owner's queue with a
refuter fleet paid to remove them again.

## Considered options

- **Drop the conformance reviewer.** Rejected. The untested residue of a spec is real territory and
  nothing else reads it: lane 04 cannot test what the spec did not say, and the correctness reviewer
  hunts defects rather than intent.
- **Keep it as drafted, whole-spec.** Rejected — it re-answers what lane 04 already answered
  deterministically, which ADR-0036 refuses on principle one step later in the same lane.
- **Re-scope and route by which side is wrong.** Chosen. It also closes a gap ADR-0034 left open:
  `spec/gap` was given a handler and a route, but the only thing named as *firing* it was lane 04.
  A spec that is silent produces no failing acceptance test, so lane 04 could never have been the
  detector for the silent case.

## Consequences

Two reviewers is confirmed rather than changed, and the count remains **1 Opus each per PR** — the
conformance reviewer's input narrows but its judgement does not get easier, so this does not buy a
cheaper model.

A `spec/gap` from this route reaches lane 02's spec author, and ADR-0034's ruling holds there
unchanged: the spec wins by construction, and an in-flight implementer needs no new machinery
because a spec edit re-fires acceptance for every slice whose test names the changed criterion
([ADR-0033](0033-a-spec-edit-re-fires-acceptance-for-every-slice-whose-test-n.md)).
