# A checkpoint resumes only on an exact match of its stage's resolved prompt and the run's commit, so every other re-run starts clean

Recorded 2026-08-27.

A key stamped into the file: a hash of the stage's fully-resolved prompt text — which already contains the issue body and the upstream stage's output — plus the commit SHA the run checked out. A stage resumes only on an exact match. Editing a prompt, pushing code, or editing the spec each change it, and so does invalidating an earlier stage, since that changes the next stage's input and therefore its key — staleness cannot leak downstream.

Decided on the decision sheet for #143, and filed by the `approved` label on it
([ADR-0005](0005-accepting-a-shaped-idea-is-what-files-its-adrs.md)).

## Considered options

- A time-to-live, an mtime comparison, or an explicit `--resume` flag. The first two answer 'is this recent', the third answers 'did he ask', and the requirement is 'did anything it was computed from change' — plus a flag is precisely the thing he would have to remember to set.

## Consequences

**`shared/stage.ts`'s prompt assembly — the key assumes the resolved prompt text exists in-process before the spawn** moves if this answer flips — that pointer is the assumption mark the sheet
carried, and it is why this decision was written down rather than left on the sheet
([ADR-0028](0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md)).
