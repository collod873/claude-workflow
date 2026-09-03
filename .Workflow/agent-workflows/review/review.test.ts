import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { expectMachineAndTargetCheckouts } from "../shared/checkout-pair.fixture";
import type { GhExec } from "../shared/gh";
import { commitPullsPathMatcher } from "../shared/gh-paths";
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
const COVERED_CRITERION = "make test exits 0 with a widget that spins clockwise";
const UNTESTED_CRITERION = "make test exits 0 with a criterion no fixture names";

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

/**
 * A `StageExec` stand-in that answers with `responses[n]` on the nth call — the last one once
 * they run out, so a chain's tail (one refuter call per finding) needs no padding — and records
 * every prompt it saw. `prompts.length` is the call counter; there is no second one to keep in
 * step with it.
 */
function fakeExec(...responses: unknown[]): { exec: StageExec; prompts: string[] } {
  const prompts: string[] = [];
  const exec: StageExec = async (_argv, stdin) => {
    prompts.push(stdin ?? "");
    return JSON.stringify(responses[Math.min(prompts.length - 1, responses.length - 1)]);
  };
  return { exec, prompts };
}

/** One pull request as `commits/{head}/pulls` returns it, in the shape `runReview` reads. */
interface FakePull {
  headSha: string;
  headRef: string;
  /** Carried only so a test can show it is *not* a term — an already-merged pull request counts. */
  state?: string;
  merged_at?: string | null;
}

interface ReviewTrackerOptions {
  /** What `commits/<sha>/pulls` answers, keyed by the commit asked about. Absent means `[]`. */
  pullsByCommit?: Record<string, FakePull[]>;
  /** What `issue view <n>` answers, keyed by issue number. An unlisted number is a read failure. */
  tickets?: Record<number, { title: string; body: string }>;
  /** The number the first issue filed gets; each one after it counts up from there. */
  firstIssueNumber?: number;
}

/**
 * A `GhExec` stand-in wired for lane 07's own chain: `issue create` calls (findings, spec gaps, and
 * `runCounter`'s own proposals) get a canned, incrementing issue URL; `issue list` calls (both of
 * `runCounter`'s reads) get an empty JSON array, so the counter's below-threshold path is exercised
 * without needing a fixture tracker; and the two reads the conformance half needs — the commit's
 * pull requests, and a ticket or PRD body — are answered from `options`. Not `createFakeGh`: that
 * one refuses every call it does not model, and the conformance half's `label create` is one.
 *
 * The pulls lookup is recognised through `commitPullsPathMatcher` rather than a restated path, so
 * this fake cannot answer an endpoint different from the one `commitPullsPath` actually sends.
 */
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

    // Anything else — the spec-gap `label create` — is a write whose answer nobody reads.
    return "";
  };
  return { gh, calls };
}

/**
 * One conformance review of `DIFF` against PRD #42, with no criteria to scope and the reviewer
 * answering `items` — plus what it returned and what `gh` was asked, which is what the
 * classification tests are about.
 */
