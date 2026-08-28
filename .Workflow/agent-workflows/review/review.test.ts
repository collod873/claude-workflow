import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { GhExec } from "../shared/gh";
import type { StageExec } from "../shared/stage";
import {
  keepSurvivingFindings,
  runConformanceReview,
  runReview,
  untestedCriteria,
  SPEC_GAP_LABEL,
} from "./review";
import { FINDING_LABEL } from "./counter";
import type { Finding } from "./structural-refusal";

/**
 * Two things this ticket adds: the filter that stands between the reviewer's raw findings and
 * anything downstream, and the workflow trigger that fires the reviewer at all. Each gets its own
 * `describe` because they are independent claims — a broken trigger with a correct filter still
 * ships a lane that never runs, and a correct trigger with a broken filter still floods the owner.
 */

const DIFF = `diff --git a/src/widget.ts b/src/widget.ts
@@ -10,3 +10,4 @@ src/widget.ts:12
+export function widget() {
+  return undefined;
+}
`;

describe("keepSurvivingFindings", () => {
  it("drops a finding that fails either of ADR-0036's structural-refusal conditions", () => {
    const noLocation: Finding = { message: "This function is confusing." };
    const restatesGreen: Finding = {
      message: "src/widget.ts:12 violates no-unused-vars, which eslint already flags",
    };

    expect(keepSurvivingFindings([noLocation, restatesGreen], DIFF, ["no-unused-vars"])).toEqual([]);
  });

  it("keeps a finding that fails neither condition", () => {
    const survivor: Finding = {
      message: "src/widget.ts:12 returns undefined on the empty-cart path",
    };

    expect(keepSurvivingFindings([survivor], DIFF, ["no-unused-vars"])).toEqual([survivor]);
  });

  it("keeps only the survivors out of a mixed batch, in order", () => {
    const survivor: Finding = { message: "src/widget.ts:12 returns undefined on the empty-cart path" };
    const refusedNoLocation: Finding = { message: "This is confusing." };
    const anotherSurvivor: Finding = { message: "src/widget.ts:12 also never checks for null" };

    expect(
      keepSurvivingFindings([refusedNoLocation, survivor, anotherSurvivor], DIFF, []),
    ).toEqual([survivor, anotherSurvivor]);
  });
});

/**
 * `testsForCriteria`'s own fixtures, reused rather than re-forked: `WIDGET` is matched verbatim by
 * `alpha.accept.ts`, so it is covered; `NO_SUCH_CRITERION` matches nothing under this directory, so
 * it is untested.
 */
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../shared/affected-tests.fixtures");
const COVERED_CRITERION = "npm test exits 0 with a widget that spins clockwise";
const UNTESTED_CRITERION = "npm test exits 0 with a criterion no fixture names";

describe("untestedCriteria", () => {
  it("drops a criterion testsForCriteria already found a test naming", () => {
    expect(untestedCriteria([COVERED_CRITERION, UNTESTED_CRITERION], FIXTURES_DIR)).toEqual([
      UNTESTED_CRITERION,
    ]);
  });

  it("keeps every criterion no test under dir names", () => {
    expect(untestedCriteria([UNTESTED_CRITERION], FIXTURES_DIR)).toEqual([UNTESTED_CRITERION]);
  });
});

/** A `StageExec` stand-in that answers with a canned response per call and records every prompt it saw. */
function fakeExec(response: unknown): { exec: StageExec; prompts: string[] } {
  const prompts: string[] = [];
  const exec: StageExec = async (_argv, stdin) => {
    prompts.push(stdin ?? "");
    return JSON.stringify(response);
  };
  return { exec, prompts };
}

/** A `GhExec` stand-in that records every call it received and answers with a canned issue URL. */
function fakeGh(nextIssueNumber = 501): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push(args);
    return `https://github.com/example/repo/issues/${nextIssueNumber}`;
  };
  return { gh, calls };
}

const CONFORMANCE_DIFF = `diff --git a/src/widget.ts b/src/widget.ts
@@ -10,3 +10,4 @@ src/widget.ts:12
+export function widget() {
+  return undefined;
+}
`;

