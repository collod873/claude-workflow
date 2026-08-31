# Findings land through the implementation door; the release-PR channel is deleted

Recorded 2026-08-31.

Amends: ADR-0017

A finding that clears the audit lane's two-site gate goes to a **ratifier** — a full-tool stage that
turns it into a lint rule, with every site that rule flags fixed in the same branch, or into a
`CODING_STANDARDS.md` entry, or into a reasoned rejection. The batch lands as one pull request
through the `implementation-opened` dispatch every implementer already uses: judged by lane 06,
merged by lane 08, reviewed after the fact by lane 07. The release-PR channel it replaces — a pull
request only the owner could merge, carrying a checklist only he could tick — is deleted, along with
its bookmark, its workflow and its schema. Ruled by the owner in
[#296](https://github.com/collod873/claude-workflow/issues/296).

## What survives of ADR-0017, and what does not

**Both triggers survive verbatim.** A PRD closing, or N released observations having piled up,
whichever arrives first; N is still 20 and still a number to be measured rather than defended. Every
word ADR-0017 wrote about *why both halves are required* still holds, and there is still no clock
anywhere in it, so [ADR-0004](0004-a-clock-may-release-a-batch-but-may-never-originate-work.md)
holds too.

**What dies is the output shape** — ADR-0017's "released as one decision." The decision was never
made. A checked box wrote a memory record and nothing else: no standard was added, no rule was
written, no site was fixed, and the mechanised half was hard-coded empty because
[#63](https://github.com/collod873/claude-workflow/issues/63) deferred it. What the channel actually
produced was 18 pull requests in five days, ten of them merged inside fifteen minutes on 2026-08-30
at roughly ninety-second intervals — the rubber-stamp shape `GOAL.md` §2 already measured elsewhere,
reproduced by the one mechanism in this pipeline that still asked the owner to press a button.

## Why the existing door, rather than a door of this lane's own

The release channel opened pull requests to `main` through a path of its own, invisible to the bypass
counter — the uncovered class [#294](https://github.com/collod873/claude-workflow/issues/294) was
filed about, and this ruling settles that issue by a third option it did not list: the channel is
gone, and what replaces it rides the judged door.

Nothing downstream of that door assumes lane 05 sent it. The branch is resolved from the pull request
rather than the payload, the ticket from a `Closes #n` regex whose absence is a documented outcome,
and the merge is behind lane 08's own global lock, so a ratifier pull request simply queues behind
implementer ones. The dispatch is sent explicitly, because
[ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)'s token property
means the pull-request event alone would judge nothing.

Two constraints come with that door and both are load-bearing. A batch may not touch the immutable
set, which is what keeps this lane honest about the lesson #294 taught; the composer refuses such a
batch before opening anything. And a dispatch's criteria must verbatim-match a test under trunk's
`tests/acceptance/`, which one standing acceptance test now carries — a ratifier pull request has no
ticket, so it has no ticket's criteria to send.

## Consequences

**The "a release must never trigger another pass" invariant is kept, by a convention that finally has
a writer.** ADR-0017 required the machinery's own commits to be excluded from scope and named no way
of marking them; the filter has read a `Machinery-Commit: true` trailer nothing was stamping. Every
commit the ratifier authors now carries it, so a landing can never feed the next audit's scope. Lane
08 merges with the built-in `GITHUB_TOKEN`, whose pushes start no workflow runs, which closes the
other half of the loop.

**A ratifier pull request draws lane 07's review and the fixer's repairs, like any other.** Both are
side effects of using the shared door and both are wanted: the lens that found a finding is not the
stage that decided it, and neither is the reviewer. A pull request the fixer gives up on goes
`needs-human`, its findings stay unratified, and they re-batch at the next trigger — no memory is
written about a decision nobody made.

**Mechanising is deliberately expensive.** A rule ships with every site it flags already fixed, no
baseline and no warn tier, which is `CODING_STANDARDS.md`'s own "Zero-grandfather rails" applied at
birth. A rule that cannot afford its own refactor is not ratified; it is queued debt, and the stage
is told to choose a prose entry or a rejection instead.
