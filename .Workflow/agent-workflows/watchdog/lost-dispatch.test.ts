import { describe, expect, it, test } from "vitest";
import { countLostDispatch, SLICEABLE_LABEL } from "./lost-dispatch-counter";
import { historyWithRunSincePrd, slicingHistoryWith } from "./slicing-history.fixture";
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

test.fails("#532.4: PrdCandidate carries a field named for a successful slicing run, which the predicate reads", () => {
  const successful = { ...prd(), hasSuccessfulSlicingRun: true };
  expect(isLostDispatch(successful)).toBe(false);

  const unsuccessful = { ...prd(), hasSuccessfulSlicingRun: false };
  expect(isLostDispatch(unsuccessful)).toBe(true);
});

test.fails("#532.5: the whole gauntlet is green: counter and candidate agree end to end, so a crashed slicing run no longer proves a PRD was sliced", () => {
  expect(run(historyWithRunSincePrd({ status: "completed", conclusion: "failure" }))).toEqual({ action: "opened", issue: 42 });
  expect(run(historyWithRunSincePrd({ status: "completed", conclusion: "success" }))).toEqual({ action: "clean" });
});
