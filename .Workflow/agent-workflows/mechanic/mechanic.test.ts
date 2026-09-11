import { describe, expect, it, test, vi } from "vitest";
import {
  checkoutChanged,
  githubHoldingClaims,
  PR_URL,
  prCreatesIn,
  refDeletesIn,
  ticketCommentsIn,
  type ClaimHostOptions,
} from "../shared/claim-host.fixture";
import { createFakeGit } from "../shared/git.fake";
import { implementerReply } from "../shared/implementation-landing.fixture";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import type { GateVerdict } from "../shared/run-gauntlet";
import { gateSaying } from "../shared/gate.fixture";
import { createFakeStages, type FakeStage } from "../shared/stage.fake";
import {
  assembleMechanicBrief,
  fenceHits,
  logTail,
  MECHANIC_DENIED_TOOLS,
  MECHANIC_FENCE,
  MECHANIC_MODEL,
  runMechanic,
  skipsATest,
  strikeRunIds,
  type MechanicDeps,
} from "./mechanic";

const ISSUE = 77;
const STRIKES = [900, 901].map((runId) => ({
  author: "github-actions",
  createdAt: "2026-09-06T00:00:00Z",
  body: `<!-- strike:v1 run=${runId} conclusion=failure -->\n<!-- strike-signature:EISDIR bin/close-ticket -->\nStrike.`,
}));
const LOG = "step 1\nstep 2\nimplement failed: EISDIR: illegal operation on a directory, read bin/close-ticket\n";

interface Arrangement {
  github?: ClaimHostOptions;
  deps?: Partial<MechanicDeps>;
  built?: Record<string, string>;
  diff?: string;
  stage?: FakeStage;
}

function arrange({ github = {}, deps: extra = {}, built = { "a/b.ts": "export const x = 1;" }, diff = "", stage }: Arrangement = {}) {
  const host = githubHoldingClaims(github);
  const checkout = checkoutChanged(Object.keys(built));
  const git = createFakeGit((args) => (args[0] === "diff" ? diff : checkout.git(args))).git;
  const stages = stage ?? createFakeStages([JSON.stringify(implementerReply({ summary: "Found the cause." }))]);
  const gate = gateSaying({ ok: true });
  const log: string[] = [];
  const deps: MechanicDeps = {
    gh: host.gh,
    exec: stages.exec,
    git,
    readFile: (path) => built[path] ?? "",
    fileExists: (path) => path in built,
    writeFile: () => {},
    removeFile: () => {},
    regenerateIndex: () => false,
    runGate: gate.runGate,
    readRunLog: () => LOG,
    issueNumber: ISSUE,
    standards: () => "",
    comments: () => STRIKES,
    machineRoot: "/machine",
    targetRoot: "/target",
    log: (line) => log.push(line),
    ...extra,
  };
  return { deps, host, stage: stages, gate, log };
}

function repairRound() {
  const stage = createFakeStages([
    { text: JSON.stringify(implementerReply({ summary: "First pass." })), sessionId: "mech-1" },
    JSON.stringify(implementerReply({ summary: "Repaired." })),
  ]);
  const red: GateVerdict = { ok: false, output: "1 failed" };
  return { stage, gate: gateSaying(red, red, { ok: true }) };
}

async function laneBudgetMinutes(): Promise<number> {
  const claim = (await import("../shared/claim")) as unknown as { LANE_BUDGET_MINUTES?: number };
  return claim.LANE_BUDGET_MINUTES ?? 85;
}

async function underFakeClock(run: (budgetMinutes: number) => Promise<void>): Promise<void> {
  vi.useFakeTimers();
  try {
    await run(await laneBudgetMinutes());
  } finally {
    vi.useRealTimers();
  }
}

function execBurningBudget(stages: FakeStage, budgetMinutes: number, atSession: number): MechanicDeps["exec"] {
  let sessions = 0;
  return (...args) => {
    sessions += 1;
    if (sessions === atSession) vi.advanceTimersByTime((budgetMinutes + 1) * 60_000);
    return stages.exec(...args);
  };
}

function ghSaid(calls: string[][]): string {
  return calls.map((call) => call.join("\n")).join("\n---\n");
}

