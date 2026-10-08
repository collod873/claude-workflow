# What a Wave and its wave check do today

Researches: [#1249](https://github.com/collod873/claude-workflow/issues/1249)

Child of [#1226](https://github.com/collod873/claude-workflow/issues/1226). Recorded 2026-10-08.
Sources: the Machine at `75d4b198` (`src/wave.ts`, `src/slicer.ts`, `src/done-checker.ts`,
`src/closer.ts`, `src/builder.ts`, `src/reviewer.ts`, `.github/workflows/specs.yml`, `CONTEXT.md`),
its git log, and the issue timelines, comments and closer speed reports of Lumaria's one Spec,
[Lumaria#902](https://github.com/collod873/Lumaria/issues/902). Lumaria is private: its tickets
are linked and described by role, never quoted. Facts, no rulings.

## Summary

- **A Wave ends only when every ticket under the Spec and every open follow-up of one has
  closed.** Nothing else starts the next Wave. In the newest segment one ticket waiting on the
  owner held the next Wave 5 h 06 min after the Wave's other two tickets had merged.
- **Most of that waiting is the barrier, not a dependency.** The Slicer's own citations show which
  earlier tickets a ticket relies on. Of the 12 tickets in Waves 6 to 10, 3 rely on no ticket of
  the Wave before (#957, #958, #973). Of the other 9, 4 waited 39 min to 5 h 15 min past the last
  merge they rely on (#963, #968, #974, #975). The rest waited only the 9 to 13 min transition.
- **A wave check hands forward only sentence outcomes.** It posts `## Wave check` on the Spec. A
  miss forces the next Wave's `moves`, a **Not tried yet** comes back at the next wave check, and a
  repeat miss marks the Spec `stuck`. Names, decisions and files go forward through the Slicer's
  Decisions record and its reading of the merged diffs, never through the wave check.
- **The wave check sits in series in front of the next slice.** It costs 3 to 17 min each Wave, and
  in the newest segment it changed the next slice twice in five checks.
- **No Lumaria Wave has run since the last change to Waves.** Lumaria#902 was paused at 14:55Z on
  2026-10-07 and is still paused. The newest evidence is Waves 4 to 10.

## How the run history is segmented

| Segment | Machine change it ran under | Lumaria#902 Waves |
| --- | --- | --- |
| S1 | Before [#1175](https://github.com/collod873/claude-workflow/issues/1175) (Resume on a Spec, 2026-10-06 19:44Z) and [#1182](https://github.com/collod873/claude-workflow/issues/1182) (the Slicer answers with its Decisions record, 21:03Z) | 1 to 3 |
| S2 | #1182, then [#1200](https://github.com/collod873/claude-workflow/issues/1200) (Record at the hand-off, 23:35Z); Wave 10 also under [#1221](https://github.com/collod873/claude-workflow/pull/1221) | 4 to 10 |
| none | `89e87f98` (2026-10-07 16:07Z, the Slicer no longer asks builders for a `CONTEXT.md` or ADR entry per Pick) and every later commit | no Wave ran |

Nothing merged after `89e87f98` touches when a Wave ends, the wave check or the slice. The PC
runner (`40584328`, 2026-10-08) changes only where jobs run. S2 is the evidence below. S1 is used
only where it shows something S2 cannot.

## A Wave, step by step

1. **The Slicer files the Wave.** On a new Spec, or when the last Wave ended, `bin/slice` hires the
   Slicer. It answers with the Decisions record, the tickets, `did`, `next` and `moves`. Code splices
   the record into the Spec, files each ticket under it with the record bullets it `cites` copied
   under `## Decisions it relies on`, posts the Wave note with `<!-- moves: ... -->`, and marks the
   Spec `building` (`filedWave` in `src/slicer.ts`). The prompt asks for tickets "all building at
   once beside each other" that touch different parts. No code checks that their files are disjoint.
2. **Every ticket builds at once.** Filing a ticket is its `opened` event, and `tickets.yml` starts
   its builder. The only concurrency group is per ticket (`fix-<ticket>`). Tickets share nothing
   until the closer's merge queue.
3. **The Wave ends.** Every `issues: closed` event runs the `ended` job (`bin/slice --ended`,
   `waveEnded` in `src/wave.ts`). It walks up to the Spec through the parent link, or through a
   `Follow-up of #N` chain up to 20 deep. Then `stillOpen` asks two things: is any ticket under the
   Spec open, and, if none is, is any open issue a follow-up (reviewer or builder split) of one of
   them? If either holds, it logs "the wave is not over" and stops. Otherwise it prints the Spec and
   the last Wave note's `moves`.
4. **The wave check runs, if `moves` is not empty.** The `reslice` job (concurrency group
   `reslice-<spec>`, no cancelling) checks out Lumaria, runs `npm ci`, runs `--ended` again, then
   `bin/done-check <spec> --wave <moves>` (`waveCheck` in `src/done-checker.ts`).
5. **The Slicer slices the next Wave**, in the same job, once the wave check has ended green. A
   repeat miss marks the Spec `stuck` and ends the step red, so no slice follows. With no ticket left
   to give and no miss owed, the Slicer hands the Spec to the Done check.

## Every wait, what it waits for, and whether a real dependency needs it

| # | Wait | Waits for | A real dependency? | Where |
| --- | --- | --- | --- | --- |
| 1 | Next Wave's tickets wait for the Wave to end | Every ticket under the Spec closed, and every open follow-up of one | **Only partly.** A ticket needs the tickets whose code or Shipped names it relies on, not the whole Wave. See the citation table below | `stillOpen`, `src/wave.ts` |
| 2 | The slice waits for the wave check | The `## Wave check` comment | **Only for a miss.** The Slicer reads misses as owed `moves` (`missedSinceNote`). A held sentence changes nothing it must do | `specs.yml` `reslice` job, steps in series |
| 3 | The slice waits for every merged diff | All of the Wave's merged PRs, read newest first under a 48 KB cap | **Partly.** It folds Picks whose ticket merged into Shipped names and reads what the code became, but a later ticket needs only its own upstream diffs. Past 48 KB the oldest diffs are cut anyway | `waveDiffs`, `src/wave.ts` |
| 4 | One slice per Spec at a time | The `reslice-<spec>` concurrency group | **Yes.** One writer of the Decisions record | `specs.yml` |
| 5 | A split ticket waits for its pieces | `waiting` until every piece the split comment names has closed | **Yes.** The remainder builds on the pieces | `split` in `src/builder.ts`, `wokenFromSplit` in `src/closer.ts` |
| 6 | A reviewer follow-up waits for its parent's PR | `waiting` until the parent's PR merges or closes | **Yes.** It edits the parent's code. It also keeps the Wave open (wait 1) | `recordedLater` in `src/reviewer.ts`, `wokenAfterParent` in `src/closer.ts` |
| 7 | A ticket the builder rewrote waits for the owner | `waiting` until the owner takes it off | **No code dependency.** It needs an owner ruling, and while it waits it holds the whole Wave through wait 1 | `rewritten` in `src/builder.ts` |
| 8 | A ticket that found a Machine fault waits for the fix | `waiting` until the owner takes it off once the fault merges | **Yes for that ticket**, and it holds the Wave through wait 1 | `filedForMachine` in `src/builder.ts` |
| 9 | A ticket waits for the closer's merge queue | One green PR up to date with `main` merges at a time, the rest are branch-updated in turn | **Yes.** Each PR is checked on top of current `main`. It costs 0 to 1 min "checks green to merged" in S2 | `queue` in `src/closer.ts` |
| 10 | A `paused` Spec holds its wave check and slice | The owner taking `paused` off | Owner hold. It does not hold the Wave's tickets | `waveResumed`, `src/wave.ts` |
| 11 | The Done check waits for nothing left to slice | Every Wave sliced and ended | Yes, by design | `handedOff`, `src/slicer.ts` |

### Wait 1 in S2, measured

Times are UTC on 2026-10-06 and 07, from Lumaria#902's timeline and each ticket's speed report.
"Tail" is how long the Wave waited on its last ticket after its second-to-last merged. "Check" and
"slice" run from the stage's label to its comment.

| Wave | Tickets | Filed to last close | Tail, on which ticket and why | Last close to next Wave note | Check | Slice |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | 2 | 1 h 39 min | 75 min, [#931](https://github.com/collod873/Lumaria/issues/931): 1 h 12 min filed to first commit | 13 min | 8.0 min | 3.4 min |
| 5 | 4 | 58 min | 13 min, then an owner pause of 2 h 11 min | 23 min after Resume | 17.3 min | 3.5 min |
| 6 | 2 | 54 min | 45 min, [#947](https://github.com/collod873/Lumaria/issues/947): 4 branch updates, 29 min to green | 20 min | 14.1 min | 4.0 min |
| 7 | 2 | 53 min | 26 min | 13 min | 8.6 min | 2.5 min |
| 8 | 3 | 6 h 09 min | **5 h 06 min**, [#961](https://github.com/collod873/Lumaria/issues/961): rewritten by its builder, `waiting` on the owner 05:37 to 11:25 | 9 min | 3.3 min | 3.8 min |
| 9 | 2 | 2 h 05 min | 1 h 39 min, [#968](https://github.com/collod873/Lumaria/issues/968): 1 h 29 min in checking, then a second try | 7 min, no check | none | 4.4 min |
| 10 | 3 + 1 split | 1 h 01 min | 16 min, [#973](https://github.com/collod873/Lumaria/issues/973): split, then a Machine fault | Spec paused at 14:55 | n/a | n/a |

The transition itself is short: 7 to 23 min from last close to the next Wave note, of which the
wave check is 3 to 17 min and the slice 2.5 to 4.4 min. Before #1182, when the Slicer still
retyped the whole Spec, the slice took 7.4 and 10.9 min. The cost is the tail: across the seven S2
Waves, 9 h 40 min passed with every ticket but one merged, 5 h 06 min of it on one owner wait.

### Wait 1 against real dependencies

Each ticket's `## Decisions it relies on` names the tickets that shipped each Shipped name it cites.
That is the Slicer's own statement of what a ticket builds on. Below, "needs from the Wave before"
is that list cut to the immediately earlier Wave. "Barrier-only" is the time between the last of
those merges and the ticket's filing.

| Ticket (Wave) | Needs from the Wave before | Barrier-only wait |
| --- | --- | --- |
| [#947](https://github.com/collod873/Lumaria/issues/947), [#948](https://github.com/collod873/Lumaria/issues/948) (6) | #935 | 13 min, then the owner's pause |
| [#957](https://github.com/collod873/Lumaria/issues/957), [#958](https://github.com/collod873/Lumaria/issues/958) (7) | nothing | 1 h 14 min, all of Wave 6 and its transition |
| [#961](https://github.com/collod873/Lumaria/issues/961), [#962](https://github.com/collod873/Lumaria/issues/962) (8) | #957 | 13 min |
| [#963](https://github.com/collod873/Lumaria/issues/963) (8) | #958 | 39 min |
| [#968](https://github.com/collod873/Lumaria/issues/968) (9) | #962 | **5 h 15 min**, held by #961 |
| [#969](https://github.com/collod873/Lumaria/issues/969) (9) | #961, #962 | 9 min |
| [#973](https://github.com/collod873/Lumaria/issues/973) (10) | nothing | the whole of Wave 9, 2 h 12 min |
| [#974](https://github.com/collod873/Lumaria/issues/974), [#975](https://github.com/collod873/Lumaria/issues/975) (10) | #969 | 1 h 46 min, held by #968 |

A citation is a lower bound on what a ticket needs: it can lean on code it does not cite. Even so,
the Slicer plans dependencies before it cites them. Wave 8's note already says Wave 9's tickets
need Wave 8's card payments, so the dependency graph exists when the Slicer slices. It is only written as
prose in `next`, and nothing reads it. The Slicer is also told to hold back a Wave the tickets that
touch a module it wants merged or deepened, and to slice a shared surface's slot a Wave ahead. Those
are file-collision orderings, not code dependencies. Its answer does not say which ticket was held
for which reason.

## What a wave check reads, decides and hands forward

**Reads:** the Spec body under the Spec cap; the sentence numbers in the last Wave note's `moves`,
plus every sentence the last wave check gave **Not tried yet**; and the running system (Lumaria's
checkout readied by its contract's setup, its Actions runs and its issues and PRs through `gh`). In
a wave check the owner's replies are not passed (`replies = ""`). A sentence that carries a check
command is run by code, not by the model.

**Decides**, per sentence: **Held**, **Did not hold**, **Waits for the end** (only the owner can
try it), or **Not tried yet** (nothing on `main` could show it). A miss that also missed at the
last wave check marks the Spec `stuck`. It closes nothing.

**Hands forward:** one comment, `## Wave check`, with one line per sentence and, except for
**Waits for the end**, what was tried. Three readers use it:

- the Slicer: `missedSinceNote` turns each miss after the last Wave note into an owed `moves` entry,
  and refuses a Wave that leaves one out (`owedMoves`). The comment is also part of the Spec's
  comments the Slicer reads, newest first, under a 16 KB cap;
- the next wave check, which retries each **Not tried yet** sentence and reads each miss to catch a
  repeat (`unexercisedIn`, `missedIn`);
- the Done check, which marks the Spec `stuck` when a sentence missed at the last wave check
  misses again at the end (`fixWave`).

It hands forward **no names, no decisions and no files.** Names and decisions go forward in the
Decisions record: Picks while their ticket is open, cut to Shipped names once it merges, and copied
into each ticket that cites them. Files go forward nowhere: the record names no path by rule, the
Slicer reads the merged diffs under a 48 KB cap, and each builder reads the repo.

**Example, from Lumaria#902 in S2.** The
[Wave 7 check](https://github.com/collod873/Lumaria/issues/902#issuecomment-6031639071) held
sentences 11 and 22 and missed 21. The
[Wave 8 note](https://github.com/collod873/Lumaria/issues/902#issuecomment-6031678134) carries
`moves: 21` and files #961 to make it triable. The
[Wave 8 check](https://github.com/collod873/Lumaria/issues/902#issuecomment-6037258370) held 21.
The ticket the miss produced is the same #961 whose rewrite then waited 5 h 50 min on the owner
and held Wave 9. Its names reached Wave 9 through the record (#969 cites the Shipped name #961
shipped), not through the wave check.

Across S2's five wave checks, two missed a sentence and so changed the next slice (Wave 4 missed
17, Wave 7 missed 21). One (Wave 6) gave its only sentence **Not tried yet**, a 14 min check that
showed nothing. Waves 9 and 10 moved no sentence, since what they build needs the owner's live
processor account, so no wave check ran.

## A hole found on the way

The closer wakes a `waiting` ticket by the first reason it finds. If the ticket ever carried a
split comment, `wokenWaiting` judges it only by its split pieces. [#973](https://github.com/collod873/Lumaria/issues/973)
was split (14:06), woken when its piece merged (14:36), then marked `waiting` on a Machine fault,
[#1223](https://github.com/collod873/claude-workflow/issues/1223), at 14:39. At 14:49 an unrelated
merge woke it again with "Every ticket #973 was split into has closed". #1223 did not merge until
16:28. That build happened to land green, but the wait on the Machine fault was skipped.
