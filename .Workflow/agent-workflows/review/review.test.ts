import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { commitPullsPathMatcher } from "../shared/gh-paths";
import { scratchDir } from "../shared/scratch.fixture";
import type { StageExec } from "../shared/stage";
import { SPEC_GAP_LABEL } from "../shared/spec-gap";
import {
  keepSurvivingFindings,
  runConformanceReview,
  runReview,
  untestedCriteria,
} from "./review";
import { FINDING_LABEL } from "./counter";
import type { Finding } from "./structural-refusal";

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

const COVERED_CRITERION = "make test exits 0 with a widget that spins clockwise";
const UNTESTED_CRITERION = "make test exits 0 with a criterion no fixture names";
const CONFORMANCE_ISSUE = 1;

function checkoutCoveringIndex(index: number): string {
  const root = scratchDir("review-root");
  mkdirSync(join(root, ".Workflow", "widget"), { recursive: true });
  writeFileSync(
    join(root, ".Workflow", "widget", "widget.test.ts"),
    `it.fails("#${CONFORMANCE_ISSUE}.${index}: spins", () => {});\n`,
  );
  return root;
}

describe("untestedCriteria", () => {
  it("drops a criterion whose index a test already names", () => {
    expect(
      untestedCriteria(CONFORMANCE_ISSUE, [COVERED_CRITERION, UNTESTED_CRITERION], checkoutCoveringIndex(1)),
    ).toEqual([UNTESTED_CRITERION]);
  });

  it("keeps every criterion whose index no test under root names", () => {
    expect(untestedCriteria(CONFORMANCE_ISSUE, [UNTESTED_CRITERION], scratchDir("review-root-bare"))).toEqual([
      UNTESTED_CRITERION,
    ]);
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
  tickets?: Record<number, { title: string; body: string }>;
  firstIssueNumber?: number;
}

function trackerForReview(options: ReviewTrackerOptions = {}): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  let nextIssueNumber = (options.firstIssueNumber ?? 601) - 1;
  const gh: GhExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list") return "[]";

    if (args[0] === "api") {
      const pullsMatch = (args[1] ?? "").match(commitPullsPathMatcher);
      if (pullsMatch) {
        const pulls = options.pullsByCommit?.[pullsMatch[1]] ?? [];
        return JSON.stringify(
          pulls.map((pull) => ({
            state: pull.state ?? "open",
            merged_at: pull.merged_at ?? null,
            head: { sha: pull.headSha, ref: pull.headRef },
          })),
        );
      }
    }

    if (args[0] === "issue" && args[1] === "view") {
      const ticket = options.tickets?.[Number(args[2])];
      if (!ticket) throw new Error(`fake gh: no issue #${args[2]}`);
      return JSON.stringify(ticket);
    }

    if (args[0] === "issue" && args[1] === "create") {
      nextIssueNumber += 1;
      return `https://github.com/example/repo/issues/${nextIssueNumber}`;
    }

    return "";
  };
  return { gh, calls };
}

async function classified(items: unknown[], firstIssueNumber?: number) {
  const fake = fakeExec({ items });
  const { gh, calls } = trackerForReview({ firstIssueNumber });
  const result = await runConformanceReview(fake.exec, gh, {
    specText: "the spec",
    diff: DIFF,
    criteria: [],
    greenGateChecks: [],
    prdIssueNumber: 42,
    ticketNumber: 42,
  });
  return { result, calls };
}

describe("runConformanceReview", () => {
  it("hands the model a prompt with the spec text before the diff text", async () => {
    const fake = fakeExec({ items: [] });
    const { gh } = trackerForReview();

    await runConformanceReview(fake.exec, gh, {
      specText: "SPEC-MARKER-9f2",
      diff: "DIFF-MARKER-9f2",
      criteria: [],
      greenGateChecks: [],
      prdIssueNumber: 1,
      ticketNumber: 1,
    });

    const prompt = fake.prompts[0];
    expect(prompt).toContain("SPEC-MARKER-9f2");
    expect(prompt).toContain("DIFF-MARKER-9f2");
    expect(prompt.indexOf("SPEC-MARKER-9f2")).toBeLessThan(prompt.indexOf("DIFF-MARKER-9f2"));
  });

  it("scopes the reviewer to every criterion no test names by index", async () => {
    const fake = fakeExec({ items: [] });
    const { gh } = trackerForReview();

    await runConformanceReview(fake.exec, gh, {
      specText: "the spec",
      diff: DIFF,
      criteria: [COVERED_CRITERION, UNTESTED_CRITERION],
      greenGateChecks: [],
      prdIssueNumber: CONFORMANCE_ISSUE,
      ticketNumber: CONFORMANCE_ISSUE,
      root: checkoutCoveringIndex(1),
    });

    const prompt = fake.prompts[0];
    expect(prompt).toContain(UNTESTED_CRITERION);
    expect(prompt).not.toContain(COVERED_CRITERION);
  });

  it("a spec-silent classification produces exactly one spec/gap issue and zero ordinary findings", async () => {
    const { result, calls } = await classified(
      [{ classification: "gap", message: "The spec never says what happens on an empty cart." }],
      777,
    );

    expect(result.findings).toEqual([]);
    expect(result.gapIssues).toEqual([777]);

    expect(calls.map((call) => `${call[0]} ${call[1]}`)).toEqual(["label create", "issue create"]);
    const created = calls[1];
    expect(created).toContain("--label");
    expect(created).toContain(SPEC_GAP_LABEL);
    expect(created.join(" ")).toContain("42");
  });

  it("a clear-spec-divergence classification produces the reverse", async () => {
    const { result, calls } = await classified([
      { classification: "divergence", message: "src/widget.ts:12 returns undefined instead of the cart total" },
    ]);

    expect(result.findings).toEqual([
      { message: "src/widget.ts:12 returns undefined instead of the cart total" },
    ]);
    expect(result.gapIssues).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("still filters a divergence item through the structural refusal", async () => {
    const { result } = await classified([
      { classification: "divergence", message: "this diverges from the spec somewhere" },
    ]);

    expect(result.findings).toEqual([]);
  });
});

const HEAD_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
const TICKET_NUMBER = 42;
const PRD_NUMBER = 7;

const claimedPulls = (overrides: Partial<FakePull> = {}) => ({
  [HEAD_SHA]: [{ headSha: HEAD_SHA, headRef: `implement/issue-${TICKET_NUMBER}`, ...overrides }],
});

const SPEC_MARKER = "SPEC-MARKER-4c1";
const CRITERION_MARKER = "make test exits 0 with a criterion no fixture names at all";

const ticketBody = (parent = true) =>
  [
    ...(parent ? ["## Parent PRD", `#${PRD_NUMBER}`, ""] : []),
    "## Acceptance criteria",
    `- [ ] ${CRITERION_MARKER}`,
    "",
  ].join("\n");

const CONFORMANCE_TICKETS = {
  [TICKET_NUMBER]: { title: "the ticket", body: ticketBody() },
  [PRD_NUMBER]: { title: "the PRD", body: `${SPEC_MARKER}\n` },
};

const ASSIGNEE = "collod873";

async function reviewRun(
  responses: unknown[],
  options: ReviewTrackerOptions = {},
  greenGateChecks: string[] = [],
) {
  const { exec, prompts } = fakeExec(...responses);
  const { gh, calls } = trackerForReview(options);
  const root = scratchDir("review-run");
  const result = await runReview(exec, gh, { diff: DIFF, greenGateChecks, assignee: ASSIGNEE, head: HEAD_SHA, root });
  return {
    result,
    calls,
    conformancePrompt: prompts.find((prompt) => prompt.includes(CRITERION_MARKER)),
  };
}

const issueCreates = (calls: string[][]) => calls.filter((call) => call[0] === "issue" && call[1] === "create");

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
    const { result, calls } = await reviewRun(
      [
        { findings: [{ message: "src/widget.ts:12 returns undefined on the empty-cart path" }] },
        { refuted: true, reason: "no-unused-vars already covers this" },
      ],
      {},
      ["no-unused-vars"],
    );

    expect(result.survivors).toEqual([]);
    expect(result.publishedIssues).toEqual([]);
    expect(result.tally).toEqual({ reached: 1, refuted: 1 });
    expect(issueCreates(calls).length).toBe(0);
  });
});

