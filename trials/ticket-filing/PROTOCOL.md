# Trial: how a ticket should be filed

Designed 2026-09-18 by session `3a09afd7-d2ef-49c2-9fcc-4ac5b2a9ce7d`, which argued for arm C
throughout. Revised the same day by session `73dbaaee-ede8-4212-90a4-244d6023c649`, which reviewed
it, built the harness and ran the dry run, and is therefore an interested party in the harness
rather than in an arm. Both transcripts are in `collod873/Knowledge-Base` at
`raw/sessions/2026-09-18-3a09afd7.md` and `raw/sessions/2026-09-18-73dbaaee.md`. Read both before
running anything. This file is a summary and loses things.

Amended 2026-09-18 by session `ccdc8da5-db88-42f8-b11c-e4e76c2e3732`, which wrote no arm, ran no
cell and built no harness. It carried the owner's rulings of that day into this file: the subject
changed from the next ticket filed to two the #661 audit already graded, the scope narrowed to the
ticket hop, and historical evidence was re-admitted as a subject while staying barred as a baseline.

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

**Measured, dry run, one data point, superseded by the clean pass below.** The shipped author made 8
tool calls before its first write, on a 3 KB brief for a ticket claiming 2 files. 60 seconds, $0.26.
The brief-as-payload is not stopping exploration even at that size. One run on a ticket that was
later disqualified, so treat it as an indication, not a result.

**Diagnosed and fixed, 2026-09-18.** `session-capture.sh` spawned its child with `>/dev/null 2>&1 &`
and the child died on import for eight days while the run log reported `dispatched` every time. The
install is fixed and 291 sessions are backfilled. The shape is unfiled: a part that discards its
child's output cannot report that it stopped.

**Ruled out by the owner, do not rebuild.** Historical evidence cannot be used. The `## Files
claimed` error rate of 5 in 12, and the ten builds of #661 that lost what was meant, are Old machine
artifacts from a different `file-issue`, a different author and a code system outside the New core.
Any arm that needs an old baseline is disqualified.

**Amended by the owner, 2026-09-18.** That ruling bars an old *baseline*: no arm is scored against a
rate, a grade or a diff the Old machine produced. It does not bar an old *subject*. A ticket the
#661 audit already graded supplies something this trial otherwise lacks - a recorded intent and a
recorded miss - so the question "did the filing carry what was meant" has an answer no owner has to
supply. Arms are compared to each other and to the live floor below, never to what the Old machine
built.

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

## What the clean dry run found, 2026-09-18

