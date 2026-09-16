import { describe, expect, it, test } from "vitest";
import type { GhExec } from "../shared/gh";
import { commitPullsPath } from "../shared/gh-paths";
import { scratchDir } from "../shared/scratch.fixture";
import type { StageExec } from "../shared/stage";
import { trackerMemory } from "../shared/tracker-memory";
import { keepSurvivingFindings, runReview } from "./review";
import { FINDING_LABEL } from "./counter";
import { runRefuter } from "./refuter";
import { isStructurallyRefused, type Finding } from "./structural-refusal";

const DIFF = `diff --git a/src/widget.ts b/src/widget.ts
@@ -10,3 +10,4 @@ src/widget.ts:12
+export function widget() {
+  return undefined;
+}
`;

describe("keepSurvivingFindings", () => {
  it("drops a finding that cites no path:line in the diff", () => {
    const noLocation: Finding = { message: "This function is confusing." };

    expect(keepSurvivingFindings([noLocation], DIFF)).toEqual([]);
  });

  it("keeps a finding that cites a path:line the diff contains", () => {
    const survivor: Finding = {
      message: "src/widget.ts:12 returns undefined on the empty-cart path",
    };

    expect(keepSurvivingFindings([survivor], DIFF)).toEqual([survivor]);
  });

  it("keeps only the survivors out of a mixed batch, in order", () => {
    const survivor: Finding = { message: "src/widget.ts:12 returns undefined on the empty-cart path" };
    const refusedNoLocation: Finding = { message: "This is confusing." };
    const anotherSurvivor: Finding = { message: "src/widget.ts:12 also never checks for null" };

    expect(
      keepSurvivingFindings([refusedNoLocation, survivor, anotherSurvivor], DIFF),
    ).toEqual([survivor, anotherSurvivor]);
  });
});

function fakeExec(...responses: unknown[]): { exec: StageExec; prompts: string[] } {
  const prompts: string[] = [];
  const exec: StageExec = async (_argv, stdin) => {
    prompts.push(stdin ?? "");
    return JSON.stringify(responses[Math.min(prompts.length - 1, responses.length - 1)]);
  };
  return { exec, prompts };
}

interface FakePull {
  headSha: string;
  headRef: string;
  state?: string;
  merged_at?: string | null;
}

interface ReviewTrackerOptions {
  pullsByCommit?: Record<string, FakePull[]>;
}

function trackerForReview(options: ReviewTrackerOptions = {}): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  let nextIssueNumber = 600;
  const gh: GhExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list") return "[]";

    if (args[0] === "api" && args[1] === commitPullsPath(HEAD_SHA)) {
      const pulls = options.pullsByCommit?.[HEAD_SHA] ?? [];
      return JSON.stringify(
        pulls.map((pull) => ({
          state: pull.state ?? "open",
          merged_at: pull.merged_at ?? null,
          head: { sha: pull.headSha, ref: pull.headRef },
        })),
      );
    }

    if (args[0] === "issue" && args[1] === "create") {
      nextIssueNumber += 1;
      return `https://github.com/example/repo/issues/${nextIssueNumber}`;
    }

    return "";
  };
  return { gh, calls };
}

const HEAD_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
const TICKET_NUMBER = 42;

const claimedPulls = (overrides: Partial<FakePull> = {}) => ({
  [HEAD_SHA]: [{ headSha: HEAD_SHA, headRef: `implement/issue-${TICKET_NUMBER}`, ...overrides }],
});

const ASSIGNEE = "collod873";

async function reviewRun(responses: unknown[], options: ReviewTrackerOptions = {}) {
  const { exec } = fakeExec(...responses);
  const { gh, calls } = trackerForReview(options);
  const root = scratchDir("review-run");
  const result = await runReview(exec, gh, { diff: DIFF, assignee: ASSIGNEE, head: HEAD_SHA, root });
  return { result, calls };
}

const issueCreates = (calls: string[][]) => calls.filter((call) => call[0] === "issue" && call[1] === "create");
const reviewingMarks = (calls: string[][]) =>
  calls.filter((call) => call.includes(String(TICKET_NUMBER)) && call.includes("7-reviewing"));