describe("runReview's conformance half", () => {
  const QUIET = [{ findings: [] }, { items: [] }];
  const CORRECTNESS_FINDING = "src/widget.ts:12 returns undefined on the empty-cart path";

  it("runs the conformance reviewer, on the spec the head commit's pull request resolves to", async () => {
    const { conformancePrompt } = await reviewRun(QUIET, {
      pullsByCommit: claimedPulls(),
      tickets: CONFORMANCE_TICKETS,
    });

    expect(conformancePrompt).toContain(SPEC_MARKER);
    expect(conformancePrompt).toContain(CRITERION_MARKER);
  });

  it("reviews a ticket that names no parent PRD against its own body", async () => {
    const { conformancePrompt } = await reviewRun(QUIET, {
      pullsByCommit: claimedPulls(),
      tickets: { [TICKET_NUMBER]: { title: "the ticket", body: ticketBody(false) } },
    });

    expect(conformancePrompt).toContain(CRITERION_MARKER);
  });

  it("finds the ticket for a pull request that is already merged, not only an open one", async () => {
    const { conformancePrompt } = await reviewRun(QUIET, {
      pullsByCommit: claimedPulls({ state: "closed", merged_at: "2026-08-28T12:00:00Z" }),
      tickets: CONFORMANCE_TICKETS,
    });

    expect(conformancePrompt).toBeDefined();
  });

  it("hands the refuter a conformance divergence alongside a correctness finding", async () => {
    const divergence = "src/widget.ts:12 never returns the cart total the spec asks for";
    const { result } = await reviewRun(
      [
        { findings: [{ message: CORRECTNESS_FINDING }] },
        { items: [{ classification: "divergence", message: divergence }] },
        { refuted: false, reason: "" },
        { refuted: false, reason: "" },
      ],
      { pullsByCommit: claimedPulls(), tickets: CONFORMANCE_TICKETS },
    );

    expect(result.tally).toEqual({ reached: 2, refuted: 0 });
    expect(result.survivors).toEqual([{ message: CORRECTNESS_FINDING }, { message: divergence }]);
    expect(result.publishedIssues.length).toBe(2);
  });

  it("reviews the correctness half alone, without failing, when no pull request has the head commit as its head", async () => {
    const { result, conformancePrompt } = await reviewRun(
      [{ findings: [{ message: CORRECTNESS_FINDING }] }, { refuted: false, reason: "" }],
      {
        pullsByCommit: { [HEAD_SHA]: [{ headSha: "cafef00d", headRef: `implement/issue-${TICKET_NUMBER}` }] },
        tickets: CONFORMANCE_TICKETS,
      },
    );

    expect(conformancePrompt).toBeUndefined();
    expect(result.tally).toEqual({ reached: 1, refuted: 0 });
    expect(result.survivors).toEqual([{ message: CORRECTNESS_FINDING }]);
  });

  const unresolvable: Array<[string, ReviewTrackerOptions]> = [
    ["the commit has no pull request at all", { tickets: CONFORMANCE_TICKETS }],
    [
      "the head branch is not an implementation claim",
      {
        pullsByCommit: { [HEAD_SHA]: [{ headSha: HEAD_SHA, headRef: "some-contributors-branch" }] },
        tickets: CONFORMANCE_TICKETS,
      },
    ],
    ["the ticket will not read", { pullsByCommit: claimedPulls(), tickets: {} }],
    [
      "the parent PRD will not read",
      { pullsByCommit: claimedPulls(), tickets: { [TICKET_NUMBER]: { title: "t", body: ticketBody() } } },
    ],
  ];

  it.each(unresolvable)("skips the conformance half, without failing, when %s", async (_case, options) => {
    const { result, conformancePrompt } = await reviewRun([{ findings: [] }], options);

    expect(conformancePrompt).toBeUndefined();
    expect(result.tally).toEqual({ reached: 0, refuted: 0 });
  });
});
