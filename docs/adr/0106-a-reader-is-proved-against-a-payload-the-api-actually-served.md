---
status: constraint
date: 2026-08-29
reversal: Retracting it would leave every API-boundary reader witnessed only by fakes its own author wrote — the recorded `closing-prs.fixtures/` payloads and the tests replaying them through the reader's own `--jq` string would go — and the defect class that silently voided the whole of PRD #233 (a check that runs green while structurally unable to succeed) becomes undetectable again in lane 09 and in every future reader of someone else's API.
---

# A reader is proved against a payload the API actually served, never against a fake that agrees with it

Where a reader depends on a field existing in an API response, the test that proves it replays a payload recorded from the live API, committed beside the test. A fake may stand in for everything else an endpoint does, but never as the only witness that a field exists.

A fake restates its author's belief, written in the same hour from the same misreading, so it cannot disagree with him. Lane 09's delivery check read a `state` GitHub does not serve, could never return true, and cost a whole PRD while its unit tests stayed green.

**Rejected:** asserting the field list against the live API in CI — network in a unit suite, red on an outage nobody here can fix. A stricter schema — "could not read" and "no" still share one return value.

**Accepted cost.** Recorded payloads go stale; re-record when a reader changes what it asks.
