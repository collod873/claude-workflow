import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { countLostDispatch, SLICEABLE_LABEL } from "./lost-dispatch-counter";
import { answerTrackerOrThrow } from "./signal-tracker.fixture";
import {
  commentBody,
  entryLine,
  finding,
  FINDING_MARKER,
  isLostDispatch,
  signalBody,
  signalTitle,
  type PrdCandidate,
} from "./lost-dispatch";

function prd(overrides: Partial<PrdCandidate> = {}): PrdCandidate {
  return {
    number: 200,
    title: "PRD: a spec that should have sliced",
    labels: ["prd", "sliceable"],
    subIssueCount: 0,
    hasCompletedSlicingRun: false,
    ...overrides,
  };
}

describe("isLostDispatch", () => {
  it("flags a PRD carrying sliceable with zero sub-issues and no completed slicing run", () => {
    expect(isLostDispatch(prd())).toBe(true);
  });

  it("does not flag a PRD carrying sliceable with sub-issues present", () => {
    expect(isLostDispatch(prd({ subIssueCount: 3 }))).toBe(false);
  });

  it("does not flag a PRD carrying sliceable with a completed slicing run, even with zero sub-issues", () => {
    expect(isLostDispatch(prd({ hasCompletedSlicingRun: true }))).toBe(false);
  });

  it("does not flag a PRD with no sliceable label at all", () => {
    expect(isLostDispatch(prd({ labels: ["prd"] }))).toBe(false);
  });

  it("does not flag a PRD with both a sub-issue and a completed run", () => {
    expect(isLostDispatch(prd({ subIssueCount: 1, hasCompletedSlicingRun: true }))).toBe(false);
  });
});

describe("the signal", () => {
  it("names the PRD in its entry line", () => {
    expect(entryLine(finding(prd()))).toContain("#200");
    expect(entryLine(finding(prd()))).toContain("PRD: a spec that should have sliced");
  });

  it("carries the marker in a fresh issue's body", () => {
    expect(signalBody(finding(prd()))).toContain(FINDING_MARKER);
  });

  it("names the PRD in a fresh issue's body", () => {
    expect(signalBody(finding(prd()))).toContain("#200");
  });

  it("names the PRD in a comment onto the standing issue", () => {
    expect(commentBody(finding(prd()))).toContain("#200");
  });

  it("has a title stable across findings, so a reader recognises the standing issue", () => {
    expect(signalTitle()).toBe(signalTitle());
  });
});

/**
 * A `gh` stand-in that answers the calls `countLostDispatch` makes — the PRD read, the sub-issue
 * count, the slicing lane's run history, the tracker (`answerTracker`, shared with the other
 * watchdog suites) and the comment write — and records every argv, so a test can assert "wrote
 * nothing" by the recording staying empty rather than by assuming it.
 */
function slicingHistoryWith(options: {
  prd?: { title?: string; createdAt?: string; labels?: string[] };
  subIssueCount?: number;
  runs?: Array<{ status?: string; created_at?: string }>;
  standing?: Array<{ number: number; state: string; body: string; comments?: Array<{ body: string }> }>;
}): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const prdData = { title: "A spec", createdAt: "2026-08-20T00:00:00Z", labels: ["sliceable"], ...options.prd };
  const standing = (options.standing ?? []).map((issue) => ({ ...issue, comments: issue.comments ?? [] }));

  const gh: GhExec = (args) => {
    calls.push(args);

    if (args[0] === "issue" && args[1] === "view") {
      return JSON.stringify({ ...prdData, labels: prdData.labels.map((name) => ({ name })) });
    }
    if (args[0] === "api" && (args[1] ?? "").includes("/sub_issues")) {
      return `${options.subIssueCount ?? 0}\n`;
    }
    if (args[0] === "api" && (args[1] ?? "").includes("/runs")) {
      return JSON.stringify((options.runs ?? []).map((run) => ({ status: run.status ?? "completed", created_at: run.created_at ?? "2026-08-21T00:00:00Z" })));
    }
    if (args[0] === "issue" && args[1] === "comment") return "";

    return answerTrackerOrThrow(args, standing);
  };

  return { gh, calls };
}

/**
 * `countLostDispatch` against `fake`, with the fields every case in this describe shares —
 * `prdNumber`, `slicingWorkflow` and a silent `log` — so a scenario supplies only what it varies.
 */
function run(fake: ReturnType<typeof slicingHistoryWith>, labelName: string = SLICEABLE_LABEL): ReturnType<typeof countLostDispatch> {
  return countLostDispatch({ gh: fake.gh, labelName, prdNumber: 200, slicingWorkflow: "to-tickets-caller.yml", log: () => {} });
}

describe("countLostDispatch", () => {
  it("skips, writing nothing, when the label is not sliceable", () => {
    const fake = slicingHistoryWith({});
    const outcome = run(fake, "prd");
    expect(outcome).toEqual({ action: "skipped" });
    expect(fake.calls).toEqual([]);
  });

  it("is clean when the PRD already has sub-issues", () => {
    const fake = slicingHistoryWith({ subIssueCount: 4 });
    expect(run(fake)).toEqual({ action: "clean" });
  });

  it("is clean when a slicing run has completed since the PRD was opened", () => {
    const fake = slicingHistoryWith({
      prd: { createdAt: "2026-08-20T00:00:00Z" },
      subIssueCount: 0,
      runs: [{ status: "completed", created_at: "2026-08-20T12:00:00Z" }],
    });
    expect(run(fake)).toEqual({ action: "clean" });
  });

  it("opens the standing issue when none exists yet", () => {
    const fake = slicingHistoryWith({ subIssueCount: 0, runs: [], standing: [] });
    const outcome = run(fake);
    expect(outcome).toEqual({ action: "opened", issue: 42 });

    const createCall = fake.calls.find((call) => call[0] === "issue" && call[1] === "create");
    expect(createCall).toBeDefined();
    const bodyFlag = createCall!.indexOf("--body");
    expect(createCall![bodyFlag + 1]).toContain(FINDING_MARKER);
  });

  it("comments on the standing issue when one is already open, naming a further PRD", () => {
    const fake = slicingHistoryWith({
      subIssueCount: 0,
      runs: [],
      standing: [{ number: 55, state: "OPEN", body: `${FINDING_MARKER}\n- [ ] #100 — Another spec: carries \`sliceable\` with no sub-issues and no completed slicing run` }],
    });
    const outcome = run(fake);
    expect(outcome).toEqual({ action: "commented", issue: 55 });

    const commentCall = fake.calls.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(commentCall).toBeDefined();
    expect(commentCall).toContain("55");
  });

  it("writes nothing further when this PRD is already named on the standing issue", () => {
    const fake = slicingHistoryWith({
      subIssueCount: 0,
      runs: [],
      standing: [{ number: 55, state: "OPEN", body: `${FINDING_MARKER}\n${entryLine(finding(prd()))}` }],
    });
    const outcome = run(fake);
    expect(outcome).toEqual({ action: "already-named", issue: 55 });
    expect(fake.calls.some((call) => call[0] === "issue" && (call[1] === "create" || call[1] === "comment"))).toBe(false);
  });
});
