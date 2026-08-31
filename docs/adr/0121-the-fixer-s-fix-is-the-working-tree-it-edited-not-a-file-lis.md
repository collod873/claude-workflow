# The fixer's fix is the working tree it edited, not a file list in its answer

Recorded 2026-08-31.

The fixer stage edits its checkout and runs the suite against those edits — and then, until now, its
answer had to carry every touched file back again with its complete final content, so that the lane
could write it to the same paths. It now answers with a summary alone, and `changedPaths` reads what
moved off `git status --porcelain`.

The retyping was an output cost that scaled with the *number* of files touched and not at all with
the size of the edits, which makes "one line in ten files" its worst case and also an ordinary one.
Two consecutive runs on PR #280 died there ([#283](https://github.com/collod873/claude-workflow/issues/283)):
12 files, ~231 KB of verbatim TypeScript in a single response, at the model's per-response output
ceiling, with the fix already on disk and green. Both looked like a hang rather than a cost, because
`--output-format stream-json` prints one event per completed message and that message never
completed.

## Consequences

An attempt that changes nothing is now representable, where `files: […].min(1)` had made it a schema
violation. It is committed as nothing rather than as an empty commit — `priorAttempts` counts
`fix: attempt N` commits against the ticket's ceiling, and a round that produced no diff has not
spent one. The loop's own no-progress comparison is what stops it.

The stage's leavings are now the lane's problem, because whatever is in the tree gets committed.
`.gitignore` covers what the suite it runs drops there; the prompt is what asks it not to add more.

`implement.ts` still answers with files, and this ruling deliberately does not reach it. The same
cost is latent there — a large slice is a large answer — but lane 05 has never been observed paying
it, and one lane's demonstrated failure is not a licence to rewrite the answer contract of another
on a guess. When it does, this is the shape to reach for.
