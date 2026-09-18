# Trial: how a ticket should be filed

Designed 2026-09-18 by session `3a09afd7-d2ef-49c2-9fcc-4ac5b2a9ce7d`, which argued for arm C
throughout. Revised the same day by session `73dbaaee-ede8-4212-90a4-244d6023c649`, which reviewed
it, built the harness and ran the dry run, and is therefore an interested party in the harness
rather than in an arm. Both transcripts are in `collod873/Knowledge-Base` at
`raw/sessions/2026-09-18-3a09afd7.md` and `raw/sessions/2026-09-18-73dbaaee.md`. Read both before
running anything. This file is a summary and loses things.

Session capture was broken from 2026-09-10 to 2026-09-18 and is now fixed and backfilled, so those
transcripts exist. The `## User Prompts` section is not enough on its own: the owner often answers
only "yes" or "I agree", and the intent is in what he agreed to.

## The question

`file-issue ticket` compresses a long session into a short prose body, and the compression is done
by the most degraded participant in the conversation with no check on what it dropped. Everything
downstream pays to recover what that step lost. The trial asks which filing shape hands a builder
the easiest job.

## Findings

**Verified, repo facts.** `/to-spec` makes its draft hunt a sentence that admits two implementations
and a claim nobody could observe, and forbids narrowing in terms. `file-issue ticket` has shape
validation but no synthesis and no critique, so it validates the container and never asks whether
the contents survived. The charter's enforcer for "an agent is handed what it needs" is the brief's
size cap plus a meter on reads outside the brief; `parts.ts` registers `core/bin/brief` and no
meter, so half the enforcer is unbuilt. A spec carries exactly one criterion by rule, so several
unrelated tickets out of one session are not a spec; the unit binding them is the transcript.

**Measured, 2026-09-18, and it corrects the original figure.** Stripped transcripts for this repo
run a median of 29 KB, p90 70 KB, max 180 KB across 129 sessions. The original protocol's "14 KB, a
cheap read" came from one outlier and is optimistic by 2x at the median and 5x at p90. Still cheap
in absolute terms, but arm C's cost case rests on this number.

**Measured, dry run, one data point.** The shipped author made 8 tool calls before its first write,
on a 3 KB brief for a ticket claiming 2 files. 60 seconds, $0.26. The brief-as-payload is not
stopping exploration even at that size. One run on a ticket that was later disqualified, so treat it
as an indication, not a result.

**Diagnosed and fixed, 2026-09-18.** `session-capture.sh` spawned its child with `>/dev/null 2>&1 &`
and the child died on import for eight days while the run log reported `dispatched` every time. The
install is fixed and 291 sessions are backfilled. The shape is unfiled: a part that discards its
child's output cannot report that it stopped.

**Ruled out by the owner, do not rebuild.** Historical evidence cannot be used. The `## Files
claimed` error rate of 5 in 12, and the ten builds of #661 that lost what was meant, are Old machine
artifacts from a different `file-issue`, a different author and a code system outside the New core.
Any arm that needs an old baseline is disqualified.

**Unsupported, and still unsupported.** That the five-stage relay's handoffs cost enough to justify
collapsing them. That a shared reader over one transcript beats one reader per ticket. That slicing
in tests makes wave order a topological sort. That a thin ticket plus a transcript pointer beats a
thorough prose body. The trial tests the last one only.

## What the dry run found, 2026-09-18

These forced the revision below. All verified by running, not by reading.

1. **Arm C cannot be filed, and two independent guards say so.** `core/ticket-shape.ts` refuses a
   thin body on three counts, and a `validate-bash` hook blocks `gh issue create` outright. The
   protocol framed C as a smaller ask of the degraded session. Its real cost is giving up the
   filing-time gates, including red-at-filing, which is what guarantees a failing test exists before
   a build. C does not remove that validation, it moves it to the author. Running C in production
   means a sanctioned intake door, not a bypass.
2. **No ticket whose files live under `.claude/` can be used.** A spawned author is refused writes
   there unless it passes `--permission-mode bypassPermissions`, which `core/test-author.ts` does
   not. The stage then ends red saying the criterion had no failing test, which reads like a bad
   ticket rather than a blocked stage. That is a live defect in #723, not a trial artifact.
3. **Metric 1 lost its oracle when the historical baseline was disqualified.** It was red on the
   parent commit and green on the merge commit, graded by history no arm could touch. It is now each
   arm grading a builder against its own tests, which rewards weak tests and will likely return green
   everywhere. The claim that it is the metric no prompt can flatter did not survive the owner's
   correction and is withdrawn.
4. **Metric 3 and an unmodified control are mutually exclusive.** `claude --print` leaves no
   transcript, so tool calls cannot be recovered afterwards. Counting them needs
   `--output-format stream-json` on the spawn, so the control becomes shipped logic, instrumented.
