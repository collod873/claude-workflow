# Accepting a shaped idea is what files its ADRs

Recorded 2026-08-23.

Lane 01 hands the owner a decision sheet: the idea restated as work, and each decision it would
make with a recommended answer and the alternatives it rejected. That is already an ADR's shape —
a ruling as a sentence, its considered options, and the reason. So nobody authors ADRs. The
decisions on an accepted sheet that pass the three-part bar in [README](README.md) are written as
ADRs at accept, before the spec, and the spec cites them rather than restating them.

## Considered options

- **Agents write ADRs directly, when confident.** Rejected against W5 as it stood, and unnecessary:
  the drafting is the expensive part and the signature is the cheap one.
- **The owner writes ADRs.** This is what `GOAL.md` claimed and it has never once happened — see
  [ADR-0006](0006-agents-draft-vocabulary-and-rulings-the-owner-signs-them.md).
- **ADRs written retrospectively, after the work.** Today's habit. Better informed, but the ruling
  arrives too late for the spec to cite it, so follow-up work re-decides it.

## Consequences

Rulings are now written before any work exists, so more of them will be contradicted by reality
than under the retrospective habit. That is handled rather than prevented: at work-merge the
implementer is asked whether anything it hit contradicted the ruling it was given, and **only a yes
drafts an amendment.** Silence writes nothing. This makes the amendment rate meaningful — across
the estate today about one ADR in three carries an amendment, and there is no way to tell whether
that is healthy. Under this rule an amendment means reality pushed back.
