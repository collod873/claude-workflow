# Branch protection is declined, so move 10 retires and its counter goes quiet

Recorded 2026-08-26.

Amends: ADR-0063

Branch protection is not being bought — not now, and not at a higher bypass count. Move 10 is
retired rather than deferred, and the bypass counter, whose only proposal was to bring move 10
forward, stops proposing: a carrier issue closed as *not planned* silences it at any count.

The count itself survives. It is still computed on every `verify.yml` completion and still written
to the workflow's log, because the measurement is the one thing that could ever reopen the ruling —
it just stops arriving as an issue in someone's inbox.

## Considered options

- **Delete the counter.** ADR-0064's admission audit says a counter with nothing left to file is
  deleted, and after this ruling that is arguably its state. Rejected: the count is real evidence
  about a real gap, cheap to keep, and deleting it would also delete the only thing that would
  argue for reversing this. Silence is the requirement, not amnesia.
- **Leave the existing "re-proposes once the count has grown" rule alone.** Rejected because it is
  the wrong shape for a settled question. Growth reopens a *deferral*; here the proposal itself was
  ruled on, and re-asking on growth is the nagging the count marker existed to prevent, one notch
  further out.
- **Special-case this one issue number.** Rejected: a rule that reads GitHub's own close reason
  works for every counter this repo will ever ship, and ADR-0037 already reads `not_planned` as
  "a false alarm the owner declined to act on". This applies that vocabulary where it had not been.

## Consequences

Several decisions were recorded on the assumption that move 10 was scheduled, and they are now
resting on scaffolding with no expiry. None of them becomes wrong; each loses a planned successor,
and a reader should know that:

- [ADR-0051](0051-the-accept-commits-its-rulings-straight-to-main-because-a-pu.md) calls the accept's
  direct-to-`main` commit "scaffolding with a known expiry, and the expiry is already scheduled".
  The expiry is now unscheduled. It is permanent scaffolding.
- [ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md) enforces
  acceptance-test immutability by having the actor read the check rather than by protection, and
  says protection "later closes the" gap. It does not.
- [ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md) blocks protection on the
  fixer existing. That blocker no longer has anything behind it.
- [ADR-0053](0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md) treats a
  repository secret readable by any workflow as the accepted cost of not making the same purchase.
  That cost is now permanent rather than transitional.

The practical exposure is unchanged from today: `verify.yml` runs and refuses nothing, and the free
venues (in-turn, turn-end, pre-push) are the whole gate. Four red trees have reached `main` that
way. That is the number this ruling accepts.
