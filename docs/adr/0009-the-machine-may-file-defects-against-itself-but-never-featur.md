# The machine may file defects against itself but never features

Recorded 2026-08-23.

A run that hits a defect in the machinery — a lane that misfired, a gate that failed open, a
publisher that wrote the wrong edge — files it as a `bug` at lane 00, like any other defect. A run
that has an *opinion* about how the machinery could be better files nothing. There is no tenth lane;
self-directed work uses the same nine and competes for the same slots.

**A machinery defect is filed in this repo, whichever repo the run was working in.** A lane
misfiring in Lumaria is not a Lumaria bug, and filing it in Lumaria's tracker buries it where nobody
who can fix it is looking. The filing run names the repo and the run it came from and stops there;
it never edits the machinery from inside the repo it was dispatched into.

`DESIGN.md` §11 Q5 left this open, and agent-skills
[#134](https://github.com/collod873/agent-skills/issues/134) asks the same question. The line falls
between the two because a defect carries a failure that already happened and is therefore checkable
against something outside the agent that found it, while a feature is an opinion — and opinions
about the machinery are where August's 82% machinery share came from. That is F2: the system
becoming its own biggest customer.

## Considered options

- **A tenth lane with its own queue and cap** — rejected. A separate lane legitimises the machine as
  a customer and then has to be rationed to stop it winning; the cheaper move is to deny it the
  ability to originate the work in the first place.
- **Nothing files against the machine; it surfaces in the brief** — rejected. It puts the owner back
  in the loop on exactly the boring class the system exists to absorb, and it violates the §6 rule
  that every lens produces issues rather than notifications.
- **Defects yes, features never** — chosen. It needs no new machinery, and the asymmetry it enforces
  is the same one [ADR-0007](0007-the-shaper-routes-every-item-so-the-short-path-is-not-defect.md)
  turns on.

## Consequences

Machinery improvements still happen — the owner files them, from lane 00, like any other idea. What
is forbidden is the machine originating them, which is the same prohibition §00 already applies to
sessions and for the same reason: an invitation written down anywhere is read at the start of every
session.

A defect a run files against itself does not exempt that run from landing. Filing is not sweeping —
the close gate in lane 09 still reads the closing record, and a run cannot discharge its own ticket
by pointing at a bug it filed.

Cross-repo filing needs a write path into this repo from a run dispatched elsewhere, which the
estate does not have yet. Until it does, a run outside this repo records the defect in its own run
output and the cross-repo counter is what carries it across — the same mechanism §6 already builds
for findings, pointed at the machinery. This is the first thing on the page that makes the counter
load-bearing rather than merely cheap.