Session `f6dcb2a6-b13b-4aa4-8f14-ef6baeeda368` filed the two unfiled findings through the normal door
as [#735](https://github.com/collod873/claude-workflow/issues/735) and
[#736](https://github.com/collod873/claude-workflow/issues/736), then ran all five cells end to end
on the `core/` half, #735's subject. Three fresh contexts wrote the arm bodies, each given the
73dbaaee transcript and its arm's instructions and nothing else; this session executed and measured
and wrote no arm. The owner ruled that C is filed by a trial-only path rather than by prototyping the
`intake` door, so C was posted by the harness with `gh`, outside `file-issue`. Cells A0 737, A1 739,
B 738, B+ 740, C 741. Run order randomised per round.

6. **The harness withheld the transcript from the rewrite pass, and that alone decided arm C.**
   `author.mjs` handed the transcript to the authoring pass and not to the rewrite, though the arms
   table gives B+ and C an author that reads "ticket and transcript" and the rewrite is that author's
   second half. C's first run came back shaped in every respect but one: `## Why` quoted no owner
   words, so `ticketRefusals` refused it and nothing posted. The only place the owner's words existed
   had been taken away before the section that needs them was written. Fixed, and C files on the
   re-run.
7. **A `trim()` blinded the rewrite to its own tests whenever the author edited an existing file.**
   `git status --porcelain` prefixes a modified path with a space, `.stdout.trim()` ate it, `slice(3)`
   then ate the first letter of the path, the read failed into an empty string and the rewrite prompt
   carried an empty code fence. A0, A1, B and B+ all wrote new files, whose `??` prefix survives a
   trim, so only C was hit, and it was hit in both of its first two runs. Fixed. It is the third
   appearance in this trial of the shape #736 is filed for: a part that discards what it could not
   read reports success.
8. **Metric 2 measures nothing once the author has run, and it was flattering C.** Brief bytes at
   author time: C 655, A 19,124, B 21,179. Brief bytes at build time, the only moment a brief is
   handed to a builder: C 35,466, A0 35,362, A1 35,891, B 36,407, B+ 36,310. A 29x spread collapses
   to 3 percent. What the author-time number measured was a ticket with no `## Files claimed` for
   `brief.ts` to widen from, which is the tilt the review called out and the trial has now paid for.
9. **Metric 1 is green everywhere, as finding 3 predicted, and holds as a gate.** In all five cells a
   cold builder handed only the brief turned every criterion green, edited no test file, and touched
   only files the ticket claimed. 24 to 48 seconds, $0.16 to $0.22. Zero discrimination, and the gate
   does its job.
10. **`## Files claimed` is the one metric that discriminated.** A0 and A1 both omit the test file
    their own author had just written. B, B+ and C all name every file touched, exactly. A1 had the
    rewrite pass, with a prompt telling it in terms that it had just written the tests and so knew
    what they touch, and it still omitted the file. So the rewrite alone does not fix the claim, and
    both to-spec's discipline and the transcript do. That is A0 against A1 answered, in the negative.
11. **The two clocks part the way the protocol expected, and further.** The owner's clock: C 38s and
    $0.54 over 6 tool calls, A 239s and $1.86 over 30, B 359s and $2.12 over 25. Unattended, it
    reverses: C is dearest (108s authoring plus 34s rewriting, 15 tool calls) and B+ cheapest (37s
    plus 23s, 6 tool calls). C moves 5 to 9x of the owner's time off his clock and pays about half as
    much again unattended. Totals, owner plus machine: C $1.24 and 213s, A0 $2.32 and 343s, B $2.53
    and 446s, B+ $2.63 and 452s.
12. **Exploration runs against C.** Tool calls before the first edit: A1 3, A0 4, B 4, B+ 4, C 12.
    The thin ticket plus a transcript made the author explore three times as much as a thorough ticket
    did. B+ read a 56 KB transcript on top of a thorough ticket and made the fewest tool calls of any
    cell, so a transcript is not what causes the exploring; having to reconstruct the ticket is.

**Bias control, broken and named.** This session fixed the harness in the middle of the dry run, so
it is now an interested party in the harness exactly as 73dbaaee is. Both fixes are commits, so both
are readable as diffs. Neither touches an arm, and both were needed to make the harness match the
arms table that was already frozen: findings 6 and 7 are the harness contradicting this file, not
this file changing. The five-ticket run in step 2 should be executed by a session that has not
touched `author.mjs` or `builder.mjs`.

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

**What the ticket-hop cut leaves of that list, 2026-09-18.** Not a new ruling, a consequence of the
owner's. A run that stops at the ticket body cannot measure 1, 2 or 3, all of which need a builder.
4 and 5 survive as filing cost alone, both clocks collapsing into one. 6 is replaced by the two
binaries per subject above, which is the point of choosing subjects the #661 audit already graded:
the oracle no longer has to be the owner. The blinded read is not taken. It was designed for a
subject with recorded intent, #735 had none, and the five dry-run diffs it was built for all answer
one finding.

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

## The subjects, and the two floors

Ruled by the owner, 2026-09-18, replacing "the next real ticket you file". The dry run's subject
(#735) had no recorded intent to grade against: the owner never ruled on the `.claude/` write
question, and the blinded read was abandoned for that reason. The subjects below have an oracle
already, from `docs/research/intent-fidelity-2026-09.md`.

Both are ticket-door tickets whose filing session had the owner present, and in both the build did
what the body asked ("Did ticket: yes") and the meaning still did not arrive. The loss is at the
filing.

| ticket | filing session | dropped item | surviving item |
|---|---|---|---|
| #603 | `ca7a2c5c`, 2026-09-16 | the agreed "same command, same JSON, same table" | one place that checks and publishes the ticket graph, old command forwarding to it |
| #586 | `0c62c7f3`, then `4af6f9ae` | a written rule for when one pipeline step hands a fact to the next rather than making it look again | the slicer handed the repo's real top-level folders |

A body is graded on two binaries per subject: does it ask for the dropped item, and does it still ask
for the surviving one. The second stops a body winning by being vague about everything. Both are
written per subject before the first run; grading after the fact voids the subject.

**Ticket hop only.** The owner cut the build hop, 2026-09-18. A run stops when the ticket body
exists. No test author, no builder, no worktrees, no pinned commits, so it does not matter that both
subjects' work lived in `.Workflow/` or that trunk has moved. What this measures is which filing
shape files faithfully, not which gets the right thing built; `intent-fidelity-2026-09.md` puts
build-hop loss at 3 of 16 at the ticket door and 13 of 16 for spec children, so the cut hop is real
and large.

**Two floors.**

| | what it is | run |
|---|---|---|
| historical | the ticket that was really filed, and the audit's grade of it | no, it is a record |
| live | current Core: fat context from the raw transcript, `core/bin/file-issue`, current author | yes |

The historical floor is a control because the history exists, not something to re-execute; the Old
machine's `file-issue` and author are not reproduced. Variants are compared to the live floor.

Two facts qualify the gap between the floors, both measured 2026-09-18. Both historical bodies are
refused by today's `ticketRefusals`: #586 (2,821 bytes) for carrying no `## Why` and an em dash;
#603 (5,031 bytes) for no `## Why`, 7 acceptance criteria rather than 1 to 3, and two `check:`
markers on one criterion. Both predate the `## Why` requirement, so part of any improvement is a
format change that already shipped rather than better synthesis.

**What "fat" costs.** Raw transcripts with tool calls and results, against the stripped Knowledge-Base
summaries every dry-run arm actually read: #586 is 1,632,137 plus 1,581,870 bytes, 3.2 MB and roughly
800K tokens, against 110 KB stripped, 29x. #603 is 896,219 bytes, roughly 220K tokens, against 51 KB.
`core/test-author.ts:8`, `author.mjs:23` and `builder.mjs:21` all hardcode sonnet, whose context
holds neither raw transcript, so the live floor needs a 1M-context model and probably a trim that
keeps message content and tool results and drops the jsonl scaffolding. The post-trim size is a
result, not an implementation detail, and belongs in the record.

## Sequencing

1. Dry run, local, one real ticket, all cells. Done 2026-09-18 on #735's subject, all five cells
   through author, rewrite and a cold builder. It produced findings 6 to 12 and the results are
   above. The harness is shaken out.
2. Stand up the live floor against #603 first, then #586, and put each beside its historical floor.
   #603 is the cheaper subject and carries no handoff variable; #586's intent formed in one session
   and was filed by the next, so that handoff is part of what its cell reproduces. No variants until
   this works.
3. Decide the variants, with both floors in front of the owner. Nothing about the five-cell table
   above is settled once the subject and the scope have changed this much.

Actions was ruled out: the transcripts are in a private repo and this one is public, and the
cross-repo grant is real cost for a five-ticket trial. Local, with this file frozen in git, keeps
every bias control except "the workflow file cannot drift".

## Open questions for the owner

1. **Ruled 2026-09-18.** The dry run files C by a trial-only path, not by prototyping the `intake`
   door. Production C still needs a door, and nothing in the dry run tells you whether it earns its
   place; that decision waits on the result.
2. **Ruled 2026-09-18.** The subjects are #603 and #586, from the #661 audit, not the next ticket
   filed from a real session. Metric 2 and the blinded read fall with the build hop, so the two
   questions that stood here about them are closed.
3. Does the live floor post real issues through `core/post.ts`, as the dry run's cells #737 to #741
   did, or is the body captured before the post? `core/bin/file-issue` validates and then posts;
   there is no mode that stops between.
4. Which model runs the fat cell, and whether the raw jsonl is trimmed or fed whole. The trial has
   run sonnet everywhere and has never been tried on opus, so no arm's exploration figure separates
   the arm from the model.
5. Whether "the filing context must be fat, not fresh" is satisfied by a context that reads a
   transcript in one gulp. It is closer than the 110 KB summary every dry-run arm read, and it is
   still not a session that lived two days.

## The harness

`trials/ticket-filing/author.mjs`. Takes `--ticket`, `--cell`, `--out`, and optional `--transcript`
and `--rewrite`. Replicates `core/test-author.ts`'s brief and prompt construction, adds the
transcript and the rewrite pass, and records the metrics above from the stream. Validates a rewritten
body with `ticketRefusals` before posting it. The transcript reaches both passes, and a cell whose
author has no `## Why` to reproduce is told to write one from the owner's own words in the session
rather than to paraphrase them.

`trials/ticket-filing/builder.mjs`. Takes the same flags, commits the authored tests on `trial/<cell>`,
builds the brief through `core/bin/brief`, hands a cold context that brief and nothing else, and then
runs each criterion's check itself. It records brief bytes at build time, tool calls before the first
edit, the clock, and whether any committed test file changed hash while the builder ran. It stands in
for [#725](https://github.com/collod873/claude-workflow/issues/725), which is unbuilt, and is meant to
be deleted with the rest of `trials/`.

## Not part of this trial, raised and parked

- Collapsing the five-stage relay to builder plus judge.
- A read meter as the enforcer, so the brief becomes a pointer list rather than a payload.
- GitHub merge queue for the Many at once layer.
- A standing reader over transcripts that files the missing enforcer wherever the owner repeated
  himself, posting one weekly line and earning the ticket door only after a dozen good calls.
