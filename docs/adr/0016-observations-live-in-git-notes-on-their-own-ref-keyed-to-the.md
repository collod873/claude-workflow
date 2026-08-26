# Observations live in git notes on their own ref, keyed to the commit they describe

Recorded 2026-08-25.

An observation the auditor makes about a session is written as a git note on `refs/notes/observations`,
anchored to the commit it is about, rather than appended to a file in the working tree. Draining a
batch is then `git log <range> --notes=observations`, and the range *is* the unit of work, so a
finding cannot be read apart from the code it describes. Ruled in
[#36](https://github.com/collod873/claude-workflow/issues/36) §Solution 3 and ratified by the owner
on 2026-08-23.

## Why a ref and not a file

**Staleness stops being a category.** 43% of the pre-fix decision-inbox's findings were stale — read
long after the code moved under them. A note is anchored to a SHA, so a finding about a file the
batch later deleted drops itself at release, for free.

**No working-tree contention.** Lumaria's `docs/decision-inbox.md` is gitignored precisely because
parallel drain workers on a shared branch collide appending to the same lines. A separate ref pushes
and fetches independently of the branch and has no such problem.

## The honesty note this ADR exists to carry

This is the one ruling in [#36](https://github.com/collod873/claude-workflow/issues/36) **with no
measurement behind it and no prior art in the estate.** It was introduced by an agent on 2026-08-21
and carried forward as an accepted premise; the owner ratified it explicitly on 2026-08-23, after
that provenance was flagged to him. Every other load-bearing ruling in that spec rests on a counted
number. This one rests on an argument.

It is recorded anyway, and recorded with its provenance attached, because an unmeasured premise that
an agent proposed and a human signed is exactly the thing a future reader will otherwise mistake for
a settled finding.

## What reversing it would cost

Almost nothing, and that is deliberate — it is the cheapest thing in the spec to reverse. Nothing
else in #36 depends on the storage mechanism: the capture hook writes Markdown to
`Knowledge-Base/raw/sessions/` either way, the auditor's lenses and the two-site gate are unchanged,
and the release trigger consumes a list of observations without caring where the list came from. A
reversal costs the writer and reader of the notes ref — one small module — plus re-homing whatever
observations exist at the time, which are recoverable because `git notes` are ordinary objects.

The corollary is a standing instruction: **if this proves awkward in practice, reverse it rather
than building around it.** The moment something else starts depending on notes-shaped storage, that
cheapness is gone and this ADR is no longer true.
