# Checkpoints ride an always-uploaded artifact rather than the Actions cache, because the store has to stay readable by the owner

Recorded 2026-08-27.

One artifact per lane per issue — `checkpoints-<lane>-<issue>` — holding the whole checkpoint directory, uploaded `if: always()` and restored at the start of the next run for the same issue. It carries the rejected raw responses too, so the two `if: failure()` steps are deleted rather than kept alongside. Restore and upload are one composite action under `.github/actions/`, so each lane's YAML gains two lines and the third lane gets both halves by calling it.

Decided on the decision sheet for #143, and filed by the `approved` label on it
([ADR-0005](0005-accepting-a-shaped-idea-is-what-files-its-adrs.md)).

## Considered options

- `actions/cache`, which fits decision 1's key better and is still wrong here on two counts: it needs a restore and a save step per stage, so adding a stage would cost three workflow edits where `CODING_STANDARDS.md` allows one, and a cache is invisible to the owner — being able to read a failed run's work is the whole reason this idea exists.

## Consequences

**`CODING_STANDARDS.md`'s one-step-per-stage rule** moves if this answer flips — that pointer is the assumption mark the sheet
carried, and it is why this decision was written down rather than left on the sheet
([ADR-0028](0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md)).
