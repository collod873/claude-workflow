# Lane 00's door is distinguished by where the owner is rather than by how much context he holds, so lane 01's empty input is the bootstrap and fires on move 7

Recorded 2026-08-26.

**Lane 00 is kept unchanged.** Its zero traffic is the bootstrap, not a finding about the door, and
the condition that says otherwise is **move 7 landing** — the expiry `DESIGN.md` §10 already names.

Ruled by the owner, 2026-08-26: *"It's just cause I'm still building the tools… Lane 00 would be like
I'm on the go and just throw an idea into GitHub from my phone."*

## The measurement, and why it is not evidence about the door

Taken while resolving [#97](https://github.com/collod873/claude-workflow/issues/97): **zero of this
repo's 108 issues carry the `idea` label**, and all **24 `shape.yml` runs are `skipped`**. The guard
works; the door has never been opened. Lane 01 — three model stages, a five-section sheet, four owner
verbs, a refuter probation — is built, wired, correct, and has never run.

That is not [#107](https://github.com/collod873/claude-workflow/issues/107)'s class. No dispatch was
lost. It is also not a signal, because the whole period it covers is one in which the owner has been
at the desk building the machine. §10 says so directly: *"until lane 05 runs on a runner, work on this
repo is driven from the workstation, which ADR-0002 forbids. That is a scaffold, and it expires the
moment lane 05 lands."* Lane 01's empty input is the same scaffold seen from the other end. A
builder files differently from a user, and the corpus contains only the builder.

## §00's distinguishing axis is wrong

§00's door table says the three doors are *"distinguished by how much context the owner has already
built."* On that axis the micro door is the shallow one, and it loses every time — `/wayfinder` and
`/grill-with-docs` are strictly better if depth is the only thing separating them, and lane 01 is
built for a door nothing would ever route through.

That reading is what the resolution of [#116](https://github.com/collod873/claude-workflow/issues/116)
was about to conclude, and it is wrong. **Both of the other two doors require a session at a desk.**
The macro door is a multi-session `/wayfinder` map; the tactical door is a local `/grill-with-docs`
session whose whole argument is that the owner invokes `/to-spec` *while context is hot*. Neither
exists when he is not at a machine.

The micro door is the only one that does. Its context is **on the go, from a phone, with no session
running** — and against that, depth is not a comparison at all: the alternative is not a shallower
capture, it is losing the idea. That is precisely the failure §00 names as the one thing the lane
exists to prevent, and it is why the lane refuses nothing, ever.

So the axis is **where the owner is**, and depth follows from it rather than the other way round. §00
is corrected to say so. Everything else in the section stands: one required field, verbatim storage,
no dispatch.

## The firing condition

[ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) requires a condition
that happens on its own, or the exception is permanent. *"The owner stops building the tools"* is not
observable. **Move 7 landing is** — it is a build, it is on the board
([#91](https://github.com/collod873/claude-workflow/issues/91)), and §10 already stakes the
bootstrap's expiry on exactly it.

**The count is ideas filed after move 7 lands, and the number that matters is zero.** A door used even
once is a door that works; the design needs no rate from it. Zero after the scaffold has expired says
the micro door is a design problem rather than a bootstrap artefact, and *that* is the moment to ask
whether lane 01 is sized for it.

This is [ADR-0063](0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md)'s discharge
shape — a probation cleared by a build landing rather than by a second number — and it is the second
mechanism here to use it.

**It is not a counter and gets no §6 row.** It files no issue and proposes no action to anybody: the
observation is made once, by whoever asks the question after move 7, and it is the falsification
condition of this ruling. That makes it a **sizing measurement** living here, per
[ADR-0064](0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md) and
[ADR-0066](0066-a-number-lives-in-an-adr-or-in-a-counter-row-never-in-the-op.md) — and it is the third
number this design has whose corpus is withheld by behaviour rather than by a build, which ADR-0066
rules costs a sizing measurement nothing.

## Considered options

- **Change the form to attract traffic.** Rejected, and it was never on the table: §00 rules out every
  field lane 01 exists to work out, and a door with one field cannot be made cheaper. The zero is not
  about the form's width.
- **Route the tactical or macro door through lane 01.** Rejected. Those doors skip it *because* the
  session already holds the nuance — §00's *"no handoff to a runner, because serialising it to an
  issue loses signal"* — and lane 01's job is to build context that those doors arrive already
  holding. Routing them through it would spend three model stages restating what the owner just said.
- **Delete lane 01 and keep two doors.** Rejected on the owner's ruling: the door has a real context,
  it is simply one he has not been in. Deleting a lane on a corpus that only contains the bootstrap is
  the mistake ADR-0064's measurement clause exists to prevent — *no traffic yet* is not *no signal*.
- **Defer the question with no condition.** Rejected by ADR-0031.

## Consequences

**Nothing is built and nothing is changed** except one sentence in §00's door table.

**Lane 01's sizing is not revisited now**, and the argument that it should be is deferred to the same
event: if the door is used, the sheet and the refuter have their input and the probation in
`probation.ts` starts counting; if it is not used after move 7, lane 01's cost is the finding rather
than the door's.

**The map's `Lane 00's issue-form fields` fog patch is resolved** — it asked the wrong question, and
the answer is that there was never a fields decision in it.

**The number to watch is ideas filed after move 7 lands**, and zero is the falsification.
