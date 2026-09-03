import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { runJobsPathMatcher, workflowRunsPathMatcher } from "../shared/gh-paths";
import {
  BYPASS_STEP,
  BYPASS_THRESHOLD,
  bypassCount,
  bypassRuns,
  COULD_NOT_RUN_STEP,
  countMarker,
  isBypass,
  ISSUE_TITLE,
  issueBody,
  LINT_WORKFLOW_STEP,
  markedCount,
  shouldPropose,
  type VerifyRun,
} from "./bypass";
import { MAX_JOB_READS, runBypassCounter } from "./bypass-counter";
import { answerTrackerOrThrow } from "./signal-tracker.fixture";
import evidence from "./verify-runs.evidence.json";

interface EvidenceRun {
  id: number;
  conclusion: string;
  head_branch: string;
  created_at: string;
  html_url: string;
  failed_step: string | null;
}

const EVIDENCE: EvidenceRun[] = evidence;

function asVerifyRun(run: EvidenceRun): VerifyRun {
  return {
    id: run.id,
    headBranch: run.head_branch,
    createdAt: run.created_at,
    htmlUrl: run.html_url,
    conclusion: run.conclusion,
    failedStep: run.failed_step ?? undefined,
  };
}

function run(overrides: Partial<VerifyRun> = {}): VerifyRun {
  const id = overrides.id ?? 1;
  return {
    id,
    headBranch: "main",
    createdAt: "2026-08-26T12:00:00Z",
    htmlUrl: `https://github.com/owner/repo/actions/runs/${id}`,
    conclusion: "failure",
    failedStep: BYPASS_STEP,
    ...overrides,
  };
}

describe("the rule, run over verify.yml's real run history", () => {
  it("has history to run over, so a green suite is not an empty sweep", () => {
    expect(EVIDENCE.length).toBeGreaterThan(30);
  });

  it("counts exactly 4 Gauntlet-step failures, and 0 attributed to Gauntlet could not run or Lint workflow files", () => {
    const runs = EVIDENCE.map(asVerifyRun);

    expect(bypassCount(runs)).toBe(4);

    const couldNotRun = runs.filter((each) => each.failedStep === COULD_NOT_RUN_STEP);
    const lintWorkflow = runs.filter((each) => each.failedStep === LINT_WORKFLOW_STEP);
    expect(couldNotRun.length).toBe(0);
    expect(lintWorkflow.length).toBe(2);

    expect(couldNotRun.filter(isBypass)).toEqual([]);
    expect(lintWorkflow.filter(isBypass)).toEqual([]);
  });

  it("excludes the two real non-main failures in the fixture regardless of their step name", () => {
    const runs = EVIDENCE.map(asVerifyRun);
    const offMain = runs.filter((each) => each.headBranch !== "main" && each.conclusion === "failure");

    expect(offMain.length).toBeGreaterThan(0);
    for (const each of offMain) expect(isBypass(each), `run ${each.id} on ${each.headBranch} was counted`).toBe(false);
  });
});

describe("isBypass", () => {
  it("takes a Gauntlet-step failure on main", () => {
    expect(isBypass(run())).toBe(true);
  });

  it("leaves a run that failed at a different step", () => {
    expect(isBypass(run({ failedStep: COULD_NOT_RUN_STEP }))).toBe(false);
    expect(isBypass(run({ failedStep: LINT_WORKFLOW_STEP }))).toBe(false);
    expect(isBypass(run({ failedStep: undefined }))).toBe(false);
  });

  it("leaves a Gauntlet-step failure off main", () => {
    expect(isBypass(run({ headBranch: "some-pr-branch" }))).toBe(false);
  });

  it("leaves a run that did not fail, even if a prior sweep recorded a failed step", () => {
    expect(isBypass(run({ conclusion: "success" }))).toBe(false);
  });
});

describe("bypassCount and shouldPropose", () => {
  it("is 0 for a history with no Gauntlet-step failures", () => {
    expect(bypassCount([run({ failedStep: LINT_WORKFLOW_STEP }), run({ id: 2, conclusion: "success", failedStep: undefined })])).toBe(0);
  });

  it("does not propose below the threshold, and does propose at it", () => {
    expect(shouldPropose(BYPASS_THRESHOLD - 1)).toBe(false);
    expect(shouldPropose(BYPASS_THRESHOLD)).toBe(true);
    expect(shouldPropose(BYPASS_THRESHOLD + 1)).toBe(true);
  });
});

