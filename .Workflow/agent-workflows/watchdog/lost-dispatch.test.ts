import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { GhExec } from "../shared/gh";
import { countLostDispatch, SLICEABLE_LABEL, SLICING_WORKFLOW_FILE } from "./lost-dispatch-counter";
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
 * count, the slicing lane's run history, the standing-issue listing, and the write — and records
 * every argv, so a test can assert "wrote nothing" by the recording staying empty rather than by
 * assuming it. Same shape as `run-watchdog.test.ts`'s own `fakeGh`.
 */
function fakeGh(options: {
  prd?: { title?: string; createdAt?: string; labels?: string[] };
  subIssueCount?: number;
  runs?: Array<{ status?: string; created_at?: string }>;
  standing?: Array<{ number: number; state: string; body: string; comments?: Array<{ body: string }> }>;
}): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const prdData = { title: "A spec", createdAt: "2026-08-20T00:00:00Z", labels: ["sliceable"], ...options.prd };

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
    if (args[0] === "issue" && args[1] === "list") {
      const standing = (options.standing ?? []).map((issue) => ({ ...issue, comments: issue.comments ?? [] }));
      return JSON.stringify(standing);
    }
    if (args[0] === "issue" && args[1] === "create") return "https://github.com/owner/repo/issues/42\n";
    if (args[0] === "issue" && args[1] === "comment") return "";

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls };
}

describe("countLostDispatch", () => {
  it("skips, writing nothing, when the label is not sliceable", () => {
    const fake = fakeGh({});
    const outcome = countLostDispatch({ gh: fake.gh, labelName: "prd", prdNumber: 200, log: () => {} });
    expect(outcome).toEqual({ action: "skipped" });
    expect(fake.calls).toEqual([]);
  });

  it("is clean when the PRD already has sub-issues", () => {
    const fake = fakeGh({ subIssueCount: 4 });
    const outcome = countLostDispatch({ gh: fake.gh, labelName: SLICEABLE_LABEL, prdNumber: 200, log: () => {} });
    expect(outcome).toEqual({ action: "clean" });
  });

  it("is clean when a slicing run has completed since the PRD was opened", () => {
    const fake = fakeGh({
      prd: { createdAt: "2026-08-20T00:00:00Z" },
      subIssueCount: 0,
      runs: [{ status: "completed", created_at: "2026-08-20T12:00:00Z" }],
    });
    const outcome = countLostDispatch({ gh: fake.gh, labelName: SLICEABLE_LABEL, prdNumber: 200, log: () => {} });
    expect(outcome).toEqual({ action: "clean" });
  });

  it("opens the standing issue when none exists yet", () => {
    const fake = fakeGh({ subIssueCount: 0, runs: [], standing: [] });
    const outcome = countLostDispatch({ gh: fake.gh, labelName: SLICEABLE_LABEL, prdNumber: 200, log: () => {} });
    expect(outcome).toEqual({ action: "opened", issue: 42 });

    const createCall = fake.calls.find((call) => call[0] === "issue" && call[1] === "create");
    expect(createCall).toBeDefined();
    const bodyFlag = createCall!.indexOf("--body");
    expect(createCall![bodyFlag + 1]).toContain(FINDING_MARKER);
  });

  it("comments on the standing issue when one is already open, naming a further PRD", () => {
    const fake = fakeGh({
      subIssueCount: 0,
      runs: [],
      standing: [{ number: 55, state: "OPEN", body: `${FINDING_MARKER}\n- [ ] #100 — Another spec: carries \`sliceable\` with no sub-issues and no completed slicing run` }],
    });
    const outcome = countLostDispatch({ gh: fake.gh, labelName: SLICEABLE_LABEL, prdNumber: 200, log: () => {} });
    expect(outcome).toEqual({ action: "commented", issue: 55 });

    const commentCall = fake.calls.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(commentCall).toBeDefined();
    expect(commentCall).toContain("55");
  });

  it("writes nothing further when this PRD is already named on the standing issue", () => {
    const fake = fakeGh({
      subIssueCount: 0,
      runs: [],
      standing: [{ number: 55, state: "OPEN", body: `${FINDING_MARKER}\n${entryLine(finding(prd()))}` }],
    });
    const outcome = countLostDispatch({ gh: fake.gh, labelName: SLICEABLE_LABEL, prdNumber: 200, log: () => {} });
    expect(outcome).toEqual({ action: "already-named", issue: 55 });
    expect(fake.calls.some((call) => call[0] === "issue" && (call[1] === "create" || call[1] === "comment"))).toBe(false);
  });
});

describe("lost-dispatch-counter.yml agrees with the module it runs", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../../../.github/workflows/lost-dispatch-counter.yml"), "utf8");
  const workflow = parse(source) as {
    on: { issues?: { types?: string[] } };
    jobs: { count: { if?: string } };
  };

  it("runs this module", () => {
    expect(source).toContain("npx tsx .Workflow/agent-workflows/watchdog/lost-dispatch-counter.ts");
  });

  it("fires on an issue being labelled", () => {
    expect(workflow.on.issues?.types).toEqual(["labeled"]);
  });

  it("scopes to the sliceable label, matching the module's own constant — no compiler sees across this boundary", () => {
    expect(workflow.jobs.count.if).toBe(`github.event.label.name == '${SLICEABLE_LABEL}'`);
  });

  it("rides the label event rather than a clock, per ADR-0004 — no schedule: trigger", () => {
    expect(source).not.toContain("schedule:");
  });

  it("names the slicing workflow file the module itself reads runs from", () => {
    expect(SLICING_WORKFLOW_FILE).toBe("to-tickets.yml");
  });

  it("grants only the reads and the write this counter needs", () => {
    expect(source).toMatch(/^ {2}contents: read$/m);
    expect(source).toMatch(/^ {2}actions: read$/m);
    expect(source).toMatch(/^ {2}issues: write$/m);
  });
});
