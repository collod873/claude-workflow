# What a lane 05 run built is a question only git can answer, so the no-op check asks git and the run keeps a copy of its implementer's answer

Recorded 2026-08-29.

Amends: ADR-0042

Two rulings, from one run that built a ticket correctly and threw the result away:

1. Whether a lane 05 run built anything is decided by `git status --porcelain` over the paths the
   implementer reported, asked **after** the write — never by comparing the implementer's answer
   against the filesystem.
2. A run writes its implementer's answer to `IMPLEMENT_ANSWER_PATH` the moment it has one, before
   anything is decided about it, and `implement.yml` uploads that file with `if: always()`.

## The run

Run 33275876786 built #237. It worked for 23 minutes over 115 turns for $6.36: moved the reconciler
off GraphQL to REST, folded `reconcileSpecClosing` into `runReconcile`, fixed the fake's handlers,
ran typecheck and lint and the full suite, and confirmed the acceptance tests went green. It then
reported its five files.

`implement.ts` compared that answer to the filesystem, found every file identical, and reported
`nothing-to-build`. It released the claim, commented on the ticket that there was nothing to build,
and exited 0. Nothing was committed. Nothing was pushed. No pull request was opened.

## Why the filesystem cannot answer this

`filesThatChange` compared each returned file against `readFile(path)`, and its own comment
explained the ordering it depended on: *"Asked before the write, because after it every file is
identical to what was written."*

That reasoning holds only if `deps.writeFile` is the sole writer. It is not. The implementer stage
holds Edit, Write and Bash, and building a ticket is what it does with them — the wrapper's write
is a re-application of edits already on disk, not the first arrival of them. So the comparison was
between the implementer's answer and the implementer's own edits, which agree by construction. The
check was structurally incapable of returning true for a run that did its job. It could only pass
when the model reported content it had never written down.

`git status` is indifferent to who wrote a file, and answers both cases correctly:

- #210's run (ADR-0042's `nothing-to-build` case): the model changed nothing, the tree is clean,
  and the lane says so instead of dying on `git commit`'s `nothing to commit, working tree clean`.
- #237's run: the model changed the tree itself, the tree is dirty, and there is a commit to make.

It is scoped to the paths the implementer reported, so a stray edit it made and did not report
cannot smuggle itself into the commit — the same list `openPrAndDispatch` hands the Immutability
job. Untracked files count, which is why this is `status --porcelain` and not `diff --quiet HEAD`.

## Why the work was unrecoverable

Nothing on GitHub held a copy. The run uploaded no artifact. The claim branch was created at
`main`'s tip and deleted without ever being pushed to. The runner workspace was torn down. And the
job log renders the call as a bare `StructuredOutput()` — the payload is elided from the stream, so
the five files appear nowhere in the 23KB of log GitHub retained.

A lane 05 answer therefore exists in exactly one place: the model's reply, in memory, for the few
seconds between the stage returning and the run deciding what to do with it. Every safeguard in this
lane sits downstream of that moment, which means every one of them can only ever protect work that
already survived it.

So the receipt is written first, before the no-op check, before the commit, before the PR — and it
is uploaded on failure as well as success, because the runs worth recovering are precisely the ones
that ended without a pull request. It goes to `runner.temp`, outside the checkout, so it can never
be staged into the branch it describes.

## The cost

An artifact per lane 05 run, kept 30 days. Against a lower bound of $6.36 and 23 minutes for one
lost run, with no way to tell how many earlier runs reported `nothing-to-build` for the same reason
rather than a real one.

## What this does not change

The `nothing-to-build` outcome itself stands exactly as ADR-0042 and #196 defined it: a green run,
a released claim, and a note on the ticket. What changes is only which question establishes it.
