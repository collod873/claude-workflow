---
status: superseded
date: 2026-09-02
superseded_by: ADR-0149
amends: ADR-0144
reversal: Reversing it means a machine change can again be proven only after it lands on `main`, because every stub pins `@main` and every lane checks the machine out at its default branch — the shape of 2026-09-02, when nine defects of one class were each found on a hosted runner ten to forty-five minutes after landing and fixed in ninety seconds.
---

# A machine change is proven on a canary target before it lands, and the caller names the machine ref and runner it pins

ADR-0144's local dry run catches what `bin/gauntlet` can see, not what only GitHub decides — a
`timeout-minutes` kill reporting `cancelled`, `gh api -f` becoming a POST. Those were found one
runner cycle at a time, after landing, because no lane could run at any ref but `main`.

So a change runs first on a **canary**: a private target whose stubs pin the change's branch, on
a self-hosted runner here (`bin/canary prove`). Two inputs on every reusable workflow make that
possible: `runner`, default `ubuntu-latest`, and `machine_ref`, default `main`, stated by the
caller beside its `uses:` because a called workflow cannot learn its own ref — inside it
`github.workflow_ref` is the *caller's* (run 33706922620).

**Rejected:** deriving the ref inside the lane. An empty `ref` silently takes the default branch;
run 33706756013 passed that way. A green that does not print the machine SHA against the branch
head is not a green.
