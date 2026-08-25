# A model may translate evidence into a gate's grammar but never render the gate's verdict

Recorded 2026-08-25.

Where a gate needs a record that its subject did not write, a model may read whatever evidence
exists and express it in the gate's grammar — and the gate then judges that output by the same
deterministic rules it judges a hand-written one. The model translates; the grammar decides.
Nothing a model says is ever itself a verdict.

## Why this comes up at all

Moving the close gate to `issues.closed` (`DESIGN.md` §09) fixed the hole it was moved to fix and
opened a smaller one in its place. A commit-keyword close, a close from a phone, a close from the
web UI — none of them can be told to post a `## Closing record` first, because there is no agent
in the loop to tell. Having no record is the normal shape of those closes, not defiance, and
`no-closing-record` was already 78 of era 6's 125 refusals when only agents could trigger it.

A refusal has to be clearable ([ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md)),
and a gate whose dominant refusal reason is "you closed this the way GitHub closes things" is a
gate that parks work.

## Considered options

- **Amnesty judge** — one Haiku decides whether a close without a record was legitimate anyway.
  Rejected. It is cheaper and it removes more friction, and it also ends the gate: a model gets to
  wave closes through, and it would be waving through the majority of the volume. Era 6's log says
  this mechanism's whole measured value is compliance — `unmet-criterion` fired exactly once in
  558 rows — so a model empowered to excuse non-compliance excuses the only thing being measured.
- **No model, refuse deterministically.** Rejected: it reopens every commit-keyword close, which
  is the exact venue hole blocker 1 names.
- **Parser of last resort.** Chosen. One Haiku, spent only where no record exists, reading the
  issue and the pull request that closed it and writing the record the closer didn't. Its output
  goes through the identical `evaluateRecord` a human's record goes through. A salvaged record
  that fails is a refusal like any other.

## Consequences

**The gate's strictness is unchanged by the model's presence.** A salvage that claims `MET` with
nothing shaped like evidence is refused for `bad-evidence-shape`, the same as a person's would be.
This is testable and is tested, which is the property that makes the ruling worth having: "the
model cannot be talked past" is an assertion about code, not a hope about a prompt.

**The salvaged record is posted to the issue.** The gate's reasoning is durable rather than living
in a runner's log, and a later re-close finds a record and costs no model at all.

**The remaining ceiling is the one era 6 already declared.** A well-shaped lie passes, and a model
asked to write a record is a new way to produce one — which is why its prompt is told, in as many
words, that a criterion it cannot evidence is `UNMET` and that a fabricated bullet is worse than
the refusal it replaced. That instruction is a mitigation, not a mechanism. Nothing here makes
this a correctness gate, and nothing should be built on a claim that it is.

**This generalises past lane 09.** The same shape is coming in lane 04 (acceptance) and lane 06
(verify): a deterministic rule that needs its input in a fixed form, and evidence that arrives in
prose. The ruling is where the seam goes — between reading and deciding — so that later lanes do
not each re-argue it.
