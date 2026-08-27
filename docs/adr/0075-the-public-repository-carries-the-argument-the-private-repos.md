# The public repository carries the argument, the private repository carries the evidence

Recorded 2026-08-27.

This repository went public on 2026-08-27, and with it went `docs/research/session-prompts-2026-08.md`
— 152,031 characters of the owner's verbatim prompts, committed and readable by anyone with the
clone URL. It is deleted by this ADR, and the ruling is the line above: what argues a decision
belongs in this repository; what evidences it belongs in `collod873/Knowledge-Base`, which is
private.

## The boundary

**Public, in this repository:** ADRs, `CONTEXT.md`, `DESIGN.md`, code, tests, and a research note
that draws a conclusion from evidence without reproducing the evidence itself — a session count, a
finding, a table derived from the corpus. These are the argument: they say what was decided and
why, and a stranger reading them learns the reasoning without learning what was typed to produce it.

**Private, in Knowledge-Base only:** session transcripts, prompt corpora, anything that is the raw
material a finding was drawn from rather than the finding. `session-prompts-2026-08.md` was not a
research note in this sense — it was the corpus itself, formatted as one. Its "Method" section said
so directly: *"Not analysed. Below is the record."* A file whose entire content is the evidence has
nothing to leave behind once the evidence moves.

The test for a future note: if deleting the corpus it was drawn from would also invalidate the note,
it is argument and stays. If deleting the corpus would delete the note's entire content, it was
evidence wearing a research note's clothes, and it belongs in Knowledge-Base, not here.

## Exposure, not staleness, is what removes a research note

Nothing about `session-prompts-2026-08.md` went stale — the prompts it recorded are exactly as true
today as the day they were typed. It is deleted because the repository holding it changed audience,
not because its content aged out. `docs/adr/README.md`'s three-part bar for writing an ADR (hard to
reverse, surprising without context, a genuine trade-off) has no matching bar for deleting a research
note, and this ADR is that bar's first application: a note is removed when what it exposes stops
being acceptable to expose, independent of whether the note is still accurate. Staleness is a reason
to supersede an ADR or update a note; it has never been a reason to delete one outright, and isn't
here either — exposure is a different axis, and this is the only one that fired.

## ADR-0072 and ADR-0067 cite a path that is now gone

[ADR-0072](0072-a-research-note-with-no-antecedent-issue-declares-that-in-a.md) names
`session-prompts-2026-08.md` as one of the two notes that forced the `Unprompted:` field into
existence, and [ADR-0067](0067-the-missing-trailer-check-is-a-counter-because-it-files-wher.md)
counts it among the three `docs/research/` documents carrying no issue pointer as of 2026-08-26. Both
citations now name a path with nothing at it.

Neither argument depended on the file continuing to exist. ADR-0072's ruling is about the *shape* of
a research note with no antecedent issue — the field it invented, `Unprompted:`, and the tool that
writes it — and the fact that this file was one of the two notes that forced that shape is historical
evidence for why the field exists, not a live dependency on the file being readable today. ADR-0067's
count of "three now carry no issue pointer" is a measurement taken on 2026-08-26, stamped with that
date; a measurement does not stop having been true because one of the things it counted was later
deleted for an unrelated reason. `docs/adr/README.md` already answers what to do here: don't edit an
old ADR to reflect a new decision. Neither ADR-0072 nor ADR-0067 is amended or back-stamped by this
ruling — they stay exactly as written, citing a path that is now gone, because the citation was never
the load-bearing part of either argument.

## The history rewrite does not make this ADR's ruling retroactively false

A companion move to this one rewrites this repository's history to strip the deleted file's prior
blobs, so `git log -p` cannot resurrect the 152KB this ADR removes from `HEAD`. That rewrite does not
happen instantly everywhere: GitHub keeps unreferenced objects reachable — fetchable by anyone who
already has the commit SHA, visible via cached forks, pull request diffs, and API responses — until
its own garbage collection eventually purges them, on a schedule this repository does not control
and cannot force. "Deleted" in this ADR means removed from every ref this repository publishes going
forward; it does not mean instantaneously unreachable everywhere GitHub has ever touched it. That gap
is accepted, not solved, by this ruling — solving it is a hosting-provider problem, not a repository-
content one.

## Consequences

**A research note is now two things, and only one belongs here.** Before this ADR, "research note"
meant anything in `docs/research/`. After it, a note that is itself the corpus fails the boundary
test above and does not belong in this repository regardless of how it is formatted or what field it
carries.

**Knowledge-Base is confirmed as the evidence store, not merely the corpus store.**
[ADR-0020](0020-the-session-corpus-is-stored-in-knowledge-base-raw-sessions.md) already put captured
session spines there as storage; this ADR extends the same boundary to anything else that is raw
prompt material rather than a finding drawn from it.
