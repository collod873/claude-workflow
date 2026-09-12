# Pipeline labels

Every label the pipeline reads or writes lives in one catalogue,
`.Workflow/agent-workflows/shared/labels.ts`, carrying its name, colour, description and
**family**. Every lane, hook and `enrol`'s label sync reads that catalogue, and the table below
is generated from it by `npm run labels-doc` (`npm run labels-doc -- --check` fails when it is
stale). Edit the catalogue, never this table.

The colour says **who holds the issue right now**, so the GitHub app's issue list reads as the
dashboard from a phone:

| Family | Colour | Holds it |
|---|---|---|
| In flight | green | A lane is on it now. The number is the lane's number from [`lane-map.md`](lane-map.md), so the label filter sorts in pipeline order |
| Waiting on the machine | blue | Nothing to do: the reconciler or the next lane will move it |
| Waiting on the owner | red | Only the owner's hand moves it |
| Verbs | purple | Imperatives only the owner applies |
| Kind | grey | What the issue is, never where it sits |
| Yours to fire | amber | `ticket`: filed by `file-issue ticket` |

## Lane labels

An open issue wears **at most one** green or blue label. `markLane` in the catalogue adds the
named label and removes every other green or blue label in the same edit, and `escalateToOwner`
removes them before it adds `needs-human`. Each lane stamps its own label as its first tracker
write; nothing clears a green label between two auto-chained lanes, because the next lane's stamp
replaces it. A green label with no run behind it is therefore the one signal that says where a
chain died.

The reconciler admits an issue to the build on `to-build` **or** on any green or blue label, and
swaps `to-build` for the lane label when it dispatches ([ADR-0182](../adr/0182-every-open-issue-wears-one-lane-label-coloured-by-who-holds.md)).
Each pass it also writes `waiting` on every open child with an open blocker and `queued` on every
ready child it did not dispatch, and rewrites one rollup line inside a `<!-- rollup:v1 -->`
marker at the top of each open PRD's body: `3 building · 2 queued · 13 waiting · 4 done`.

`1-decide` and `2-questions-open` are red rather than green: the shaper has posted its decision
sheet and waits for `approved` / `killed` / `parked`; the spec carries open questions and the
owner's edit is what moves it. `2-questions-open` stands beside `sliceable`, because a non-zero
count no longer holds the spec back (ADR-0112); the gate removes it the first time it applies
`sliceable` at a count of zero.

## The catalogue

