---
status: constraint
date: 2026-08-28
reversal: Reversing means collapsing each lane's model job and dispatch job back into one, which either grants `contents: write` to a job that runs a model — against ADR-0053 — or reinstates the 403 that silently dropped two lanes' hand-offs, and unwinds `shared/dispatch-request.ts` along with lane 04's format-patch replay.
---

# The token that spends a model and the token that starts the next lane are separate, so a lane needing both is two jobs

`POST /repos/{owner}/{repo}/dispatches` needs Contents **write**, and a `permissions:` block replaces the default token rather than adding to it. Lane 02 and lane 03 each declared `contents: read` — correctly, since each runs a model and ADR-0053 is careful about what such a job may write — and then 403'd on their closing dispatch. The fix is not a wider token: `permissions:` is per **job**, so a lane that spends a model *and* starts the next lane is two jobs. The model job keeps `contents: read`; a second job with no model in it carries out what the first decided.

**Accepted cost.** A decision must survive a job boundary. `shared/dispatch-request.ts` is that seam — post-now versus write to `DISPATCH_REQUESTS_PATH` is a fact about the venue, never the caller — and lane 04 carries commits over as a `git format-patch` series replayed with `git am`, which makes a multi-slice re-fire all-or-nothing.