describe("what the mechanic decides from", () => {
  it("reads the strikes' run ids off the ticket's comments", () => {
    expect(strikeRunIds(STRIKES)).toEqual([
      { runId: 900, conclusion: "failure" },
      { runId: 901, conclusion: "failure" },
    ]);
  });

  it("keeps the last 120 lines of a log", () => {
    const raw = Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n");

    const tail = logTail(raw).split("\n");

    expect(tail).toHaveLength(120);
    expect(tail[0]).toBe("line 80");
  });

  it("puts the ticket, every comment, each dead run's log, both checkouts and the fence in the brief", () => {
    const brief = assembleMechanicBrief({
      ticket: { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" },
      comments: STRIKES,
      deadRuns: [{ runId: 900, conclusion: "failure", tail: LOG }],
      standards: "## Standards\n- none",
      machineRoot: "/machine",
      targetRoot: "/target",
    });

    expect(brief).toContain("## Ticket: Do the thing");
    expect(brief).toContain("strike:v1 run=901");
    expect(brief).toContain("### Run 900 ended `failure`");
    expect(brief).toContain("illegal operation on a directory");
    expect(brief).toContain("`/target`");
    expect(brief).toContain("`/machine`");
    for (const entry of MECHANIC_FENCE) expect(brief).toContain(entry);
  });
});

describe("the fence", () => {
  it("names the standards, the contract and the immutable set, and nothing under them may change", () => {
    expect(fenceHits(["a/b.ts", "CODING_STANDARDS.md", ".github/workflows/x.yml", "vitest.config.ts", ".claude/contract.json"])).toEqual([
      "CODING_STANDARDS.md",
      ".github/workflows/x.yml",
      "vitest.config.ts",
      ".claude/contract.json",
    ]);
  });

  it("reads a skipped test off the diff's added lines only", () => {
    expect(skipsATest("+  it.skip('x', () => {})")).toBe(true);
    expect(skipsATest("+  xdescribe('x', () => {})")).toBe(true);
    expect(skipsATest("+  test.todo('x')")).toBe(true);
    expect(skipsATest("-  it.skip('x', () => {})\n+  it('x', () => {})")).toBe(false);
  });

  it("refuses the tracker and version control to the model, keeps git reads and subagents", () => {
    expect(MECHANIC_DENIED_TOOLS).toContain("Bash(gh api:*)");
    expect(MECHANIC_DENIED_TOOLS).toContain("Bash(git push:*)");
    expect(MECHANIC_DENIED_TOOLS).not.toContain("Agent");
    expect(MECHANIC_DENIED_TOOLS).not.toContain("Bash(gh:*)");
  });
});

describe("runMechanic", () => {
  it("claims the branch, briefs one Opus session with the dead runs' logs, and lands the checkout as a pull request", async () => {
    const { deps, host, stage } = arrange();

    const result = await runMechanic(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(stage.calls).toHaveLength(1);
    expect(stage.calls[0]).toContain(MECHANIC_MODEL);
    expect(stage.stdins[0]).toContain("illegal operation on a directory");
    expect(prCreatesIn(host.calls)[0].join("\n")).toContain("Found the cause.");
    expect(host.calls.some((call) => call.includes(NEEDS_HUMAN_LABEL))).toBe(false);
  });

  it("does nothing when the branch is already somebody's work", async () => {
    const { deps, stage } = arrange({ github: { existingClaim: { branch: `implement/issue-${ISSUE}`, pullRequests: 1 } } });

    expect(await runMechanic(deps)).toEqual({ outcome: "already-claimed" });
    expect(stage.calls).toEqual([]);
  });

  it("refuses an answer that edits the fence, says so on the ticket, escalates, and releases the claim", async () => {
    const { deps, host } = arrange({ built: { "CODING_STANDARDS.md": "# looser", "a/b.ts": "x" } });

    const result = await runMechanic(deps);

    expect(result).toEqual({ outcome: "fence-refused", paths: ["CODING_STANDARDS.md"] });
    expect(prCreatesIn(host.calls)).toEqual([]);
    expect(ticketCommentsIn(host.calls)[0]).toContain("`CODING_STANDARDS.md`");
    expect(host.calls.some((call) => call.includes(NEEDS_HUMAN_LABEL))).toBe(true);
    expect(refDeletesIn(host.calls)).toHaveLength(1);
  });

  it("refuses an answer whose diff skips a test", async () => {
    const { deps, host } = arrange({ diff: "+  it.skip('the red one', () => {})" });

    const result = await runMechanic(deps);

    expect(result).toEqual({ outcome: "skip-refused" });
    expect(prCreatesIn(host.calls)).toEqual([]);
    expect(ticketCommentsIn(host.calls)[0]).toContain("skips a test");
  });

  it("resumes the same session once when the gate is red, then lands", async () => {
    const { stage, gate } = repairRound();
    const { deps, host } = arrange({ stage, deps: { runGate: gate.runGate } });

    const result = await runMechanic(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(stage.calls[1]).toContain("--resume");
    expect(stage.stdins[1]).toContain("1 failed");
    expect(prCreatesIn(host.calls)[0].join("\n")).toContain("Repaired.");
  });
});

describe("the lane budget", () => {
  test("#497.1: mechanic.ts calls the budget wrapper rather than runStageSession directly, the repair session included", async () => {
    await underFakeClock(async (budgetMinutes) => {
      const { stage, gate } = repairRound();
      const exec = execBurningBudget(stage, budgetMinutes, 2);
      const { deps, host } = arrange({ stage, deps: { exec, runGate: gate.runGate } });

      await runMechanic(deps).catch((err: unknown) => err);

      expect(stage.calls).toHaveLength(2);
      expect(prCreatesIn(host.calls)).toEqual([]);
      expect(ghSaid(host.calls)).toContain(`timed out after ${budgetMinutes} minutes at `);
    });
  });

  test("#497.2: an elapsed budget strikes the ticket with the signature naming its stage", async () => {
    await underFakeClock(async (budgetMinutes) => {
      const stage = createFakeStages([JSON.stringify(implementerReply({ summary: "Found the cause." }))]);
      const { deps, host } = arrange({ stage, deps: { exec: execBurningBudget(stage, budgetMinutes, 1) } });

      await runMechanic(deps).catch((err: unknown) => err);

      expect(ghSaid(host.calls)).toContain(`timed out after ${budgetMinutes} minutes at mechanic`);
      expect(prCreatesIn(host.calls)).toEqual([]);
    });
  });
});
