import { describe, expect, it } from "vitest";
import { runJobsPathMatcher, workflowRunsPathMatcher } from "../shared/gh-paths";
import { GATE_JOB, IMMUTABILITY_JOB, runIntegrate } from "./integrate";
import {
  BOTH_JOBS_GREEN,
  CLOSED,
  GATE_JOB_RED,
  GATE_JOB_RUNNING,
  HEAD_SHA,
  integrateHarness,
  mergeCalls,
  PR,
  prComments,
  TICKET,
  type VerifyRunFixture,
} from "./integrate-harness.fixture";

/**
 * How lane 08 reads lane 06's verdict off the Actions API before it merges (#197, #286,
 * ADR-0104). `verify.yml` run 33227183464 once finished **failure** and `integrate.yml` run
 * 33227183471 merged PR #193 anyway — the two lanes ride the same dispatch in parallel and nothing
 * made the merge actor look. Every ruling here is about what "looking" has to mean: which run,
 * which job, what a job that has said nothing counts as, and how long to wait for one still saying it.
 */

const runsRead = (call: string[]) => workflowRunsPathMatcher.test((call[1] ?? "").split("?")[0]);

describe("runIntegrate reads lane 06's immutability verdict before merging", () => {
  it("refuses to merge when lane 06's immutability job failed for this head commit, whatever its own gauntlet said", () => {
    // The harness's gauntlet is green by default, so this is also the case where the two verdicts
    // disagree — and they are not interchangeable.
    const { calls, closeCalls, deps, dispatches } = integrateHarness({
      verifyRuns: [{ jobs: [{ name: IMMUTABILITY_JOB, conclusion: "failure" }] }],
    });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "immutable-set" });
    expect(mergeCalls(calls)).toEqual([]);
    // Nothing downstream of the merge happens either: no doorbell, no close.
    expect(dispatches).toEqual([]);
    expect(closeCalls).toEqual([]);
  });

  it("reads the verdict against the workflow file it was handed, and that run's jobs by id", () => {
    const { calls, deps } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(deps);

    const read = calls.find(runsRead);
    expect(read, "no read of the Verify workflow's own run history").toBeDefined();
    // `deps.verifyWorkflow`, never a hardcoded `verify.yml` — that file has carried no run of its
    // own since the reusable-workflow split (ADR-0055, amended by ADR-0132).
    expect((read ?? [])[1]).toContain("verify-caller.yml");
    // And the jobs of the run that matched, by id — never a guess from the runs listing alone.
    expect(calls.some((call) => runJobsPathMatcher.test(call[1] ?? ""))).toBe(true);
  });

  it("spends nothing on the lookup until its own gauntlet has reported green", () => {
    // The immutable-set alarm is cheap and this lane's gauntlet is not, but the ordering is the
    // other way round on purpose: lane 06 runs in parallel and would still be starting.
    const lookups = ([1, 2] as const).flatMap((exitCode) => {
      const { calls, deps } = integrateHarness({ gauntlet: { exitCode } });
      runIntegrate(deps);
      return calls.filter(runsRead);
    });

    expect(lookups, "lane 06's run history was read on a run that was never going to merge").toEqual([]);
  });
});

/**
 * The third case ADR-0054 names, and the one that is not "no red check": a head commit lane 06 has
 * not finished judging. A skipped, cancelled, queued or still-running job has said nothing, and
 * `verify.yml`'s own downstream `if: always() && needs.immutability.result != 'failure'` reads a
 * skip as permission to continue — a reading that is right for a job in the same run and wrong for
 * a lane deciding whether to merge.
 */
