import { afterEach, describe, expect, it, test, vi } from "vitest";
import type { GitExec } from "../shared/git";
import type { StageExec } from "../shared/stage";
import { createFakeStages } from "../shared/stage.fake";
import { observation } from "../shared/observation.fixture";
import { ratifierVars, ratifyBatch, runRatifierStage, type RatifyBatchDeps } from "./ratifier";
import { ratifierVerdict } from "./verdict.fixture";
import type { RatifierVerdict } from "./verdict-schema";

const STANDARDS = ["# Coding Standards", "", "## Standards", "", "- **Existing**: w.", "  Why: y.", "  Red flag: r.", ""].join(
  "\n",
);

function fakeGit(options: { treeChanges?: boolean } = {}): { git: GitExec; calls: string[][] } {
  const calls: string[][] = [];
  let commits = 0;
  let trees = 0;
  const git: GitExec = (args) => {
    calls.push([...args]);
    if (args.includes("write-tree")) return options.treeChanges === false ? "sametree\n" : `tree${trees++}\n`;
    if (args.includes("rev-parse")) return "sametree\n";
    if (args.includes("commit-tree")) return `commit${++commits}\n`;
    return "";
  };
  return { git, calls };
}

function deps(overrides: Partial<RatifyBatchDeps> & { responses: RatifierVerdict[] }): RatifyBatchDeps {
  const { responses, ...rest } = overrides;
  const files = new Map<string, string>([["CODING_STANDARDS.md", STANDARDS]]);
  return {
    git: fakeGit().git,
    exec: createFakeStages(responses.map((verdict) => JSON.stringify(verdict))).exec,
    repoDir: "/repo",
    head: "headsha",
    observations: [],
    standards: STANDARDS,
    readFile: (path) => files.get(path) ?? "",
    writeFile: (path, content) => void files.set(path, content),
    trial: () => ({ reproduced: true, missed: [] }),
    log: () => {},
    ...rest,
  };
}

describe("ratifyBatch: a reject verdict", () => {
  it("writes declined memory, reverts the tree, and lands no commit", async () => {
    const git = fakeGit();
    const found = observation({ finding: "too narrow to standardise", sites: ["a.ts:1", "b.ts:2"] });

    const result = await ratifyBatch(
      deps({
        git: git.git,
        observations: [found],
        responses: [ratifierVerdict({ verdict: "reject", landedAs: undefined, fallback: undefined, reason: "too narrow" })],
      }),
    );

    expect(result.landed).toEqual([]);
    expect(result.tip).toBe("headsha");
    expect(result.declined).toEqual([
      { finding: "too narrow to standardise", sites: ["a.ts:1", "b.ts:2"], decision: "declined", reason: "too narrow" },
    ]);
    expect(git.calls.some((argv) => argv.includes("checkout-index"))).toBe(true);
    expect(git.calls.some((argv) => argv.includes("commit-tree"))).toBe(false);
  });
});

describe("ratifyBatch: a prose verdict", () => {
  it("commits whatever the stage wrote and records what it landed as", async () => {
    const git = fakeGit();
    const found = observation({ finding: "a judgement call", sites: ["a.ts:1", "b.ts:2"] });

    const result = await ratifyBatch(
      deps({
        git: git.git,
        observations: [found],
        responses: [
          ratifierVerdict({ verdict: "prose", landedAs: "Refusals are cheap", fallback: undefined, reason: "no rule can see it" }),
        ],
      }),
    );

    expect(result.tip).toBe("commit1");
    expect(result.landed).toEqual([
      { observation: found, landedAs: "Refusals are cheap", reason: "no rule can see it", verdict: "prose" },
    ]);
    expect(result.declined).toEqual([]);
    expect(git.calls.some((argv) => argv.includes("worktree"))).toBe(false);
  });

  it("skips a verdict whose edits changed nothing rather than landing an empty commit", async () => {
    const git = fakeGit({ treeChanges: false });

    const result = await ratifyBatch(
      deps({
        git: git.git,
        observations: [observation({ finding: "a judgement call" })],
        responses: [ratifierVerdict({ verdict: "prose", landedAs: "Some name", fallback: undefined })],
      }),
    );

    expect(result.landed).toEqual([]);
    expect(result.skipped).toEqual(["a judgement call"]);
  });
});

describe("ratifyBatch: a mechanise verdict and its rule trial", () => {
  it("lands the rule when the trial reproduces every site", async () => {
    const git = fakeGit();
    const found = observation({ finding: "cross-lane reach", sites: ["a.ts:1"] });

    const result = await ratifyBatch(
      deps({
        git: git.git,
        observations: [found],
        responses: [ratifierVerdict({ landedAs: "ns/rule" })],
        trial: () => ({ reproduced: true, missed: [] }),
      }),
    );

    expect(result.landed.map((entry) => [entry.landedAs, entry.verdict])).toEqual([["ns/rule", "mechanise"]]);
  });

  it("tries the rule against the parent commit, which is the tree before this finding was touched", async () => {
    const seen: string[] = [];

    await ratifyBatch(
      deps({
        observations: [observation({ finding: "cross-lane reach", sites: ["a.ts:1"] })],
        responses: [ratifierVerdict({ landedAs: "ns/rule" })],
        trial: (options) => {
          seen.push(options.parent, options.ruleId);
          return { reproduced: true, missed: [] };
        },
      }),
    );

    expect(seen).toEqual(["headsha", "ns/rule"]);
  });

  it("demotes a rule that cannot reproduce its own evidence, landing the fallback entry instead", async () => {
    const git = fakeGit();
    const found = observation({ finding: "cross-lane reach", sites: ["a.ts:1"] });
    const written = new Map<string, string>([["CODING_STANDARDS.md", STANDARDS]]);

    const result = await ratifyBatch(
      deps({
        git: git.git,
        observations: [found],
        responses: [ratifierVerdict({ landedAs: "ns/rule" })],
        readFile: (path) => written.get(path) ?? "",
        writeFile: (path, content) => void written.set(path, content),
        trial: () => ({ reproduced: false, missed: ["a.ts"] }),
      }),
    );

    expect(result.landed).toHaveLength(1);
    expect(result.landed[0].landedAs).toBe("Lane-local imports");
    expect(result.landed[0].verdict).toMatch(/demoted/);
    expect(git.calls.some((argv) => argv.includes("checkout-index"))).toBe(true);
    expect(written.get("CODING_STANDARDS.md")).toContain("**Lane-local imports**");
  });
});

