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

const runsRead = (call: string[]) => workflowRunsPathMatcher.test((call[1] ?? "").split("?")[0]);

describe("runIntegrate reads lane 06's immutability verdict before merging", () => {
  it("refuses to merge when lane 06's immutability job failed for this head commit, whatever its own gauntlet said", () => {
    const { calls, closeCalls, deps, dispatches } = integrateHarness({
      verifyRuns: [{ jobs: [{ name: IMMUTABILITY_JOB, conclusion: "failure" }] }],
    });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual({ merged: false, reason: "immutable-set" });
    expect(mergeCalls(calls)).toEqual([]);
    expect(dispatches).toEqual([]);
    expect(closeCalls).toEqual([]);
  });

  it("reads the verdict against the workflow file it was handed, and that run's jobs by id", () => {
    const { calls, deps } = integrateHarness({ closeTicket: CLOSED });

    runIntegrate(deps);

    const read = calls.find(runsRead);
    expect(read, "no read of the Verify workflow's own run history").toBeDefined();
    expect((read ?? [])[1]).toContain("verify-caller.yml");
    expect(calls.some((call) => runJobsPathMatcher.test(call[1] ?? ""))).toBe(true);
  });

  it("spends nothing on the lookup until its own gauntlet has reported green", () => {
    const lookups = ([1, 2] as const).flatMap((exitCode) => {
      const { calls, deps } = integrateHarness({ gauntlet: { exitCode } });
      runIntegrate(deps);
      return calls.filter(runsRead);
    });

    expect(lookups, "lane 06's run history was read on a run that was never going to merge").toEqual([]);
  });
});

describe("runIntegrate refuses a head commit lane 06 has not judged", () => {
  const UNJUDGED = { merged: false, reason: "unjudged" };

  it("refuses when no dispatch run of the Verify workflow carries this head commit", () => {
    const { calls, deps } = integrateHarness({ verifyRuns: [] });

    const outcome = runIntegrate(deps);

    expect(outcome).toEqual(UNJUDGED);
    expect(mergeCalls(calls)).toEqual([]);
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
      what: "the only run at this commit is the push run, whose immutability job its own gate skipped",
      runs: [{ event: "push", jobs: [{ name: IMMUTABILITY_JOB, conclusion: "skipped" }] }],
    },
    {
      what: "the only dispatch run is for a different head commit",
      runs: [{ headSha: HEAD_SHA, jobs: [{ name: IMMUTABILITY_JOB, conclusion: "success" }] }],
    },
    {
      what: "the run's log names a different pull request",
      runs: [{ judging: "https://github.com/collod873/claude-workflow/pull/999", jobs: BOTH_JOBS_GREEN }],
    },
    {
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
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it("skips a finished run that never named anyone, rather than waiting on it forever", () => {
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

  it("waits for a gate job still running, rather than refusing the pull request for it", () => {
    let reads = 0;
    const { calls, deps, sleeps } = integrateHarness({
      closeTicket: CLOSED,
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
