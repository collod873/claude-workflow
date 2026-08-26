# DESIGN.md carries no lane status; a shipped lane collapses to its six-field contract

Recorded 2026-08-26.

**A lane's status is the shape of its own section, and nothing else.** A section written as a
contract is shipped. A section still carrying design prose is unbuilt. There are no `live` /
`partial` / `absent` marks, no ✅ / ◐ column, no "Last landed" header, no scorecard. Nothing in
`DESIGN.md` has to be updated when a lane ships, because **the collapse is the edit that ships it**
— there is no second act of marking, and therefore nothing that can rot.

Ruled by the owner on 2026-08-26 in
[#81](https://github.com/collod873/claude-workflow/issues/81).

## What a lane collapses to

Six fields. Nothing else survives.

| Field | Carries |
|---|---|
| **Fires on** | The event. There is no other way in |
| **Refuses** | What it turns away before spending model time |
| **Cost** | Model stages per unit of work, and owner minutes |
| **Sees** | The evidence classes it can observe, numbered against the ten-class taxonomy |
| **Binds** | The facts another lane's design has to obey — a venue budget, a bypassability, a cap |
| **Lives in** | The code path, and the ADRs that rule it |

The first four are `DESIGN.md` §0's existing set, unchanged. **Binds is new**, and it is the whole
answer to the tension this decision had to resolve: a contract is what a *later* design session
needs from a shipped lane, and some of what it needs is neither a trigger nor a refusal nor a cost
nor a coverage claim. Lane 04's design has to know that acceptance tests run at the Actions venue
under a 10-minute budget and that every venue below Actions is bypassable. Both facts are lane 06's,
both are load-bearing on a lane that does not exist yet, and a four-field collapse would delete
them. The term is filed in `CONTEXT.md`.

## The deletion rule

**Every sentence arguing why a shipped lane was built the way it was dies with the collapse.** The
Foundry re-derivation, the era-4/5/6 citations, the Lumaria A/B numbers, the crewops flake
precedent, the `course-video-manager` husky trick. What is settled needs no argument; what is
unsettled is not a shipped lane.

The one obligation this leaves: **if a fact turns out to live only inside the argument, it moves into
Binds or becomes an ADR before the argument is cut.** Never "keep the paragraph just in case" — a
paragraph kept in case is the manifest this decision exists to refuse.

## Why not a mark

A mark is a manifest of one, and C4 rules that anything needing an active ritual to stay true dies
by roughly month three. The evidence was already in the file when this was ruled: three separate
status passages had rotted — the header's "Last landed", §10's ✅/◐ column, and §09's *"it has judged
nothing yet"* — and `README.md`'s status paragraph never learned that lane 09 existed at all.
**Nothing machine-reads any of them**; no hook, workflow or script parses `DESIGN.md`. The marks were
decoration that four documents were obliged to keep true.

Shape-as-status is also *more* informative than the marks it replaces. A ◐ meant "code landed
without the event that runs it" and said nothing about which half was which. Under this rule the
built half is a contract and the unbuilt half is still prose, in the same section, and the reader can
see the seam.

## What fires the collapse

Every `DESIGN.md` §10 move issue carries an acceptance criterion — *"§NN is collapsed to its
six-field contract"* — and the close gate on `issues.closed` refuses a `completed` close whose
record does not carry a MET bullet for it. No new machinery: `close-gate.ts` already counts `- [ ]`
items under `## Acceptance criteria` and demands a verdict apiece.

**Its declared ceiling is inherited intact.** The gate verifies the *claim*, not the collapse; a
well-shaped lie passes, exactly as `DESIGN.md` §09 already admits about every other criterion. An
Action that diffs the document against the lane's code was rejected because it would need to
recognise "design prose", which is the judgement this ruling spent its length removing.

## Scope

The rule reaches **any passage arguing for a decision already ruled**, not lanes only. `DESIGN.md`'s
Foundry preamble and §5's trigger map both go: §5 is 24 rows restating fires-on lines that live in
the lanes themselves, which means a lane changing its trigger obliges someone to remember a second
table. Its one unique claim — that the brief's window is the only time-shaped thing in the system and
originates nothing — moves to §8.

It reaches `GOAL.md` §4 too: **a retired blocker collapses to one line naming what retired it and the
ADR or commit that did.** A *live* blocker is design content and does not collapse — blocker 1's open
half keeps every word, including the 83 crashing rows in `mirror.mjs`.

## Consequences

- `DESIGN.md` §0 stops describing status marks. It defines the six fields, states this rule, and
  cites this ADR — a rule filed only in `docs/adr/` is not read by a session editing `DESIGN.md`,
  and §0 is read by construction.
- `README.md` loses its §Status paragraph rather than having it corrected.
- `GOAL.md` §4 keeps blocker state. A blocker is what the charter waits on, not a lane's status.
- §12's scorecard grid is removed. Its C1 arithmetic folds into §0, beside the promise it pays off.
- **Removed section numbers are not reused, and the remaining sections keep theirs.** §5, §9 and §12
  leave gaps. `DESIGN.md`'s section numbers are cited from `docs/adr/`, from workflow files and from
  code comments — `close-gate.ts` cites §09 and §3, `verify.yml` cites §06, ADR-0010 amends §06's
  growth rule, ADR-0024 strikes §8's third limit — so renumbering would silently invalidate every
  one of them for a cosmetic gain.
- **Three citations into removed sections are left standing rather than edited**, because an old ADR
  is never edited to reflect a new decision: ADR-0015 and ADR-0024 cite §12, and ADR-0009 cites
  §11 Q5. Where they now resolve — §12's C1 arithmetic is in §0, its ⚠ cells are in §11's list, and
  §11's questions are no longer numbered. Two citations that are *not* in ADRs were repointed:
  `.claude/hooks/gauntlet-hook.mjs` and `docs/research/gauntlet-portability-2026-08.md`.
- [#75](https://github.com/collod873/claude-workflow/issues/75) is unblocked, and its acceptance
  criteria are amended to cover the preamble, §5 and `GOAL.md` §4 — which its original scope did not
  claim.

## What would reverse this

A machine reader that needs a status mark it cannot derive from the section's shape. Nothing reads
`DESIGN.md` today, and a reader that arrives would be evidence, not an argument.