describe("ratifyBatch: the rule the schema cannot carry", () => {
  it("skips a VIOLATION finding the stage tried to decide instead of fix", async () => {
    const result = await ratifyBatch(
      deps({
        observations: [observation({ finding: "broke a ratified standard", lens: "VIOLATION", released: true })],
        responses: [ratifierVerdict({ verdict: "prose", landedAs: "A name", fallback: undefined })],
      }),
    );

    expect(result.landed).toEqual([]);
    expect(result.declined).toEqual([]);
    expect(result.skipped).toEqual(["broke a ratified standard"]);
  });

  it("skips a PROPOSED finding the stage tried to fix instead of decide", async () => {
    const result = await ratifyBatch(
      deps({
        observations: [observation({ finding: "a pattern" })],
        responses: [ratifierVerdict({ verdict: "violation-fix", landedAs: "Some standard", fallback: undefined })],
      }),
    );

    expect(result.skipped).toEqual(["a pattern"]);
  });

  it("commits a VIOLATION fix without asking anyone to decide it", async () => {
    const git = fakeGit();
    const found = observation({ finding: "broke a ratified standard", lens: "VIOLATION", released: true });

    const result = await ratifyBatch(
      deps({
        git: git.git,
        observations: [found],
        responses: [ratifierVerdict({ verdict: "violation-fix", landedAs: "Deep modules", fallback: undefined })],
      }),
    );

    expect(result.landed.map((entry) => entry.verdict)).toEqual(["violation-fix"]);
  });
});

describe("ratifyBatch: one bad finding costs that finding and nothing else", () => {
  it("restores the tree, skips it, and keeps deciding the rest of the batch", async () => {
    const git = fakeGit();

    const result = await ratifyBatch(
      deps({
        git: git.git,
        observations: [observation({ finding: "the broken one" }), observation({ finding: "the next one" })],
        responses: [],
        exec: createFakeStages([
          "not structured output at all",
          JSON.stringify(ratifierVerdict({ verdict: "prose", landedAs: "Survivor", fallback: undefined })),
        ]).exec,
      }),
    );

    expect(result.skipped).toEqual(["the broken one"]);
    expect(result.landed.map((entry) => entry.landedAs)).toEqual(["Survivor"]);
  });
});

type Settled =
  | { state: "pending" }
  | { state: "resolved"; value: unknown }
  | { state: "rejected"; error: unknown };

const PRD_LANE_BUDGET_MINUTES = 85;

async function laneBudgetMinutes(): Promise<number> {
  const claim = (await import("../shared/claim")) as { LANE_BUDGET_MINUTES?: number };
  return claim.LANE_BUDGET_MINUTES ?? PRD_LANE_BUDGET_MINUTES;
}

function stalledExec(): StageExec {
  return (() => new Promise(() => undefined)) as unknown as StageExec;
}

function budgetVars(): Record<string, string> {
  return ratifierVars({
    observation: observation({ finding: "a pattern", sites: ["a.ts:1"] }),
    batch: [],
    standards: STANDARDS,
  });
}

async function advance(run: Promise<unknown>, ms: number): Promise<Settled> {
  const tracked: Promise<Settled> = run.then(
    (value): Settled => ({ state: "resolved", value }),
    (error): Settled => ({ state: "rejected", error }),
  );
  await vi.advanceTimersByTimeAsync(ms);
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  return Promise.race([tracked, Promise.resolve<Settled>({ state: "pending" })]);
}

function strikeText(error: unknown): string {
  const carrier = error as { message?: unknown; cause?: unknown; body?: unknown; strike?: unknown } | null | undefined;
  return [String(error), carrier?.message, carrier?.cause, carrier?.body, carrier?.strike]
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join(" ");
}

afterEach(() => {
  vi.useRealTimers();
});

test("#500.1: ratifier runs its stage under the lane budget instead of calling runStage directly", async () => {
  const minutes = await laneBudgetMinutes();
  vi.useFakeTimers();

  const run = runRatifierStage(stalledExec(), budgetVars());

  expect((await advance(run, minutes * 60_000 - 60_000)).state).toBe("pending");
  expect((await advance(run, 120_000)).state).toBe("rejected");
});

test("#500.2: an elapsed budget strikes the ticket with the timed-out-at-ratifier signature", async () => {
  const minutes = await laneBudgetMinutes();
  vi.useFakeTimers();

  const run = runRatifierStage(stalledExec(), budgetVars());
  const outcome = await advance(run, minutes * 60_000 + 120_000);

  expect(outcome.state).toBe("rejected");
  expect(outcome.state === "rejected" ? strikeText(outcome.error) : "").toContain(
    `timed out after ${minutes} minutes at ratifier`,
  );
});
