# A lane that spends model fires only for the owner, because a public tracker lets anyone pull the trigger

Recorded 2026-08-27.

Every trigger in this repo was designed against a private tracker, where the only person who could
reach one was the owner. Making the repository public breaks that assumption without touching a
line of YAML: §00's issue form carries `labels: ["idea"]`, and GitHub applies a form's labels on the
author's behalf whatever the author's permissions, so a stranger filing an idea fires `shape.yml`
exactly as the owner does. An issue's author can also close their own issue, and GitHub marks that
close `completed`, which is the whole of `close-gate.yml`'s scope rule. Both lanes spend
`CLAUDE_CODE_OAUTH_TOKEN` — the owner's personal subscription, which has no per-repository cap and
no rate limit that a stranger would hit before the quota did.

So a lane that spends model now names who may fire it, and the check is on the event rather than on
a label anyone can cause to exist. `shape.yml` gates its label trigger on `github.event.sender` —
who performed the act, not who owns the thing acted on, which is one condition covering both the
form (the author is the sender, so a stranger is refused) and a hand-applied label afterwards (the
labeller is the sender, so the owner can still pull a stranger's idea into the lane deliberately).
Its comment trigger gates on `author_association` instead, that being the field `issue_comment`
carries, with `MEMBER` and `COLLABORATOR` riding along so the rule need not be reopened the day a
second person is added. `close-gate.yml` gates on the issue's *author* rather than the closer,
because the delivery units are `to-tickets.yml`'s sub-issues and this repo's own automation writes
those: a bot author is inside the scope, a third-party human is outside it.

## Consequences

**The gate's scope rule had to become two-sided.** `close-gate-reconcile.yml` exists to find
completed closes with no gate run and reopen them (ADR-0048), and it selected candidates on
`state_reason` alone. Teaching only the workflow to decline a stranger's close would have made every
such close read to the reconciler as a gate that never ran — so it would reopen it, and the stranger
could close it again, turning a quota leak into a reopen loop with a member of the public on the
other end. `gateJudgesCloseBy` is therefore stated once in `close-gate.ts` and read by both, with
`close-gate.test.ts` asserting the workflow file still agrees, the same shape as the `state_reason`
mirror it sits beside.

**It fails closed on its own ignorance.** Unknown authorship and an unset `GH_REPO` both refuse
rather than admit. The failure worth naming is that the two emptinesses meet: with the owner unknown
*and* the author unknown, a bare equality check reads `"" === ""` as a match and judges every close
in the tracker — the gate failing open at precisely the moment it has lost track of who anyone is.

**The public cannot drive the idea lane.** Anyone may still file an issue and it still lands
labelled; what it no longer does is spend model on arrival. Shaping a contributor's idea is now a
deliberate owner act — remove and re-add `idea`, the same re-run gesture `to-tickets.yml` documents
for `prd`. That is the intended trade: this repo is published to be read, not to be a service that
strangers can bill to the owner's subscription. Opening it up later is one condition per lane, and
would want a cost ceiling ruled first.

## Considered options

**Drop `labels: ["idea"]` from the form.** Rejected: it protects the quota by breaking §00's door
for the owner too, and ADR-0070 rules that door is distinguished by where the owner is — filing from
a phone is the case it exists for, and a label he must add by hand afterwards is a second touch in
the lane §01 budgets at two owner minutes.

**Leave the triggers open and cap the spend.** Rejected for now, not on principle: a per-run ceiling
is a real answer to a public lane, but there is no ceiling to enforce it against today, and shipping
the open trigger while the ceiling is unbuilt is the same bet as a gate that fails open.
