---
name: ratify
description: Decides every candidate on this repo's open standards-pass ledgers from the record (HEAD, the repo's own ADRs, CODING_STANDARDS.md, CONTEXT.md), landing the small edits itself, filing the rest into one spec, and flagging (never deferring) the named sensitive shapes for after-the-fact review. Use when `/standards-pass` or `/standards` names it at the end of a run, or run it directly on a ledger sitting open.
disable-model-invocation: true
---

# Ratify

Turns an open `standards-pass` ledger's candidates into verdicts. Ratification used to be a design
interview (`/grill-with-docs`) that had to invent its own procedure and asked the maintainer
questions the record had already answered: 82% of 72 candidates audited across three repos were
decided by an ADR, a `CODING_STANDARDS.md` entry, or a code fact. This skill re-verifies each
candidate against HEAD and the record, writes the verdict itself, lands what's small, tickets what
isn't, and never stops for the maintainer; five named shapes are flagged for review after the
fact, not held before it.

Local-only, like `standards-pass`.

## 1. Gather the ledgers

`gh issue list --label standards-pass --state open --json number,body`. Every issue this returns is
in scope, since a repo can carry more than one open ledger at once (a predecessor whose Ratification
isn't fully filled yet, plus the newest pass).

Every `<slug>:` line with no verdict after it, across every open ledger, is a candidate to verify.
A `deferred, needs-human: <question> (rec: <answer>)` line left by an older run is also a
candidate: its recommendation is already the verdict; apply §3's flagged form to it without
re-verifying.

## 2. Verify each candidate

Each ledger issue already carries the candidate's evidence and drafted routing from `standards-pass`
(its `## Recurrences observed` and `## Routing` sections); this step checks that draft against the
record, it doesn't re-derive it. Per candidate, dispatch a **fresh-context verifier**: the Agent
tool, by stub, in the foreground (ADR-0168), since the verdict can't be written without its report.
Dispatch every candidate's verifier in parallel within one turn; wait for all of them before §3.
If the harness runs them asynchronously anyway, their reports arrive as task notifications; wait
for every one (or read the finished task's transcript) rather than ending the turn with verdicts
unwritten; a run that stops here has decided nothing.

The verifier is handed one slug's evidence, sites, and drafted routing, and returns exactly one
class:

- **Resolved**: read every `path:line` site the ledger names, at HEAD. If none of them still show
  the shape (fixed already, by refactor or otherwise), the class is resolved; the verifier names the
  commit that removed it (`git log -p <boundary-sha>..HEAD -- <path>`, or `git log -1 --format=%h --
  <path>` when one commit obviously did it).
- **Contradicted**: search `docs/adr/*.md`. If any ADR already rules against the drafted routing,
  the class is contradicted; the verifier names the ADR number.
- **Superseded**: search every other open ledger's own candidates (including ones already verified
  this run). If a newer ledger names a candidate covering the same shape, the class is superseded;
  the verifier names that slug.
- **Forced**: an ADR, a `CODING_STANDARDS.md` entry, or a code fact not already covered above
  settles the drafted routing as correct, with nothing left to weigh.
- **Mechanical**: nothing in the record settles it, but landing the drafted routing is the only
  reasonable call; no ADR is needed to know a zero-hit lint rule for a real duplication is worth
  taking.
- **Flagged**: forced or mechanical, *and* the candidate matches one of the
  [flag triggers](#flag-triggers) below. It is still decided this run, on the verifier's own
  recommendation; the flag only changes how the line is written and where it's reported.
  Read the trigger list against the candidate's specifics, don't pattern-match the smell name.

**A retirement candidate** (`standards-pass`'s `retirement/<slug>` class) gets one check before it
takes any of the six classes above: read the entry in `CODING_STANDARDS.md` and the rule the routing
names, side by side. A rule that reaches every case the entry's Red flag names makes the entry
**mechanised** (CONTEXT.md): verify it **Forced**, the record (the rule itself, already in the lint
config) settling the routing on its own. A rule that reaches only part of it leaves the entry
**prose** (CONTEXT.md): the retirement is refused regardless of the six classes above; the verifier
reports what the rule doesn't reach, for §3 to write on the ledger line.

## 3. Write the verdict lines

Edit the ledger issue body's `## Ratification` section directly (`gh issue edit <n> --body-file
<path>`, body read back first). One line per candidate, by class:

- **Resolved** → `<slug>: declined, resolved by <sha>`.
- **Contradicted** → `<slug>: declined, contradicts ADR-NNNN`. This is decided, never deferred:
  relitigating an ADR is a `/grilling`, not a ledger line.
- **Superseded** → `<slug>: superseded → <slug-it-was-subsumed-by>`.
- **Retirement, forced**: delete the entry from `CODING_STANDARDS.md` in the same commit that
  lands the rule replacing it: if the rule already shipped in an earlier commit, this deletion
  commit is what formally lands the retirement, standalone; if the rule is landing in this very run
  (paired with a different candidate this run is Forced/mechanical-landing anyway), fold the
  deletion into that one commit instead of a second. Never a rule sitting mechanised in the lint
  config with its prose twin still standing, the same shape `Zero-grandfather rails` already
  requires of a new rule's excused sites. Conventional-commit message naming the slug and the ledger
  issue. Then write `<slug>: ratified → CODING_STANDARDS.md (<sha>)`.
- **Retirement, refused**: the rule covers only part of the entry's judgement; the entry stays
  **prose** (CONTEXT.md), and the retirement proposing it is declined. Write `<slug>: declined,
  rule covers only part of the entry's judgement (<what it doesn't reach>)`.
- **Forced or mechanical, and the drafted routing is a small edit** (a `CODING_STANDARDS.md` entry,
  or a lint rule with zero hits against the repo as it stands): land it yourself, one commit on the
  default branch, conventional-commit message naming the slug and the ledger issue (e.g. `docs:
  ratify duplicated-code/gh-resolution (#87)`). No new lint rule ships with excused sites;
  refactor that clears them lands in the same commit, or, for a genuinely large refactor only, the
  sites are recorded excused on the ledger line with their count and reason instead of landed. Then
  write `<slug>: ratified → <file> (<sha>)`.
  - **Forced or mechanical, and the drafted routing is a refactor**: a refactor is a valid routing
    only when it's paired with the rule or standard that stops the recurrence; route the pairing, not
    the refactor alone. A routing that is refactor-only with no accompanying rule is not yet a
    candidate for §3; send it back through §2 as mechanical-with-open-question, or downgrade it to a
    ticket alongside the rule that's still missing.
- **Forced or mechanical, and the drafted routing doesn't fit in one commit** (the refactor plus its
  pairing rule, or anything bigger), don't land it. Collect it for §4; write the line once §4 files
  the spec.
- **Flagged** → the same line the forced/mechanical routing would produce, with
  ` [flag: <trigger>]` appended, e.g. `<slug>: ratified → <file>, via #<spec> [flag: fail-closed
  hook]`. The verdict is the recommendation, taken; the flag is the maintainer's reversal handle,
  surfaced in the [Ending](#ending). A flagged candidate never blocks the run.

A wrong autonomous verdict is fixed by reversing the line (and the landing, via `git revert` or a
follow-up ticket), never by capping how many candidates §2 may decide on its own. No cap, ever: a
counter is not a judgment.

## 4. File the one spec

Every candidate this run routed to ticket work (§3's "doesn't fit in one commit" bucket), across
every ledger, goes into **one spec** for the whole run: not one per candidate, not one per ledger.
File it with `~/bin/file-issue spec --title "<name>" --body-file <path>` (the `spec` kind prefixes
`PRD: ` and applies the `prd` label itself). Use the spec template `to-spec/SKILL.md` documents; one
`##`-level section per candidate is enough structure for `/to-tickets` to slice from; each names its
slug, the sites, and the routing (rule/standard plus the refactor that lands it, paired per §3).

Once filed, go back and write every one of those candidates' Ratification lines as `<slug>: ratified
→ <file>, via #<spec>`. `via #n` only counts as *filled*, for a ledger's own closing, once `#n` is
closed; that's `standards-pass`'s read of it, not this skill's write.

If this run filed no spec (nothing routed past a direct landing), there is nothing here to do.

## 5. Reversal

There is no answer mode: nothing waits on the maintainer. To overturn a flagged verdict, edit the
ledger line by hand (it's plain text) and revert the landing or file a ticket against the spec;
the same moves as for any other commit.

## Flag triggers

Shapes whose verdicts get the `[flag: …]` suffix and a line in the Ending: a closed list, extended
only by editing this section:

- Touches tenancy, RLS, auth, or a fail-closed safety hook.
- Shares a domain type across a context or slice boundary.
- Reverses a decision a closed ticket or ADR made deliberately.
- Adopts a new tool or dependency.
- Widens a rail's escape or grandfather list.

## Ending

Report the ledgers touched, the verdict counts by class, and every **flagged** line with the
trigger it matched and what was decided: the maintainer's reversal inbox, read after the fact. Name
`/drain` always: it drains any spec this or a prior run filed, and ends there: it does not sweep
its own landing. Also name `/to-tickets <spec>` when §4 filed one this run, since
`/drain` only drains tickets that already exist.