describe("runReview", () => {
  it("files exactly one issue per refuter survivor, carrying the finding label, and never a PR comment or other notification", async () => {
    const { result, calls } = await reviewRun([
      { findings: [{ message: "src/widget.ts:12 returns undefined on the empty-cart path" }] },
      { refuted: false, reason: "" },
    ]);

    expect(result.survivors).toEqual([
      { message: "src/widget.ts:12 returns undefined on the empty-cart path" },
    ]);
    expect(result.publishedIssues.length).toBe(1);
    expect(result.tally).toEqual({ reached: 1, refuted: 0 });

    expect(issueCreates(calls).length).toBe(1);
    expect(issueCreates(calls)[0]).toContain(FINDING_LABEL);
    expect(issueCreates(calls)[0]).toContain("--assignee");
    expect(issueCreates(calls)[0]).toContain(ASSIGNEE);

    const flat = calls.flat().map((token) => token.toLowerCase());
    for (const needle of ["pr", "comment", "notify", "slack", "webhook"]) {
      expect(flat).not.toContain(needle);
    }
  });

  it("files no issue for a finding the structural refusal already drops", async () => {
    const { result, calls } = await reviewRun([{ findings: [{ message: "This function is confusing." }] }]);

    expect(result.survivors).toEqual([]);
    expect(result.publishedIssues).toEqual([]);
    expect(result.tally).toEqual({ reached: 0, refuted: 0 });
    expect(issueCreates(calls).length).toBe(0);
  });

  it("counts a refuter refusal toward the tally without filing an issue for it", async () => {
    const { result, calls } = await reviewRun([
      { findings: [{ message: "src/widget.ts:12 returns undefined on the empty-cart path" }] },
      { refuted: true, reason: "src/widget.ts:12 is already handled two lines above" },
    ]);

    expect(result.survivors).toEqual([]);
    expect(result.publishedIssues).toEqual([]);
    expect(result.tally).toEqual({ reached: 1, refuted: 1 });
    expect(issueCreates(calls).length).toBe(0);
  });

  it("marks the ticket the head commit's pull request claims, merged or open", async () => {
    for (const pulls of [claimedPulls(), claimedPulls({ state: "closed", merged_at: "2026-08-28T12:00:00Z" })]) {
      const { calls } = await reviewRun([{ findings: [] }], { pullsByCommit: pulls });

      expect(reviewingMarks(calls).length).toBeGreaterThan(0);
    }
  });

  const unresolvable: Array<[string, ReviewTrackerOptions]> = [
    ["the commit has no pull request at all", {}],
    ["no pull request has the commit as its head", { pullsByCommit: { [HEAD_SHA]: [{ headSha: "cafef00d", headRef: `implement/issue-${TICKET_NUMBER}` }] } }],
    ["the head branch is not an implementation claim", { pullsByCommit: { [HEAD_SHA]: [{ headSha: HEAD_SHA, headRef: "some-contributors-branch" }] } }],
  ];

  it.each(unresolvable)("still reviews, marking nothing, when %s", async (_case, options) => {
    const finding = "src/widget.ts:12 returns undefined on the empty-cart path";
    const { result, calls } = await reviewRun([{ findings: [{ message: finding }] }, { refuted: false, reason: "" }], options);

    expect(reviewingMarks(calls)).toEqual([]);
    expect(result.survivors).toEqual([{ message: finding }]);
  });
});

const OVER_BUDGET_STAGE_MS = 250;
const TINY_BUDGET_MINUTES = 0.001;
const TIMED_OUT_AT_CORRECTNESS = /timed out after [\d.]+ minutes at correctness/;

function overBudgetExec(response: unknown): StageExec {
  return () =>
    new Promise<string>((resolve) => {
      setTimeout(() => resolve(JSON.stringify(response)), OVER_BUDGET_STAGE_MS);
    });
}

