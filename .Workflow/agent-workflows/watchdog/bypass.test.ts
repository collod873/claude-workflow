import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * `verify.yml`'s real run history on `main`, captured with the failed step
 * name the counter reads — the shape `push-runs.evidence.json` already has
 * for the run watchdog. ADR-0064's measurement clause asked this counter be
 * measured against the history it would have read before it was built; this
 * is that measurement, as a test.
 */
interface EvidenceRun {
  id: number;
  conclusion: string;
  head_branch: string;
  created_at: string;
  html_url: string;
  failed_step: string | null;
}

const EVIDENCE: EvidenceRun[] = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "verify-runs.evidence.json"), "utf8"),
);

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

    // The fixture is not a fixture with only Gauntlet failures in it — it carries real occurrences
    // of both other step names, which is what makes the exclusion below a real assertion rather than
    // a vacuous one.
    const couldNotRun = runs.filter((each) => each.failedStep === COULD_NOT_RUN_STEP);
    const lintWorkflow = runs.filter((each) => each.failedStep === LINT_WORKFLOW_STEP);
    expect(couldNotRun.length).toBe(0);
    expect(lintWorkflow.length).toBe(2);

    // Neither category contributes to the bypass count, whatever its own size.
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

/**
 * A `gh` stand-in for the IO half's three calls — the workflow's runs page, one job read per failed
 * run, and the issue listing/write — recording every argv verbatim, the same shape
 * `run-watchdog.test.ts`'s own `fakeGh` has.
 */
interface FakeRun {
  id: number;
  conclusion: string;
  headBranch?: string;
  createdAt?: string;
  failedStep?: string;
}

function fakeGh(options: {
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

    if (args[0] === "issue" && args[1] === "list") return JSON.stringify(options.issues ?? []);
    if (args[0] === "issue" && args[1] === "create") return "https://github.com/owner/repo/issues/42\n";

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls };
}

function gauntletFailures(count: number): FakeRun[] {
  return Array.from({ length: count }, (_, index) => ({ id: 100 + index, conclusion: "failure", failedStep: BYPASS_STEP }));
}