5. **Each cell needs its own worktree and a symlinked `node_modules`**, because `core/bin/test-author`
   creates and commits `ticket/<n>`.

## The arms

Five cells. Every cell's author may rewrite the ticket body after writing its tests, except A0. The
rewrite is barred from touching `## Why`, which is the owner's own words, and is bound by to-spec's
rule: sharpen, never remove. A rewrite that fails `ticketRefusals` is recorded as a failure and not
posted.

| cell | live session files | author reads | author rewrites ticket |
|---|---|---|---|
| A0 | today's ticket | ticket | no, status quo floor |
| A1 | today's ticket | ticket | yes |
| B | to-spec thorough | ticket | yes |
| B+ | to-spec thorough | ticket and transcript | yes |
| C | sentence and session id | ticket and transcript | yes |

Thin plus ticket-only is not run, because the author would have nothing.

Each neighbouring pair isolates one thing. A0 against A1: does letting the author own the ticket fix
it by itself, which if true makes the rest moot. A1 against B: is to-spec's discipline worth
anything at filing time. B against B+: does the transcript add anything on top of synthesis. B+
against C: does synthesis add anything on top of the transcript, which decides whether the fat
session should do any work at all.

## What is measured

The owner's ruling, 2026-09-18: everything is recorded, nothing is weighted in advance, and the call
is made by owner and agent together with the table in front of them. No pre-registered kill number,
because n=5 on a fuzzy outcome makes a binary threshold false precision.

1. Green from a cold builder handed only the brief. A gate, not a score: see finding 3.
2. Brief bytes, from `core/bin/brief`.
3. Tool calls before the first edit, counted from the stream.
4. The clock, in two columns that move in opposite directions: what filing cost the owner, and what
   the author plus builder cost unattended.
5. Tokens and dollars.
6. The owner, blinded: diffs with arm labels stripped and shuffled. Which did what he meant.

**Bias control on the joint call.** The results table is handed to the owner with the arm labels
stripped. He reads it, then he is told which column was which.

## Bias controls

- Freeze this file in git before the first run. The original said so and it was never done; the file
  sat untracked on disk through the whole dry run.
- The arms run blind to each other, in separate worktrees. Run order is randomised per round. The
  original said run C last as a bias control; that is backwards, because isolated contexts cannot
  contaminate each other by order, while the orchestrator and the owner understand the ticket better
  by the third run.
- **No session writes an arm it also executes or evaluates.** Session 3a09afd7 designed the arms.
  Session 73dbaaee reviewed them and built the harness, and wrote the dry run's A and B bodies, which
  it should not have. A fresh context files each arm, given only the session transcript and that
  arm's instructions. The executing session measures and never authors.
- **The filing context must be fat, not fresh.** This is the largest realism gap and it runs against
  C. The premise is that filing is done by the most degraded participant. A fresh context at full
  capacity files better than production ever will, which understates the gap C exists to close. The
  faithful answer is to run the trial at the ends of real sessions, by those sessions. The
  approximation, if that is too slow, is to hand the filing context the transcript as its only input
  and tell it to file as if it were ending that session.
- State the asymmetry: A is a shipped system, B and C are prompts written in an afternoon.

## Sequencing

1. Dry run, local, one real ticket, all cells. Partly done 2026-09-18; it disqualified its own
   subject and produced the five findings above. Needs one clean end-to-end pass on a `core/` ticket.
2. Run the remaining tickets at the ends of real sessions, local, against this frozen file.

Actions was ruled out: the transcripts are in a private repo and this one is public, and the
cross-repo grant is real cost for a five-ticket trial. Local, with this file frozen in git, keeps
every bias control except "the workflow file cannot drift".

## Open questions for the owner

1. Whether to prototype the `intake` door so arm C is testable at all. Without it the trial runs four
   cells and C stays a hypothesis. With it, a small real thing gets built to test whether it is
   wanted, which is backwards from how this repo normally works.
2. Which tickets, chosen as they arise from real sessions, all outside `.claude/`.

## The harness

`trials/ticket-filing/author.mjs`. Takes `--ticket`, `--cell`, `--out`, and optional `--transcript`
and `--rewrite`. Replicates `core/test-author.ts`'s brief and prompt construction, adds the
transcript and the rewrite pass, and records the metrics above from the stream. Validates a rewritten
body with `ticketRefusals` before posting it.

## Not part of this trial, raised and parked

- Collapsing the five-stage relay to builder plus judge.
- A read meter as the enforcer, so the brief becomes a pointer list rather than a payload.
- GitHub merge queue for the Many at once layer.
- A standing reader over transcripts that files the missing enforcer wherever the owner repeated
  himself, posting one weekly line and earning the ticket door only after a dozen good calls.