describe("the marker", () => {
  it("round-trips the count it was written with", () => {
    expect(markedCount(countMarker(4))).toBe(4);
    expect(markedCount(countMarker(0))).toBe(0);
  });

  it("is undefined for a body that carries none", () => {
    expect(markedCount("just some issue body")).toBeUndefined();
  });

  it("is stable across counts, so two different counts are two different markers", () => {
    expect(countMarker(3)).not.toBe(countMarker(4));
  });
});

describe("the signal body", () => {
  it("names the count, links the runs, and states the proposal", () => {
    const runs = [run({ id: 10 }), run({ id: 11, failedStep: LINT_WORKFLOW_STEP }), run({ id: 12 })];
    const body = issueBody(runs);

    expect(body).toContain("**2**");
    expect(body).toContain("actions/runs/10");
    expect(body).toContain("actions/runs/12");
    expect(body).not.toContain("actions/runs/11");
    expect(body).toContain("move 10");
    expect(body).toContain(countMarker(2));
  });

  it("says what it does not count", () => {
    const body = issueBody([run()]);
    expect(body).toContain(COULD_NOT_RUN_STEP);
    expect(body).toContain(LINT_WORKFLOW_STEP);
  });
});

interface FakeRun {
  id: number;
  conclusion: string;
  headBranch?: string;
  createdAt?: string;
  failedStep?: string;
}

function historyWith(options: {
  runs?: FakeRun[];
  issues?: Array<{ number: number; body: string; state: string; stateReason?: string }>;
}): { gh: GhExec; calls: string[][] } {
  const runs = options.runs ?? [];
  const calls: string[][] = [];

  const gh: GhExec = (args) => {
    calls.push(args);

    if (args[0] === "api" && workflowRunsPathMatcher.test((args[1] ?? "").split("?")[0])) {
      return JSON.stringify(
        runs.map((each) => ({
          id: each.id,
          conclusion: each.conclusion,
          html_url: `https://github.com/owner/repo/actions/runs/${each.id}`,
          head_branch: each.headBranch ?? "main",
          created_at: each.createdAt ?? "2026-08-26T12:00:00Z",
        })),
      );
    }

    const jobsMatch = (args[1] ?? "").match(runJobsPathMatcher);
    if (args[0] === "api" && jobsMatch) {
      const runId = Number(jobsMatch[1]);
      const stepName = runs.find((each) => each.id === runId)?.failedStep;
      return JSON.stringify({
        jobs: [{ steps: stepName ? [{ name: stepName, conclusion: "failure" }] : [{ name: "Some other step", conclusion: "success" }] }],
      });
    }

    return answerTrackerOrThrow(args, options.issues ?? []);
  };

  return { gh, calls };
}

const VERIFY_WORKFLOW = "verify-caller.yml";

function gauntletFailures(count: number): FakeRun[] {
  return Array.from({ length: count }, (_, index) => ({ id: 100 + index, conclusion: "failure", failedStep: BYPASS_STEP }));
}