describe("runConformanceReview", () => {
  it("hands the model a prompt with the spec text before the diff text", async () => {
    const fake = fakeExec({ items: [] });
    const { gh } = fakeGh();

    await runConformanceReview(fake.exec, gh, {
      specText: "SPEC-MARKER-9f2",
      diff: "DIFF-MARKER-9f2",
      criteria: [],
      greenGateChecks: [],
      prdIssueNumber: 1,
    });

    const prompt = fake.prompts[0];
    expect(prompt).toContain("SPEC-MARKER-9f2");
    expect(prompt).toContain("DIFF-MARKER-9f2");
    expect(prompt.indexOf("SPEC-MARKER-9f2")).toBeLessThan(prompt.indexOf("DIFF-MARKER-9f2"));
  });

  it("scopes the reviewer to every criterion testsForCriteria did not find a test naming", async () => {
    const fake = fakeExec({ items: [] });
    const { gh } = fakeGh();

    await runConformanceReview(fake.exec, gh, {
      specText: "the spec",
      diff: CONFORMANCE_DIFF,
      criteria: [COVERED_CRITERION, UNTESTED_CRITERION],
      greenGateChecks: [],
      prdIssueNumber: 1,
      acceptanceDir: FIXTURES_DIR,
    });

    const prompt = fake.prompts[0];
    expect(prompt).toContain(UNTESTED_CRITERION);
    expect(prompt).not.toContain(COVERED_CRITERION);
  });

  it("a spec-silent classification produces exactly one spec/gap issue and zero ordinary findings", async () => {
    const fake = fakeExec({
      items: [{ classification: "gap", message: "The spec never says what happens on an empty cart." }],
    });
    const { gh, calls } = fakeGh(777);

    const result = await runConformanceReview(fake.exec, gh, {
      specText: "the spec",
      diff: CONFORMANCE_DIFF,
      criteria: [],
      greenGateChecks: [],
      prdIssueNumber: 42,
    });

    expect(result.findings).toEqual([]);
    expect(result.gapIssues).toEqual([777]);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("--label");
    expect(calls[0]).toContain(SPEC_GAP_LABEL);
    expect(calls[0].join(" ")).toContain("42");
  });

  it("a clear-spec-divergence classification produces the reverse", async () => {
    const fake = fakeExec({
      items: [{ classification: "divergence", message: "src/widget.ts:12 returns undefined instead of the cart total" }],
    });
    const { gh, calls } = fakeGh();

    const result = await runConformanceReview(fake.exec, gh, {
      specText: "the spec",
      diff: CONFORMANCE_DIFF,
      criteria: [],
      greenGateChecks: [],
      prdIssueNumber: 42,
    });

    expect(result.findings).toEqual([
      { message: "src/widget.ts:12 returns undefined instead of the cart total" },
    ]);
    expect(result.gapIssues).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("still filters a divergence item through the structural refusal", async () => {
    const fake = fakeExec({
      items: [{ classification: "divergence", message: "this diverges from the spec somewhere" }],
    });
    const { gh } = fakeGh();

    const result = await runConformanceReview(fake.exec, gh, {
      specText: "the spec",
      diff: CONFORMANCE_DIFF,
      criteria: [],
      greenGateChecks: [],
      prdIssueNumber: 42,
    });

    expect(result.findings).toEqual([]);
  });
});

/**
 * A `GhExec` stand-in wired for `runReview`'s own chain: `issue create` calls (findings, and
 * `runCounter`'s own proposals) get a canned, incrementing issue URL; `issue list` calls (both of
 * `runCounter`'s reads) get an empty JSON array, so the counter's below-threshold path is exercised
 * without needing a fixture tracker.
 */
function fakeReviewGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  let nextIssueNumber = 600;
  const gh: GhExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list") return "[]";
    nextIssueNumber += 1;
    return `https://github.com/example/repo/issues/${nextIssueNumber}`;
  };
  return { gh, calls };
}