describe("runBypassCounter", () => {
  it("opens no issue below a count of 3", () => {
    const fake = fakeGh({ runs: gauntletFailures(2) });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873" });

    expect(outcome).toMatchObject({ code: "below-threshold", count: 2 });
    expect(fake.calls.some((argv) => argv[0] === "issue")).toBe(false);
  });

  it("opens one at a count of 3, assigned so it arrives rather than waits", () => {
    const fake = fakeGh({ runs: gauntletFailures(3) });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873" });

    expect(outcome).toMatchObject({ code: "proposed", count: 3, issue: 42, wrote: "opened" });
    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create")!;
    expect(create[create.indexOf("--title") + 1]).toBe(ISSUE_TITLE);
    expect(create[create.indexOf("--assignee") + 1]).toBe("collod873");
    expect(create[create.indexOf("--body") + 1]).toContain(countMarker(3));
  });

  it("does not double-propose while a proposal already stands open", () => {
    const fake = fakeGh({
      runs: gauntletFailures(4),
      issues: [{ number: 7, body: `earlier\n${countMarker(3)}`, state: "OPEN" }],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873" });

    expect(outcome).toMatchObject({ code: "already-proposed", count: 4 });
    expect(fake.calls.some((argv) => argv[1] === "create")).toBe(false);
  });

  it("does not re-propose a declined proposal at the same count it was declined at", () => {
    const fake = fakeGh({
      runs: gauntletFailures(3),
      issues: [{ number: 7, body: `declined\n${countMarker(3)}`, state: "CLOSED" }],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873" });

    expect(outcome).toMatchObject({ code: "declined-and-not-grown", count: 3 });
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] !== "list")).toBe(false);
  });

  it("re-proposes a declined proposal once the count has grown past what it recorded", () => {
    const fake = fakeGh({
      runs: gauntletFailures(4),
      issues: [{ number: 7, body: `declined\n${countMarker(3)}`, state: "CLOSED", stateReason: "COMPLETED" }],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873" });

    expect(outcome).toMatchObject({ code: "proposed", count: 4, issue: 42, wrote: "opened" });
    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create")!;
    expect(create[create.indexOf("--body") + 1]).toContain(countMarker(4));
  });

  /**
   * ADR-0071: branch protection is declined outright, so the proposal this counter exists to make
   * is settled rather than pending. Growth is an argument already heard and ruled on, and a
   * counter that re-asks on it is the nagging the marker was there to prevent — one notch further
   * out than "not at this count".
   */
  it("never re-proposes past a proposal closed as not planned, however far the count grows", () => {
    const fake = fakeGh({
      runs: gauntletFailures(40),
      issues: [{ number: 131, body: `refused\n${countMarker(4)}`, state: "CLOSED", stateReason: "NOT_PLANNED" }],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873" });

    expect(outcome).toMatchObject({ code: "declined-for-good", count: 40 });
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create")).toBe(false);
  });

  it("still counts while refused, so the measurement that would change the ruling survives", () => {
    const fake = fakeGh({
      runs: [...gauntletFailures(9), { id: 900, conclusion: "failure", failedStep: COULD_NOT_RUN_STEP }],
      issues: [{ number: 131, body: `refused\n${countMarker(4)}`, state: "CLOSED", stateReason: "NOT_PLANNED" }],
    });

    expect(runBypassCounter({ gh: fake.gh, assignee: "collod873" }).count).toBe(9);
  });

  it("does not count a Gauntlet failure off main", () => {
    const fake = fakeGh({ runs: gauntletFailures(3).map((each) => ({ ...each, headBranch: "some-pr-branch" })) });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873" });

    expect(outcome).toMatchObject({ code: "below-threshold", count: 0 });
  });

  it("does not count Gauntlet could not run or Lint workflow files toward the threshold", () => {
    const fake = fakeGh({
      runs: [
        ...gauntletFailures(2),
        { id: 200, conclusion: "failure", failedStep: COULD_NOT_RUN_STEP },
        { id: 201, conclusion: "failure", failedStep: LINT_WORKFLOW_STEP },
      ],
    });

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873" });

    expect(outcome).toMatchObject({ code: "below-threshold", count: 2 });
  });

  it("caps how many job reads one sweep spends, and says how many it held back", () => {
    const runs = gauntletFailures(MAX_JOB_READS + 5);
    const fake = fakeGh({ runs });
    const lines: string[] = [];

    const outcome = runBypassCounter({ gh: fake.gh, assignee: "collod873", log: (line) => lines.push(line) });

    expect(outcome.count).toBe(MAX_JOB_READS);
    expect(lines.some((line) => line.includes("went unread"))).toBe(true);
  });
});

describe("bypass-counter.yml agrees with the module it runs", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const workflow = readFileSync(join(here, "../../../.github/workflows/bypass-counter.yml"), "utf8");

  it("runs this module", () => {
    expect(workflow).toContain("npx tsx .Workflow/agent-workflows/watchdog/bypass-counter.ts");
  });

  it("rides verify.yml completing rather than a clock, per ADR-0004", () => {
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toMatch(/workflows:\s*\["Verify"\]/);
    expect(workflow).not.toContain("schedule:");
  });

  it("grants the reads it needs, and the write the signal is", () => {
    expect(workflow).toMatch(/^ {2}actions: read$/m);
    expect(workflow).toMatch(/^ {2}issues: write$/m);
  });

  it("scopes the job to main, where a bypass reaching trunk actually means something", () => {
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  it("sets every variable the entrypoint reads", () => {
    const source = readFileSync(join(here, "bypass-counter.ts"), "utf8");
    const read = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((match) => match[1]);

    expect(read.length).toBeGreaterThan(0);
    for (const name of new Set(read)) {
      expect(workflow, `bypass-counter.yml never sets ${name}`).toMatch(new RegExp(`^ +${name}:`, "m"));
    }
  });
});

describe("bypassRuns", () => {
  it("returns the runs, not just the count, so the caller can build a body from them", () => {
    const bypass = run({ id: 5 });
    const others = [run({ id: 6, failedStep: LINT_WORKFLOW_STEP }), run({ id: 7, headBranch: "pr" })];

    expect(bypassRuns([bypass, ...others])).toEqual([bypass]);
  });
});