describe("runBypassCounter", () => {
  it("opens no issue below a count of 3", () => {
    const fake = historyWith({ runs: gauntletFailures(2) });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW });

    expect(outcome).toMatchObject({ code: "below-threshold", count: 2 });
    expect(fake.calls.some((argv) => argv[0] === "issue")).toBe(false);
  });

  it("opens one at a count of 3, assigned so it arrives rather than waits", () => {
    const fake = historyWith({ runs: gauntletFailures(3) });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW });

    expect(outcome).toMatchObject({ code: "proposed", count: 3, issue: 42, wrote: "opened" });
    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create")!;
    expect(create[create.indexOf("--title") + 1]).toBe(ISSUE_TITLE);
    expect(create[create.indexOf("--assignee") + 1]).toBe("collod873");
    expect(create[create.indexOf("--body") + 1]).toContain(countMarker(3));
  });

  it("does not double-propose while a proposal already stands open", () => {
    const fake = historyWith({
      runs: gauntletFailures(4),
      issues: [{ number: 7, body: `earlier\n${countMarker(3)}`, state: "OPEN" }],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW });

    expect(outcome).toMatchObject({ code: "already-proposed", count: 4 });
    expect(fake.calls.some((argv) => argv[1] === "create")).toBe(false);
  });

  it("does not re-propose a declined proposal at the same count it was declined at", () => {
    const fake = historyWith({
      runs: gauntletFailures(3),
      issues: [{ number: 7, body: `declined\n${countMarker(3)}`, state: "CLOSED" }],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW });

    expect(outcome).toMatchObject({ code: "declined-and-not-grown", count: 3 });
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] !== "list")).toBe(false);
  });

  it("re-proposes a declined proposal once the count has grown past what it recorded", () => {
    const fake = historyWith({
      runs: gauntletFailures(4),
      issues: [{ number: 7, body: `declined\n${countMarker(3)}`, state: "CLOSED", stateReason: "COMPLETED" }],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW });

    expect(outcome).toMatchObject({ code: "proposed", count: 4, issue: 42, wrote: "opened" });
    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create")!;
    expect(create[create.indexOf("--body") + 1]).toContain(countMarker(4));
  });

  it("never re-proposes past a proposal closed as not planned, however far the count grows", () => {
    const fake = historyWith({
      runs: gauntletFailures(40),
      issues: [{ number: 131, body: `refused\n${countMarker(4)}`, state: "CLOSED", stateReason: "NOT_PLANNED" }],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW });

    expect(outcome).toMatchObject({ code: "declined-for-good", count: 40 });
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create")).toBe(false);
  });

  it("still counts while refused, so the measurement that would change the ruling survives", () => {
    const fake = historyWith({
      runs: [...gauntletFailures(9), { id: 900, conclusion: "failure", failedStep: COULD_NOT_RUN_STEP }],
      issues: [{ number: 131, body: `refused\n${countMarker(4)}`, state: "CLOSED", stateReason: "NOT_PLANNED" }],
    });

    expect(runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW }).count).toBe(9);
  });

  it("does not count a Gauntlet failure off main", () => {
    const fake = historyWith({ runs: gauntletFailures(3).map((each) => ({ ...each, headBranch: "some-pr-branch" })) });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW });

    expect(outcome).toMatchObject({ code: "below-threshold", count: 0 });
  });

  it("does not count Gauntlet could not run or Lint workflow files toward the threshold", () => {
    const fake = historyWith({
      runs: [
        ...gauntletFailures(2),
        { id: 200, conclusion: "failure", failedStep: COULD_NOT_RUN_STEP },
        { id: 201, conclusion: "failure", failedStep: LINT_WORKFLOW_STEP },
      ],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW });

    expect(outcome).toMatchObject({ code: "below-threshold", count: 2 });
  });

  it("asks for the workflow file it was handed rather than one of its own choosing", () => {
    const fake = historyWith({ runs: gauntletFailures(1) });

    runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: "some-other-caller.yml" });

    const runsRead = fake.calls.find((argv) => argv[0] === "api" && workflowRunsPathMatcher.test((argv[1] ?? "").split("?")[0]))!;
    expect(runsRead[1]).toContain("some-other-caller.yml");
    expect(runsRead[1]).not.toContain("verify.yml");
  });

  it("caps how many job reads one sweep spends, and says how many it held back", () => {
    const runs = gauntletFailures(MAX_JOB_READS + 5);
    const fake = historyWith({ runs });
    const lines: string[] = [];

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", verifyWorkflow: VERIFY_WORKFLOW, log: (line) => lines.push(line) });

    expect(outcome.count).toBe(MAX_JOB_READS);
    expect(lines.some((line) => line.includes("went unread"))).toBe(true);
  });
});

describe("bypassRuns", () => {
  it("returns the runs, not just the count, so the caller can build a body from them", () => {
    const bypass = run({ id: 5 });
    const others = [run({ id: 6, failedStep: LINT_WORKFLOW_STEP }), run({ id: 7, headBranch: "pr" })];

    expect(bypassRuns([bypass, ...others])).toEqual([bypass]);
  });
});