describe("runReview", () => {
  it("files exactly one issue per refuter survivor, carrying the finding label, and never a PR comment or other notification", async () => {
    const responses = [
      { findings: [{ message: "src/widget.ts:12 returns undefined on the empty-cart path" }] },
      { refuted: false, reason: "" },
    ];
    let call = 0;
    const exec: StageExec = async () => JSON.stringify(responses[call++]);
    const { gh, calls } = fakeReviewGh();

    const result = await runReview(exec, gh, {
      diff: DIFF,
      greenGateChecks: [],
      assignee: "collod873",
    });

    expect(result.survivors).toEqual([
      { message: "src/widget.ts:12 returns undefined on the empty-cart path" },
    ]);
    expect(result.publishedIssues.length).toBe(1);
    expect(result.tally).toEqual({ reached: 1, refuted: 0 });

    const issueCreateCalls = calls.filter((call) => call[0] === "issue" && call[1] === "create");
    // One for the finding, and (below both counter thresholds) none for a proposal.
    expect(issueCreateCalls.length).toBe(1);
    expect(issueCreateCalls[0]).toContain(FINDING_LABEL);
    expect(issueCreateCalls[0]).toContain("--assignee");
    expect(issueCreateCalls[0]).toContain("collod873");

    const flat = calls.flat().map((token) => token.toLowerCase());
    for (const needle of ["pr", "comment", "notify", "slack", "webhook"]) {
      expect(flat).not.toContain(needle);
    }
  });

  it("files no issue for a finding the structural refusal already drops", async () => {
    const responses = [{ findings: [{ message: "This function is confusing." }] }];
    let call = 0;
    const exec: StageExec = async () => JSON.stringify(responses[call++]);
    const { gh, calls } = fakeReviewGh();

    const result = await runReview(exec, gh, { diff: DIFF, greenGateChecks: [], assignee: "collod873" });

    expect(result.survivors).toEqual([]);
    expect(result.publishedIssues).toEqual([]);
    expect(result.tally).toEqual({ reached: 0, refuted: 0 });
    expect(calls.filter((call) => call[0] === "issue" && call[1] === "create").length).toBe(0);
  });

  it("counts a refuter refusal toward the tally without filing an issue for it", async () => {
    const responses = [
      { findings: [{ message: "src/widget.ts:12 returns undefined on the empty-cart path" }] },
      { refuted: true, reason: "no-unused-vars already covers this" },
    ];
    let call = 0;
    const exec: StageExec = async () => JSON.stringify(responses[call++]);
    const { gh, calls } = fakeReviewGh();

    const result = await runReview(exec, gh, {
      diff: DIFF,
      greenGateChecks: ["no-unused-vars"],
      assignee: "collod873",
    });

    expect(result.survivors).toEqual([]);
    expect(result.publishedIssues).toEqual([]);
    expect(result.tally).toEqual({ reached: 1, refuted: 1 });
    expect(calls.filter((call) => call[0] === "issue" && call[1] === "create").length).toBe(0);
  });
});

const REVIEW_YML_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.github/workflows/review.yml",
);

describe("review.yml's trigger", () => {
  const workflow = parse(readFileSync(REVIEW_YML_PATH, "utf8")) as {
    on: { workflow_run?: { workflows: string[]; types: string[] }; pull_request?: unknown };
    jobs: { review: { if?: string } };
  };

  it("fires on a completed workflow_run of Verify", () => {
    expect(workflow.on.workflow_run).toBeDefined();
    expect(workflow.on.workflow_run?.workflows).toEqual(["Verify"]);
    expect(workflow.on.workflow_run?.types).toEqual(["completed"]);
  });

  it("carries no pull_request trigger", () => {
    expect(workflow.on.pull_request).toBeUndefined();
  });

  it("only reviews a successful conclusion", () => {
    expect(workflow.jobs.review.if).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it("only reviews the Verify run an implementer's dispatch started", () => {
    // `verify.yml` also fires on `push: main`, where `workflow_run.head_sha` is trunk's own tip and
    // `origin/main..head_sha` is empty — so without this the lane spent a reviewer fleet reading
    // nothing on every commit the owner pushed himself.
    expect(workflow.jobs.review.if).toContain(
      "github.event.workflow_run.event == 'repository_dispatch'",
    );
  });

  it("sets the assignee review.ts refuses to run without", () => {
    const job = workflow.jobs.review as unknown as { env?: Record<string, string> };
    expect(job.env?.SIGNAL_ASSIGNEE).toBeDefined();
  });
});