async function classified(items: unknown[], firstIssueNumber?: number) {
  const fake = fakeExec({ items });
  const { gh, calls } = trackerForReview({ firstIssueNumber });
  const result = await runConformanceReview(fake.exec, gh, {
    specText: "the spec",
    diff: DIFF,
    criteria: [],
    greenGateChecks: [],
    prdIssueNumber: 42,
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
    });

    const prompt = fake.prompts[0];
    expect(prompt).toContain("SPEC-MARKER-9f2");
    expect(prompt).toContain("DIFF-MARKER-9f2");
    expect(prompt.indexOf("SPEC-MARKER-9f2")).toBeLessThan(prompt.indexOf("DIFF-MARKER-9f2"));
  });

  it("scopes the reviewer to every criterion testsForCriteria did not find a test naming", async () => {
    const fake = fakeExec({ items: [] });
    const { gh } = trackerForReview();

    await runConformanceReview(fake.exec, gh, {
      specText: "the spec",
      diff: DIFF,
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
    const { result, calls } = await classified(
      [{ classification: "gap", message: "The spec never says what happens on an empty cart." }],
      777,
    );

    expect(result.findings).toEqual([]);
    expect(result.gapIssues).toEqual([777]);

    // Two calls, in this order: the label is seeded `--force` before it is used, because
    // `gh issue create --label` fails outright on a label nobody has created yet
    // (`shared/spec-gap.ts`, shared with the fixer since ADR-0119).
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

/**
 * The commit under review in the tests below, and the claim branch whose name is the only thing
 * that says which ticket the diff implements.
 */
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

/**
 * The conformance reviewer's prompt template up to its first placeholder — enough of the file to
 * identify *which* prompt a spawn carried, asserted against the real file rather than a literal
 * copied out of it.
 */
const CONFORMANCE_PROMPT_HEAD = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "conformance-reviewer/prompt.md"),
  "utf8",
).split("{{")[0];

const ASSIGNEE = "collod873";

/**
 * One whole run of lane 07 over `DIFF`, with the stage answering `responses` in order — plus the
 * two things every assertion below is about: what the chain returned, what `gh` was asked, and
 * which of the spawned prompts (if any) was the conformance reviewer's.
 */
async function reviewRun(
  responses: unknown[],
  options: ReviewTrackerOptions = {},
  greenGateChecks: string[] = [],
) {
  const { exec, prompts } = fakeExec(...responses);
  const { gh, calls } = trackerForReview(options);
  const result = await runReview(exec, gh, { diff: DIFF, greenGateChecks, assignee: ASSIGNEE, head: HEAD_SHA });
  return {
    result,
    calls,
    conformancePrompt: prompts.find((prompt) => prompt.includes(CONFORMANCE_PROMPT_HEAD)),
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

    // One for the finding, and (below both counter thresholds) none for a proposal.
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

/**
 * The half of lane 07 that had never executed once (#189): `runReview` called `runCorrectnessReview`
 * and nothing else, so ADR-0038 — a diff judged against its spec — had no production caller. These
 * assert the firing, the concatenation the refuter reads, and the one skip branch that stands in
 * for every way the spec can fail to resolve.
 */
describe("runReview's conformance half", () => {
  /** Both reviewers answering nothing — enough to see *whether* the conformance one was spawned. */
  const QUIET = [{ findings: [] }, { items: [] }];
  const CORRECTNESS_FINDING = "src/widget.ts:12 returns undefined on the empty-cart path";

  it("runs the conformance reviewer, on the spec the head commit's pull request resolves to", async () => {
    const { conformancePrompt } = await reviewRun(QUIET, {
      pullsByCommit: claimedPulls(),
      tickets: CONFORMANCE_TICKETS,
    });

    // The parent PRD's body is the spec, and the *ticket's* own criteria are the scope.
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
    // Lane 07 rides a `workflow_run` and is always behind the event that started it, so a fast
    // lane 08 can merge before this lookup happens. Restricting to open pull requests would make
    // the conformance reviewer skip exactly the runs that moved quickest.
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

    // Two reached the refuter, correctness first, and both survivors were filed.
    expect(result.tally).toEqual({ reached: 2, refuted: 0 });
    expect(result.survivors).toEqual([{ message: CORRECTNESS_FINDING }, { message: divergence }]);
    expect(result.publishedIssues.length).toBe(2);
  });

  it("reviews the correctness half alone, without failing, when no pull request has the head commit as its head", async () => {
    // A pull request that merely contains the commit — the exact case `commits/{head}/pulls` also
    // returns, and the one this lane must not resolve a spec from.
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

  /** Every other way the resolution can fail is the same one branch: skip, correctness only, no throw. */
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

const REVIEW_YML_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.github/workflows/review.yml",
);

const REVIEW_CALLER_YML_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.github/workflows/review-caller.yml",
);

/**
 * ADR-0055 (amended by ADR-0132) split this lane: `review-caller.yml` carries the trigger and the
 * routing decision `review.yml`'s own job `if:` used to make (`workflow_run` cannot be
 * parameterized through `workflow_call`), and `review.yml` itself is the reusable workflow it
 * calls, taking only the head SHA that decision turns up.
 */
describe("review-caller.yml's trigger", () => {
  const workflow = parse(readFileSync(REVIEW_CALLER_YML_PATH, "utf8")) as {
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
    // `verify-caller.yml` also fires on `push: main`, where `workflow_run.head_sha` is trunk's own
    // tip and `origin/main..head_sha` is empty — so without this the lane spent a reviewer fleet
    // reading nothing on every commit the owner pushed himself.
    //
    // Spelled from the other side — "not the push run" — because this workflow is not itself
    // dispatch-triggered and naming that event made it read as one to ADR-0090's sweep (#188). The
    // test below is what makes the two spellings the same condition rather than two conditions that
    // agree today.
    expect(workflow.jobs.review.if).toContain("github.event.workflow_run.event != 'push'");
  });

  it("is equivalent to naming the dispatch, because Verify has exactly two doors", () => {
    // The premise "not push" relies on: `Verify` fires on a push to main and on the implementer's
    // dispatch, and on nothing else. Since ADR-0055/ADR-0132 split `verify.yml` into a reusable
    // workflow plus `verify-caller.yml`, it is the caller stub that actually starts the run this
    // job reacts to — `verify.yml` itself carries only `workflow_call` now. `immutable-set.test.ts`
    // asserts the same list on the caller stub for its own reasons; it is re-asserted here because
    // *this* file's `if:` is unsound the moment a third trigger is added there, and the failure
    // would otherwise land on a lane that never mentions Verify's triggers at all.
    const verifyCaller = parse(
      readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), "../../../.github/workflows/verify-caller.yml"),
        "utf8",
      ),
    ) as { on: Record<string, unknown> };

    expect(Object.keys(verifyCaller.on).sort()).toEqual(["push", "repository_dispatch"]);
  });
});

describe("review.yml, the reusable workflow review-caller.yml calls", () => {
  const workflow = parse(readFileSync(REVIEW_YML_PATH, "utf8")) as {
    on: Record<string, unknown>;
    jobs: {
      review: {
        env?: Record<string, string>;
        steps?: Array<{
          name?: string;
          run?: string;
          env?: Record<string, string>;
          with?: { path?: string; repository?: string; token?: string; "fetch-depth"?: number };
        }>;
      };
    };
  };

  it("takes workflow_call, never a trigger of its own — that lives on the caller", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_call"]);
  });

  it("sets the assignee review.ts refuses to run without", () => {
    expect(workflow.jobs.review.env?.SIGNAL_ASSIGNEE).toBeDefined();
  });

  it("separates the machine it runs from the target it reviews", () => {
    // `fetchDepth: 0` because the diff under review is `origin/main...<head>`, and a shallow
    // checkout carries neither ref far enough back to compute it.
    expectMachineAndTargetCheckouts({ workflow: "review.yml", job: "review", runs: "review.ts", fetchDepth: 0 });
  });
});
