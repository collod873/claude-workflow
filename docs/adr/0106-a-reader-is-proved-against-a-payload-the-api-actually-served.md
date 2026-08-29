# A reader is proved against a payload the API actually served, never against a fake that agrees with it

Recorded 2026-08-29.

Where a reader depends on a field being present in an API response, the test that proves it reads a
payload recorded from the live API, committed beside the test. A hand-written fake may stand in for
everything else the endpoint does; it may not be the only witness that a field exists.

## Why this came up

Lane 09's delivery check asked GitHub whether a merged pull request closed an issue:

```
gh issue view <n> --json closedByPullRequestsReferences --jq '[.closedByPullRequestsReferences[].state]'
```

That field has no `state`. GitHub serves `id`, `number`, `repository` and `url`. So the jq returned
`[null]`, the `z.array(z.string())` schema refused it, the `catch` returned `false`, and
**`closedByMergedPr` could not return `true` for any input**. Every ticket that shipped read as
closed-without-delivering, and every slice behind it read as permanently unreachable.

It cost the whole of PRD #233. #237 was built, merged as PR #244 and closed completed; the
reconciler ran four minutes later and filed its five remaining slices — #238 through #242 — as
unreachable (#245), which is a state whose own instructions are "re-slice it, re-open the blocker
and deliver it, or cut the edge". The pipeline had stopped, and it looked from the outside like a
graph problem rather than a reader that always says no.

The unit tests passed throughout. They passed *because* the fake in `reconcile.test.ts` answered
that call with `["MERGED"]` — the shape the reader hoped for, written by the same author, in the
same hour, from the same misreading. A fake is a restatement of the developer's belief about an API.
Pointing a test at one and calling the result evidence is circular, and it is circular in the exact
place it matters most: the boundary where this repo's beliefs meet someone else's system.

This is the third defect of one family in as many days. `filesThatChange` compared an implementer's
answer to the tree the implementer had just written, so it could only ever say "nothing changed"
(ADR-0103). `verify.yml`'s acceptance job checked out trunk instead of the pull request, so it
answered a question about the wrong tree (ADR-0104). Each was a check that ran, went green, and was
structurally incapable of its own purpose. Each had tests.

## The rule

Two calls now, and each asks an endpoint for a field that endpoint serves: the closing pull
request's **number** from the issue, its **state** from the pull request.

The guard is `closing-prs.fixtures/` — the literal bytes of `gh issue view 237 --json
closedByPullRequestsReferences` and `gh pr view 244 --json state`, captured the day this was found.
The test replays them through the reader's *own* `--jq` string, so restoring `.state` reproduces the
`[null]` that started this, and one assertion says the quiet part directly: the recorded node has a
`number` and has no `state`.

## Considered options

**Assert the field list against the live API in CI.** The strongest version, and it stays true as
GitHub changes. Rejected: it needs the network in a unit suite, it fails on someone else's outage,
and a check that goes red for reasons the author cannot fix is a check that gets skipped.

**A schema strict enough to reject the response.** `z.array(z.string())` already did reject it — and
the `catch` turned that refusal into `false`, which is the answer the caller was waiting for. Any
schema has the same problem while "I could not read the answer" and "the answer is no" share a
return value. Worth fixing where the cost justifies it; it is not what this ADR is about.

**Nothing — write more careful fakes.** This is what was already being done, by an author who had
read the docs. The failure mode is not carelessness, it is that a fake cannot disagree with its
author.

## Consequences

A recorded payload goes stale, and a stale one that still parses will vouch for a field GitHub has
since removed. That is a real cost and it is the smaller one: a stale fixture fails loudly the next
time the shape changes underneath it, whereas a fake never fails at all. Re-record when a reader
changes what it asks for.

This applies where a **field's existence** is the thing in question. Fakes remain the right tool for
sequencing, pagination, failure injection and everything else an endpoint does — the fake in
`reconcile.test.ts` still answers nine other calls and should.
