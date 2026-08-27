# Write-on-surprise does not ship: the transcript auditor already carries W6

Recorded 2026-08-26.

Amends: [ADR-0008](0008-a-run-ends-by-writing-what-surprised-it-into-the-module-s-co.md), whose
ruling this replaces — see "What this amends" below.

An implementer run does not end by writing what surprised it into a `CONTEXT.md`. The mechanism is
struck before it is built. W6 — *write the autopsy while it still stings* — is carried by the
transcript auditor, which already reads every session at session end and is measured.

## What this amends

[ADR-0008](0008-a-run-ends-by-writing-what-surprised-it-into-the-module-s-co.md), which ruled that a
run ends by appending a real answer to the module's `CONTEXT.md`, or writing nothing. That ADR is not
edited; this one replaces its ruling. Its reasoning about *venue* stands and is why the alternatives
below were not reconsidered — `docs/findings/` is still an inbox with no reader, and an ADR per
surprise still needs a signature a surprise does not merit.

`DESIGN.md` §11's unfiled question 4 — *write-on-surprise is uncalibrated* — is retired rather than
answered, and the coverage ledger's row 4 loses it.

## The argument

**The venue does not exist.** ADR-0008 appends to *"the module's `CONTEXT.md`"*. This repo has
exactly one `CONTEXT.md`, at the root, and no `src/` — there are no modules. The root file is a
glossary and is by its own contract devoid of implementation details, so it is not a legal target.
Shipping this meant first inventing a directory convention purely to give the mechanism somewhere to
write.

**The bar is uncalibrated and the failure is asymmetric.** §11 already flagged that a bar set at
"surprise" either floods or never fires. Flooding is not neutral: `CONTEXT.md` is loaded into every
future implementer's brief *by construction*, which was ADR-0008's whole argument for choosing it. A
wrong bar therefore degrades every subsequent run's context, permanently, and compounds. The cheap-
looking mechanism has an expensive failure mode.

**W6 is already built elsewhere.** The transcript auditor runs at session end
([ADR-0018](0018-capture-runs-globally-the-auditor-and-the-release-run-in-thi.md)), over a corpus
already being captured, and its two surviving lenses are measured at **70% valuable across 27 graded
findings** ([ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md)). It also
writes the autopsy while it stings, on the same transcript, without asking the run to grade itself.

## Considered options

- **Create module `CONTEXT.md` files lazily**, nearest the files a slice claimed, and ship the bar
  uncalibrated with a count over the first 20 runs — rejected. It invents a convention to serve an
  unproven mechanism, and the calibration window is exactly the window in which a bad bar poisons
  every brief.
- **Ship it, keep the root file as the target** — rejected. It breaks `CONTEXT.md`'s contract as a
  glossary, which `CLAUDE.md` and the domain-modeling discipline both depend on.
- **Do not ship it** — chosen, by the owner, on the same test used against the merge warden the same
  day: do not build a mechanism whose value is unproven when a measured one covers the class.

## Consequences

**What is lost is the fast loop, and it is a real loss.** A run's learning now reaches the owner at
release and returns only as a ratified standard, instead of reaching the next implementer directly
through its brief. That is slower, and whether the difference matters is genuinely unknown — nobody
has measured it, and now nobody will. This is the weakest of the five rulings made on
[#84](https://github.com/collod873/claude-workflow/issues/84) and the most likely to be revisited.

**The signal that it should be revisited** is implementers repeatedly rediscovering the same thing
about a module — which the proposed lens's two-site gate will surface as a recurrence, one release
later than write-on-surprise would have.

**Class 4 keeps one watcher, not two.** The coverage ledger's transcript row is the transcript lens
alone, which is the only class-4 mechanism this design now has. It is measured; the one being struck
never was.
