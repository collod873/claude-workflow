# A lane carries the vocabulary it works in rather than reading the repo's

Recorded 2026-08-27.

No to-tickets stage reads `CONTEXT.md`. The lane owns
`.Workflow/agent-workflows/to-tickets/vocabulary.md` — the six entries a slicing uses, copied
verbatim — and every stage prompt takes it by `{{VOCABULARY}}` injection. A test pins the copy
against `CONTEXT.md` in the repo that owns that document.

## What the read actually cost

Three headless stages each opened with *"Read `CONTEXT.md` first. Use repository terms strictly as
defined."* `CONTEXT.md` is 13 KB and thirty-five entries; a slicing uses six — Lane, Spec, Slice,
Ticket, Seam manifest, Stage. The other twenty-nine are the vocabulary for arguing about the
machine's own design: Era, Failure, Durable win, Owner point, Binds, Counter, Immutable set. None of
them appears in a ticket, because these stages do not originate prose about this domain. They
transform prose already written in it — the spec, whose author worked from `CONTEXT.md` — and
preserving a term is quoting, not glossary lookup.

The six it does use were already in the prompts. *"Tracer-bullet vertical slices, each demoable on
its own and sized to one agent session"* in `slice/prompt.md` **is** the Slice entry, paraphrased.
The stage read 13 KB to re-learn what the sentence above the read had just told it.

Filed as [#149](https://github.com/collod873/claude-workflow/issues/149), which asked to *measure*
the read. The measurement is the expensive way to answer it and the wrong question: the read is the
wrong mechanism whatever it costs.

## Why injection, and not simply a shorter file to read

An instruction to read a file is not a mechanism. It is something a model can decline, and
[ADR-0044](0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md) already named the
consequence — an unread document cannot be detected. A stage that skipped the line produced a plan
in slightly wrong words and no error, which is `CONTEXT.md`'s own **Fail-open**: not a degraded
gate, but not a gate.

Injection converts it into a precondition. `runStage` throws on a `{{VAR}}` no var covers, without
calling the model, so a vocabulary file that moved or emptied fails the stage *before* it spends
model time — [ADR-0030](0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md)'s
ruling for lane 01, which took the shaper off search entirely on the grounds that *a prohibition
written in a prompt beside an unbounded input is decoration*. Lane 01 has injected `CONTEXT.md` into
its shaper since that ADR. to-tickets was doing the opposite, in the same estate, with the ADR
already written.

## Why the lane owns the copy rather than pointing at the repo's

[ADR-0055](0055-a-lane-ships-as-a-reusable-workflow-and-a-second-repo-carrie.md) ships each lane as
a reusable workflow that other repos call. In a caller repo, `CONTEXT.md` is either absent or is
*that* repo's domain model — a plumbing company's glossary — and a stage instructed to read it and
use its terms *strictly as defined* would take it as authority on what a slice is. That failure is
silent, produces tickets, and is indistinguishable from working. It is the exact class this estate
has ruled repeatedly it cannot survive.

A lane-owned vocabulary travels with the lane, so the lane means the same thing everywhere it runs.

## Considered options

- **Measure the read first, per #149 as filed.** Rejected as the entry point. Token accounting
  cannot separate *reads less* from *reasons worse*, and the portability failure above is a defect
  regardless of the number. The honest experiment, if one is ever wanted, is two runs of the same
  spec diffed — cheaper than the measurement and it answers the real question.
- **Trim `CONTEXT.md` itself.** Rejected: the twenty-nine other entries are load-bearing for
  shaping, specifying and the ADR corpus. The document is not too big; it is the wrong document for
  this reader.
- **Keep the read, but of a small lane-owned file** — a fifth leaf beside the four in
  `references/`. Rejected on the mechanism, not the content: it is the same instruction a model can
  decline, and a deleted leaf still fails open.
- **Inject a lane-owned copy.** Chosen.

## Consequences

**A copy can drift, so it is pinned rather than trusted.** `vocabulary.test.ts` asserts every entry
is byte-for-byte the one `CONTEXT.md` holds, and renaming a term there reddens the gauntlet here.
Note where that check lives: in the repo that owns `CONTEXT.md`. A caller repo runs neither the test
nor a `CONTEXT.md` of this lane's — it runs the lane, carrying the vocabulary the lane was published
with, which is the point rather than a gap.

**The vocabulary file has a human half and a shipped half, split by a `---` rule.** Everything above
it explains the file to its next reader and therefore names `CONTEXT.md` — a paragraph that, injected
whole, would hand every stage a pointer to the one document it must not be given. `vocabulary()`
returns only what is below the rule, and a page with no rule fails the stage rather than rendering
an empty vocabulary section nothing would catch.

**The four files in `references/` are still instructed reads, and still fail open.** They are
lane-owned, so they travel and this ADR's portability argument does not touch them — but the
mechanism argument does. Left as they are here deliberately: that is
[#149](https://github.com/collod873/claude-workflow/issues/149)'s other half, and it is a separate
change from this one.

## What would reverse this

A stage that genuinely needs to reason about the machine's design rather than about the work being
sliced — a lens filing against the pipeline itself, say. That stage wants the whole document, and
wants it injected, not read.
