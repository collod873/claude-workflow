# Spec format

The one shape a spec body takes in this pipeline, read by every producer (`/to-spec`, lane 02's
spec author and its reconciler, `~/bin/file-issue spec`) and refused by
`bin/ticket_shape.py`'s `validate("spec", …)`: the same validator, the same call, whether a spec
is written in a live session or drafted by a lane on a runner.

Producers reference this doc rather than restate it, for the reason `docs/agents/ticket-format.md`
gives about its own contract: a restated copy is exactly what lets a producer's template drift out
of sync with the parser it feeds. A spec's copy drifted the other way: lane 02 held *no* copy at
all, so a spec the cold door authored could land in a shape the spec closer
(`close-ticket --spec`) then had no command to close it on.

This is the ticket contract's opposite number and is deliberately not a subset of it. A ticket
body carries `## Files claimed` and any number of criteria; a spec body carries neither.

## The core, validator-enforced

`validate("spec", body)` refuses a body missing any of the below. It is a refusal, not a warning:
a spec is the one issue in this pipeline whose whole purpose is a single closable claim, and one
that arrives unclosable is discovered six weeks later, by a closer that has nothing to run.

**`## Acceptance criteria`, carrying exactly one `- [ ]` item.** Exactly one, never "at least
one": a spec with three behavioural claims is three specs, and the value of the rule is that there
is one sentence to point at when asking whether the product does the thing. A closer handed
several has no single sentence to run.

**The criterion is the owner's own words, quoted, never paraphrased.** It is the answer to "I'll
know it works when I can ___", and it is the only thing in a spec that is not synthesis. A
paraphrase is a claim the owner cannot check at a glance, which is the one thing the criterion
exists to be.

**The criterion carries a well-formed trailing check marker**: a space-delimited hyphen, the
label `check:`, and a single backtick-quoted command naming the one thing that verifies it:

```markdown
- [ ] I'll know it works when I can see the nightly run post its own summary - check: `gh run list --workflow=nightly.yml --json conclusion --jq '.[0].conclusion == "success"'`
```

The delimiter is the same alternation a ticket's marker uses (`bin/ticket_shape.py`'s
`CHECK_MARKER_DELIM`, where an em or en dash still parses for bodies written under the older
spelling), so an author never learns two dash rules for two kinds of body. A marker
that is attempted but does not parse (a missing command, or prose trailing the closing backtick)
is **refused** here, where a ticket's would only be warned about.

**The command is required to read the world.** A ticket's check has to be answerable from a
checkout and must never touch the tracker or the network; a spec's has the opposite obligation. A
`gh run list`, a deployed health endpoint, a query against real data are all correct here: the
claim is that the product does the thing, and only production can answer that. The asymmetry is
the point: **a ticket's check reads the tree, a spec's check reads the world.**

**The command must be red on the day the spec is filed.** `validate` runs it, in the caller's
tree, and refuses the filing outright when it already exits 0. A criterion true by accident of
the tracker's current state proves nothing when it turns green later, so it is not a check. A
command that cannot be run to a verdict at all (no such binary, or it outran the budget) is not
evidence either way and only warns.

**If the sentence cannot be mechanised, do not invent a command.** Raise it as a numbered open
question naming what would have to exist for the sentence to be checkable, and settle it before
publishing. A guessed command is worse than no spec: it closes the spec on something that was
never the claim.

## The prose the criterion sits under

Not validator-enforced (no parser reads these) but this is the shape every spec in this tracker
takes, and the shape the lane that slices one into tickets expects to read.

- `## Problem Statement`: the problem the user is facing, from the user's perspective.
- `## Solution`: the solution to that problem, from the user's perspective.
- `## User Stories`: a long numbered list, `As an <actor>, I want a <feature>, so that <benefit>`,
  extensive enough to cover every aspect of the feature.
- `## Implementation Decisions`: modules built or modified, interfaces, schema changes, API
  contracts, architectural rulings. No file paths and no code snippets: both go stale immediately.
  The one exception is a snippet a prototype produced that encodes a decision more precisely than
  prose can: a state machine, a reducer, a type shape, inlined, trimmed to the decision, never a
  working demo.
- `## Testing Decisions`: what makes a good test here, which modules get tested, and the prior art
  in this codebase. **No test seams.** `/to-tickets` owns those, one lane later, against sliced
  work and with more information than a spec author has; a seam chosen here is a second, earlier,
  unreviewed answer to a question that stage answers better.
- `## Out of Scope`: what this spec is not doing.
- `## Further Notes`: anything else.

`## Acceptance criteria` sits **last**, after the prose, because it is the sentence the whole spec
was written to make true.

Written out, that is the body both producers file, and it is written here **once**. The two
variants below carried a copy each, identical but for the criterion line: the same drift this doc
exists to prevent, one level down, in the document that says so. A reader learns the shape from
whichever copy they scrolled to, and the copies were already one edit from disagreeing.

```markdown
## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

1. As a <actor>, I want a <feature>, so that <benefit>

## Implementation Decisions

- The modules built or modified, their interfaces, schema changes, API contracts, architectural rulings.

## Testing Decisions

- What makes a good test here, which modules are tested, and the prior art in this codebase.

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

## Acceptance criteria

- [ ] <the one criterion, in the form its variant below gives> - check: `<the one command that proves it, allowed to read the tracker or production>`
```

## Variants

Each producer files the body above. The two differ in one place only: where the owner's sentence
comes from, and what happens to everything the producer had to guess at. So a variant here is the
criterion line and nothing else.

### Session spec (`/to-spec`, live session)

Written in a conversation with the owner and filed with `~/bin/file-issue spec`. The owner is in
the room, so the one criterion is a sentence he finishes on the spot, and anything unsettled is
asked rather than assumed. The sentence completes the opener he was asked:

```markdown
- [ ] I'll know it works when I can <the owner's sentence, in his own words> - check: `<the one command that proves it, allowed to read the tracker or production>`
```

### Lane spec (lane 02's spec author and reconciler)

Drafted on a runner with no human in the room, from a decided source (an accepted decision sheet
or a closed map) rather than from a conversation. Same body, three differences in how it is filled:

- **The owner's sentence is quoted from the record**, not asked for: whatever the collected
  Decided context already carries in his words. There is nobody to ask.
- **Every guess becomes a numbered open question, never a silent assumption**, and those travel in
  the author's `openQuestions` field rather than in the body. If the owner's sentence cannot be
  mechanised, it becomes an open question and the spec is published without a guessed command.
- **`## Assumptions` is appended by the reconciler**, after everything else in the body, one line
  per resolution the critic settled: the decision and its reason, so the guess is visible to
  whoever reads the spec next. It is the only changelog a rewrite leaves; the revised prose is the
  record for everything else.

There is no opener to complete: the sentence is lifted whole from the record.

```markdown
- [ ] <the owner's sentence, quoted from the record in his own words> - check: `<the one command that proves it, allowed to read the tracker or production>`
```

And the reconciler's section, appended after everything else in the body:

```markdown
## Assumptions

- **What was decided.** Why the Decided context did not settle it.
```