describe("runIntegrate refuses a head commit lane 06 has not judged", () => {
  const UNJUDGED = { merged: false, reason: "unjudged" };

  it("refuses when no dispatch run of the Verify workflow carries this head commit", () => {
    const { calls, deps } = integrateHarness({ verifyRuns: [] });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual(UNJUDGED);
    expect(mergeCalls(calls)).toEqual([]);
    // Distinct from a failed immutability job, not merely another way to spell "no merge".
    expect(outcome).not.toEqual({ merged: false, reason: "immutable-set" });
  });

  it.each([
    {
      what: "the immutability job is still running",
      runs: [{ jobs: [{ name: IMMUTABILITY_JOB, status: "in_progress", conclusion: null }] }],
    },
    {
      what: "the immutability job was skipped — a skip is not a pass",
      runs: [{ jobs: [{ name: IMMUTABILITY_JOB, conclusion: "skipped" }] }],
    },
    {
      // `verify.yml` also fires on `push: main`, and the push that produced this trunk tip ran at
      // exactly this SHA — with `Immutability` skipped, because that job is gated on the dispatch.
      // Matching on the commit alone would hand this lane that run to read.
      what: "the only run at this commit is the push run, whose immutability job its own gate skipped",
      runs: [{ event: "push", jobs: [{ name: IMMUTABILITY_JOB, conclusion: "skipped" }] }],
    },
    {
      what: "the only dispatch run is for a different head commit",
      runs: [{ headSha: HEAD_SHA, jobs: [{ name: IMMUTABILITY_JOB, conclusion: "success" }] }],
    },
    {
      // Two implementers dispatching off the same trunk tip produce two runs at one sha; the
      // `judging <pr-url> on <branch>` line each prints (ADR-0104) is what tells them apart.
      what: "the run's log names a different pull request",
      runs: [{ judging: "https://github.com/collod873/claude-workflow/pull/999", jobs: BOTH_JOBS_GREEN }],
    },
    {
      // `Immutability` is where the name gets written, so a run whose copy of it has not finished
      // might be this pull request's own re-judge. Reading the older verdict underneath would
      // settle a question the newer run is still answering.
      what: "a newer run has not yet said which pull request it judges",
      runs: [
        { id: 901, jobs: BOTH_JOBS_GREEN },
        { id: 902, jobs: [{ name: IMMUTABILITY_JOB, status: "queued", conclusion: null }] },
      ],
    },
  ] satisfies Array<{ what: string; runs: VerifyRunFixture[] }>)("refuses while $what", ({ runs }) => {
    const { deps } = integrateHarness({ verifyRuns: runs });

    expect(runIntegrate(deps)).toEqual(UNJUDGED);
  });

  it("reads the newest run naming this pull request, so a re-judge supersedes what it re-judged", () => {
    // A fixer's green re-judge shares trunk's sha with the failed run it supersedes; the old
    // strictest-across-runs reading let that failure outvote its own repair forever (#286).
    const { deps } = integrateHarness({
      closeTicket: CLOSED,
      verifyRuns: [
        { id: 901, jobs: GATE_JOB_RED },
        { id: 902, jobs: BOTH_JOBS_GREEN },
      ],
    });

    expect(runIntegrate(deps)).toMatchObject({ merged: true });
  });

  it("a newer failure also supersedes an older pass — newest is newest in both directions", () => {
    const { deps } = integrateHarness({
      verifyRuns: [
        { id: 901, jobs: [{ name: IMMUTABILITY_JOB, conclusion: "success" }] },
        { id: 902, jobs: [{ name: IMMUTABILITY_JOB, conclusion: "failure" }] },
      ],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "immutable-set" });
  });

  it("waits for a re-judge still in flight instead of reading the failure it supersedes", () => {
    // The other half of #286, and the one that survived the newest-run-first fix. A fixer's
    // re-dispatch starts lane 06 and lane 08 together, so by the time this lane has rebased and run
    // the gauntlet the re-judge exists but is minutes from finishing — and `gh run view <run>
    // --log` refuses an unfinished run, so a run-addressed read could not see it and fell through
    // to the completed failure underneath. `Immutability` finishes in seconds and names the pull
    // request, so a job-addressed read recognises the re-judge and waits for it.
    let reads = 0;
    const { deps, sleeps } = integrateHarness({
      closeTicket: CLOSED,
      verifyRuns: () => {
        reads += 1;
        return [
          { id: 901, jobs: GATE_JOB_RED },
          { id: 902, jobs: reads < 4 ? GATE_JOB_RUNNING : BOTH_JOBS_GREEN },
        ];
      },
    });

    expect(runIntegrate(deps)).toMatchObject({ merged: true });
    // It actually waited — reading the superseded failure would have returned a verdict on the
    // first read and merged nothing.
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it("skips a finished run that never named anyone, rather than waiting on it forever", () => {
    // A run cancelled before its `Immutability` job started names nobody and never will. Blocking
    // on that would spend the whole poll budget and refuse a pull request lane 06 has judged.
    const { deps } = integrateHarness({
      closeTicket: CLOSED,
      verifyRuns: [
        { id: 901, jobs: BOTH_JOBS_GREEN },
        { id: 902, status: "completed", jobs: [{ name: IMMUTABILITY_JOB, status: "queued", conclusion: null }] },
      ],
    });

    expect(runIntegrate(deps)).toMatchObject({ merged: true });
  });

  it("resolves the judging run by job, never by run — a run-addressed log read cannot see one in flight", () => {
    const { calls, deps } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(deps);

    const logReads = calls.filter((call) => call[0] === "run" && call[1] === "view");
    expect(logReads).not.toEqual([]);
    for (const read of logReads) expect(read[2]).toBe("--job");
  });
});

/**
 * The ruling on the other half of lane 06, as ADR-0104 leaves it: the `Verify` gate job binds.
 * ADR-0095 waved it through while lane 04's first-authoring was unwired (#201) — the job was red
 * for every pull request then, and binding on it would have stopped the chain rather than caught
 * anything. #201 has landed, so a red one now means the target's gate does not pass against the
 * diff, which is the one thing this lane exists not to merge.
 */
describe("runIntegrate's ruling when only lane 06's gate job is red", () => {
  const GATE_RED: VerifyRunFixture[] = [{ jobs: GATE_JOB_RED }];

  it("refuses the merge", () => {
    const { calls, deps } = integrateHarness({ verifyRuns: GATE_RED });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "gate" });
    expect(mergeCalls(calls)).toEqual([]);
  });

  it("says on the pull request that the job was red, so the refusal is not only a run log", () => {
    const { calls, deps } = integrateHarness({ verifyRuns: GATE_RED });

    runIntegrate(deps);

    const comments = prComments(calls);
    expect(comments).toHaveLength(1);
    expect(comments[0].slice(0, 4)).toEqual(["pr", "comment", PR, "--body"]);
    expect(comments[0][4]).toContain(GATE_JOB);
    // Says what to do about it — a refusal nothing retries has to name its own next step.
    expect(comments[0][4]).toContain("Re-dispatch");
  });

  it("says nothing on the pull request when lane 06 cleared both jobs", () => {
    const { calls, deps } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(deps);

    expect(prComments(calls)).toEqual([]);
  });

  it("still refuses when the explanatory comment itself fails to post", () => {
    const { calls, deps } = integrateHarness({ verifyRuns: GATE_RED, prCommentThrows: true });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "gate" });
    expect(mergeCalls(calls)).toEqual([]);
  });

  /**
   * The race ADR-0104's wait exists for. The gate job is a checkout, an `npm ci` and a suite run —
   * the same order of minutes this lane spends on its own rebase and gauntlet — so a single read
   * can easily catch it mid-run. Reading that as "unjudged" would refuse a pull request for being
   * slow rather than for being wrong.
   */
  it("waits for a gate job still running, rather than refusing the pull request for it", () => {
    let reads = 0;
    const { calls, deps, sleeps } = integrateHarness({
      closeTicket: CLOSED,
      // Green only from the second verdict read on. One verdict read is three lookups — the runs
      // list, the candidate's jobs, its Immutability job's judging log — and this fixture is
      // re-evaluated on each.
      verifyRuns: () => {
        reads += 1;
        return [{ jobs: reads < 4 ? GATE_JOB_RUNNING : BOTH_JOBS_GREEN }];
      },
    });

    expect(runIntegrate(deps)).toEqual({ merged: true, closing: { closed: true, ticket: TICKET } });
    expect(mergeCalls(calls)).toHaveLength(1);
    expect(sleeps.length, "waited between reads rather than spinning on the API").toBeGreaterThan(0);
  });

  it("gives up rather than waiting forever, and a merge is never what giving up produces", () => {
    const { calls, deps, sleeps } = integrateHarness({ verifyRuns: [{ jobs: GATE_JOB_RUNNING }] });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "unjudged" });
    expect(mergeCalls(calls)).toEqual([]);
    expect(sleeps.length, "the wait is bounded").toBeLessThan(100);
  });

  it("still refuses on the immutable set when the gate job is red and the immutability job is too", () => {
    const { deps } = integrateHarness({
      verifyRuns: [
        {
          jobs: [
            { name: IMMUTABILITY_JOB, conclusion: "failure" },
            { name: GATE_JOB, conclusion: "failure" },
          ],
        },
      ],
    });

    expect(runIntegrate(deps)).toEqual({ merged: false, reason: "immutable-set" });
  });
});

describe("runIntegrate reads a run reached through a caller stub", () => {
  it("merges on jobs named with the caller's prefix — verify / Immutability, verify / Verify", () => {
    // A run reached through `uses:` (ADR-0055, amended by ADR-0132) reports every job as
    // `<caller job key> / <job name>` rather than the bare name `verify.yml` itself declares —
    // confirmed on run 33649164483. A `===` match would find neither job here and read `unjudged`
    // forever; `findJobByName` (`shared/job-match.ts`) must still find both.
    const { deps } = integrateHarness({
      closeTicket: CLOSED,
      verifyRuns: [
        {
          jobs: [
            { name: `verify / ${IMMUTABILITY_JOB}`, conclusion: "success" },
            { name: `verify / ${GATE_JOB}`, conclusion: "success" },
          ],
        },
      ],
    });

    expect(runIntegrate(deps)).toEqual({ merged: true, closing: { closed: true, ticket: TICKET } });
  });
});