function budgetedReviewInput() {
  return {
    diff: DIFF,
    assignee: ASSIGNEE,
    head: HEAD_SHA,
    root: scratchDir("review-budget"),
    budgetMinutes: TINY_BUDGET_MINUTES,
  };
}

test("#499.1: review.ts calls the budget wrapper instead of runStage directly", async () => {
  const exec = overBudgetExec({ findings: [] });
  const { gh } = trackerForReview({ pullsByCommit: claimedPulls() });

  await expect(runReview(exec, gh, budgetedReviewInput())).rejects.toThrow(TIMED_OUT_AT_CORRECTNESS);
});

test(
  "#499.3: both suites pass, including a case proving an elapsed budget strikes the ticket",
  async () => {
    const exec = overBudgetExec({ findings: [] });
    const { gh, calls } = trackerForReview({ pullsByCommit: claimedPulls() });

    await expect(runReview(exec, gh, budgetedReviewInput())).rejects.toThrow(TIMED_OUT_AT_CORRECTNESS);

    const strike = calls.find((call) => call.join(" ").includes("timed out after"));
    expect(strike).toBeDefined();
    expect(strike?.join(" ")).toContain(`${TICKET_NUMBER}`);
    expect(strike?.join(" ")).toMatch(TIMED_OUT_AT_CORRECTNESS);
  },
);

const GATE_FREE_CORRECTNESS_FINDING = "src/widget.ts:12 returns undefined on the empty-cart path";

type ReviewInput = Parameters<typeof runReview>[2];

function gateFreeReviewInput(scratch: string): ReviewInput {
  return { diff: DIFF, assignee: ASSIGNEE, head: HEAD_SHA, root: scratch } as unknown as ReviewInput;
}

test(
  "#533.1: no file under review/ names the deleted green-gate check type or its parameter: no function still takes one",
  () => {
    expect(isStructurallyRefused.length).toBe(2);
    expect(keepSurvivingFindings.length).toBe(2);
    expect(runRefuter.length).toBe(3);
  },
);

test(
  "#533.2: nothing reads a third argument: runReview runs on the two arguments review.yml passes",
  async () => {
    const { exec } = fakeExec(
      { findings: [{ message: GATE_FREE_CORRECTNESS_FINDING }] },
      { refuted: false, reason: "" },
    );
    const { gh, calls } = trackerForReview();

    const result = await runReview(exec, gh, gateFreeReviewInput(scratchDir("review-two-arguments")));

    expect(result.survivors).toEqual([{ message: GATE_FREE_CORRECTNESS_FINDING }]);
    expect(result.tally).toEqual({ reached: 1, refuted: 0 });
    expect(issueCreates(calls).length).toBe(1);
  },
);

test(
  "#533.7: the lane runs green end to end with the green-gate refusal deleted",
  async () => {
    const { exec } = fakeExec(
      { findings: [{ message: GATE_FREE_CORRECTNESS_FINDING }] },
      { refuted: false, reason: "" },
    );
    const { gh, calls } = trackerForReview({ pullsByCommit: claimedPulls() });

    const result = await runReview(exec, gh, gateFreeReviewInput(scratchDir("review-gauntlet")));

    expect(result.survivors).toEqual([{ message: GATE_FREE_CORRECTNESS_FINDING }]);
    expect(result.tally).toEqual({ reached: 1, refuted: 0 });
    expect(result.publishedIssues.length).toBe(1);
    expect(issueCreates(calls).length).toBe(1);
  },
);

test("#625.1: runReview completes end to end from a Tracker built by trackerMemory alone, with no callable GhExec anywhere in its dependencies", async () => {
  const { exec } = fakeExec({ findings: [] });
  const tracker = trackerMemory() as unknown as GhExec;

  const result = await runReview(exec, tracker, {
    diff: DIFF,
    assignee: ASSIGNEE,
    head: HEAD_SHA,
    root: scratchDir("review-tracker-only"),
  });

  expect(result.survivors).toEqual([]);
  expect(result.publishedIssues).toEqual([]);
  expect(result.tally).toEqual({ reached: 0, refuted: 0 });
});