<!-- labels-table:v1 -->
| Label | Who holds it | Colour | Means |
|---|---|---|---|
| `1-shaping` | In flight: a lane is on it now | `#0e8a16` | Lane 01 is shaping this idea into a decision sheet right now |
| `2-speccing` | In flight: a lane is on it now | `#0e8a16` | Lane 02 is writing or critiquing the spec right now |
| `3-slicing` | In flight: a lane is on it now | `#0e8a16` | Lane 03 is slicing this spec into tickets right now |
| `4-accepting` | In flight: a lane is on it now | `#0e8a16` | Lane 04 is authoring this ticket's acceptance tests right now |
| `5-building` | In flight: a lane is on it now | `#0e8a16` | Lane 05 or the mechanic is building this ticket right now |
| `6-verifying` | In flight: a lane is on it now | `#0e8a16` | Lane 06 is judging this ticket's pull request right now |
| `7-fixing` | In flight: a lane is on it now | `#0e8a16` | Lane 07's fixer is repairing this ticket's red run right now |
| `7-reviewing` | In flight: a lane is on it now | `#0e8a16` | Lane 07's reviewers are reading this ticket's diff right now |
| `8-landing` | In flight: a lane is on it now | `#0e8a16` | Lane 08 is merging and closing this ticket right now |
| `ratifying` | In flight: a lane is on it now | `#0e8a16` | The ratifier is turning this spec's observations into standards right now |
| `3-sliced` | Waiting on the machine | `#1d76db` | Lane 03 published this spec's tickets; the build runs on them, not on it |
| `waiting` | Waiting on the machine | `#1d76db` | A ticket behind an open blocker; the reconciler starts it when the blocker delivers |
| `queued` | Waiting on the machine | `#1d76db` | A ticket with every blocker delivered and no worker slot yet |
| `sliceable` | Waiting on the machine | `#1d76db` | A spec lane 02 handed to lane 03 to slice |
| `needs-human` | Waiting on the owner | `#d93f0b` | Ticket stalled; a human decision or action is required |
| `fuzzy` | Waiting on the owner | `#d93f0b` | A decision is owed before this can be ticketed |
| `by-hand` | Waiting on the owner | `#d93f0b` | Claims a workstation, cross-repo, or immutable-set path; a human builds it by hand |
| `1-decide` | Waiting on the owner | `#d93f0b` | The shaper posted its decision sheet and waits for approved, killed or parked |
| `2-questions-open` | Waiting on the owner | `#d93f0b` | The spec carries open questions; the owner's edit is what moves it |
| `slice-failed` | Waiting on the owner | `#d93f0b` | A to-tickets run refused or failed |
| `shape-refused` | Waiting on the owner | `#d93f0b` | Refused at lane 01 stage 1: the idea already exists, or an ADR ruled it |
| `spec/gap` | Waiting on the owner | `#d93f0b` | The spec is silent, ambiguous or self-contradictory here |
| `to-build` | Verbs only the owner applies | `#5319e7` | The owner hands a finished ticket straight to the build; swapped for the lane label at dispatch |
| `to-spec` | Verbs only the owner applies | `#5319e7` | A closed Wayfinder Map the owner is handing to the spec author (ADR-0059) |
| `approved` | Verbs only the owner applies | `#5319e7` | The owner accepted a decision sheet; files its ADRs and dispatches |
| `killed` | Verbs only the owner applies | `#5319e7` | Shaped and rejected. Becomes prior art the sweep refuses against |
| `parked` | Verbs only the owner applies | `#5319e7` | Shaped and set down. No dispatch, and nothing ever re-raises it |
| `go-long` | Verbs only the owner applies | `#5319e7` | ADR-0007's route override, applied alongside approved |
| `go-short` | Verbs only the owner applies | `#5319e7` | ADR-0007's route override, applied alongside approved |
| `prd` | Kind, never state | `#c2c2c2` | A spec issue, filed by file-issue spec |
| `idea` | Kind, never state | `#c2c2c2` | The owner's own words about work that might be worth doing, never edited |
| `bug` | Kind, never state | `#c2c2c2` | The owner called it a break; intake, never a verdict |
| `build-order` | Kind, never state | `#c2c2c2` | A move on the build order (ADR-0026) |
| `standards-pass` | Kind, never state | `#c2c2c2` | A standards-authorship pass, one per run |
| `lane-07-finding` | Kind, never state | `#c2c2c2` | A lane 07 finding that survived the refuter |
| `wayfinder:map` | Kind, never state | `#c2c2c2` | A Wayfinder map: Notes, Decisions-so-far and Fog |
| `wayfinder:research` | Kind, never state | `#c2c2c2` | A Wayfinder child: research |
| `wayfinder:prototype` | Kind, never state | `#c2c2c2` | A Wayfinder child: prototype |
| `wayfinder:grilling` | Kind, never state | `#c2c2c2` | A Wayfinder child: grilling |
| `wayfinder:task` | Kind, never state | `#c2c2c2` | A Wayfinder child: task |
| `wayfinder:dest-spec` | Kind, never state | `#c2c2c2` | A Wayfinder destination that is a spec |
| `wayfinder:dest-decision` | Kind, never state | `#c2c2c2` | A Wayfinder destination that is a decision |
| `ticket` | Yours to fire | `#fbca04` | A ticket: acceptance criteria and a file claim, filed by file-issue ticket |
<!-- /labels-table:v1 -->

**Absence of a kind label, and no `## Acceptance criteria` in the body, means *not yet judged*,
never a further role.** Nothing sweeps that state automatically: an unjudged issue waits for
whichever session picks it up to run `~/bin/file-issue ticketify`.

Six older labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`,
and `bug`/`enhancement` as triage output) were retired because each recorded a verdict rather
than a position. `running`, which six lanes stamped and none of the pull-request lanes did, is
retired by the lane labels above; deleting it from the repository is the sibling `by-hand` ticket,
with the `.github/` half of this work.

## Hand-offs

Two of the verbs hand work to a named lane, and only the repository owner's own hand applies
either: `to-spec` says *spec this*, `to-build` says *build this now*.

| Label      | Applied by                 | Read by                                                       | Means                                                                 |
| ---------- | -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `to-spec`  | the owner, by hand         | `.github/workflows/spec-caller.yml` -> lane 02                  | Spec this accepted idea or closed Wayfinder Map (ADR-0059)             |
| `to-build` | the owner, by hand         | `.github/workflows/dispatch-reconcile-caller.yml` -> lane 04's recompute -> lane 04's acceptance author -> lane 05 | Build this hand-written ticket now, without the spec chain (#184) |

`to-build` is the one term nothing can infer from a body: **intent to build now**. Ticket *shape* is
not it (plenty of ticket-shaped issues are not wanted built), so the reconciler admits an issue
either because lane 03 published it (`## Parent PRD`) or because this label is on it, and refuses,
in one comment, a labelled issue missing `## Acceptance criteria` or `## Files claimed`. The
reconciler swaps the label for the lane label (`4-accepting` or `5-building`) the moment it
dispatches, and from then on admits the ticket on that lane label instead, so a ticket whose run
died is started again without the owner re-applying anything. A ticket the reconciler already sees
as started is never re-commented.
